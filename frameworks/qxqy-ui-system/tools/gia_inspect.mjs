// tools/gia_inspect.mjs — 千星 .gia 结构解析器
// 用法：
//   node workspace/qxqy-ui-system/tools/gia_inspect.mjs "<file.gia>" [--json out.json] [--maxdepth N]
//
// 依据：
//   · 信封 = 5 个大端 u32 头 + protobuf 体 + 4 字节尾（head[4] = 体长，实测 20+体长+4 = 文件长）
//   · 体 = Root { repeated GraphUnit graph = 1; repeated GraphUnit accessories = 2;
//                string filePath = 3; uint32 modeFlag = 4; string gameVersion = 5; }
//   · GraphUnit { Id id = 1 {class=2,type=3,id=4}; repeated Id relatedIds = 2; string name = 3;
//                 int32 which = 5; UiControlGroup ui = 19; ScriptMappingWrapper script = 35; }
//   · UiControlGroup { ContentWrapper content = 1 { guid=501; repeated Info info=502;
//                 repeated uint32 children=503; uint32 parent=504; repeated Data data=505 } }
//   schema 出处：qianxing-murdoku/tools/sim/out/_gia_schema.proto（插件内嵌模式的转录）
import fs from 'node:fs';
import path from 'node:path';
import * as pb from './pb.mjs';

const argv = process.argv.slice(2);
const IN = argv[0];
const JSON_OUT = (() => {
  const i = argv.indexOf('--json');
  return i >= 0 ? argv[i + 1] : null;
})();
if (!IN) {
  console.error('用法: node gia_inspect.mjs <file.gia> [--json out.json]');
  process.exit(2);
}

const buf = fs.readFileSync(IN);
const head = [0, 4, 8, 12, 16].map((o) => buf.readUInt32BE(o));
const bodyLen = head[4];
if (20 + bodyLen + 4 !== buf.length) {
  console.error(`信封假设不符：20+${bodyLen}+4 = ${20 + bodyLen + 4}，文件 ${buf.length}`);
  process.exit(3);
}
const root = pb.decodeDeep(buf.subarray(20, 20 + bodyLen));

const meta = {
  file: path.basename(IN),
  bytes: buf.length,
  header: head,
  filePath: pb.txt(root, 3),
  gameVersion: pb.txt(root, 5),
  modeFlag: pb.num(root, 4),
};

// ── 各 slot → 业务含义的槽位表（DET_SLOT 取自 gil_to_save.mjs 的实测映射） ──
const DET_SLOT = {
  13: 'transform',
  14: 'field14',
  73: 'rootChildRef',
  74: 'genericSlot',
  75: 'textConfig',
  76: 'cursorConfig',
  77: 'templateRefSlot',
  78: 'footerSlot',
  79: 'containerNodeSlot',
  80: 'gridView',
  81: 'buttonPreset',
  83: 'keyHint',
  84: 'imageSlot',
  85: 'image',
  86: 'effectSlot',
  87: 'fullscreenEffectSlot',
};

function decodeUnit(u) {
  const s = u.sub || u;
  const idM = pb.msg(s, 1) || [];
  const unit = {
    id: { class: pb.num(idM, 2), type: pb.num(idM, 3), guid: pb.num(idM, 4) },
    name: pb.txt(s, 3),
    which: pb.num(s, 5),
    relatedIds: pb.msgs(s, 2).map((r) => {
      const rs = r.sub || [];
      return { class: pb.num(rs, 2), type: pb.num(rs, 3), guid: pb.num(rs, 4) };
    }),
    fields: s.map((f) => `${f.field}${f.wt === 2 ? '(2)' : f.wt === 0 ? '(0)' : `(${f.wt})`}`),
    hasUi: !!pb.msg(s, 19),
    hasScript: !!pb.msg(s, 35),
    script: null,
    controls: [],
  };
  const sm = pb.msg(s, 35);
  if (sm) {
    const m = pb.msg(sm, 1);
    if (m) {
      unit.script = { id: pb.num(m, 1), name: pb.txt(m, 2), path: pb.txt(m, 3), sourceLen: (pb.txt(m, 5) || '').length };
    }
  }
  const ui = pb.msg(s, 19);
  if (ui) {
    const content = pb.msg(ui, 1);
    if (content) unit.controls = decodeGroup(content);
  }
  return unit;
}

function decodeGroup(content) {
  const list = pb.msgs(content, 502);
  return list.map((cw) => decodeRecord(cw.sub || []));
}

function decodeRecord(sub) {
  const guid = pb.num(sub, 501);
  const data = pb.msgs(sub, 505).map((d) => {
    const ds = d.sub || [];
    const det = pb.msg(ds, 503);
    return { slotA: pb.num(ds, 501), slotB: pb.num(ds, 502), det: det || null };
  });
  const info = pb.msgs(sub, 502).map((i) => {
    const is = i.sub || [];
    const g = pb.msg(is, 11);
    const ix = pb.msg(is, 12);
    const rel = pb.msgs(pb.msg(is, 14) || [], 501).map((x) => Number(x.num));
    return { a: pb.num(is, 501), b: pb.num(is, 502), guid: g ? pb.num(g, 501) : null, index: ix ? pb.num(ix, 501) : null, related: rel };
  });
  const det = (slot) => {
    for (const d of data) {
      if (!d.det) continue;
      const hit = (d.det.sub || d.det).find ? (d.det.sub || []).find((x) => DET_SLOT[x.field] === slot) : null;
      if (hit) return hit;
    }
    return null;
  };
  const detAll = (slot) => {
    for (const d of data) if (d.det && DET_SLOT[d.det.field] === slot) return d.det;
    return null;
  };
  // name 从 Data field12 (WrapperString 501) 取
  const nameF = (() => {
    for (const d of data) {
      const w = (d.det && d.det.field === 12) ? d.det : null;
      if (w) {
        const s = pb.msg(w.sub || [], 501);
        const t = s ? pb.txt(s, 501) : null;
        if (t) return t;
      }
    }
    return null;
  })();
  const children = (() => {
    const cl = pb.msgs(sub, 503);
    const out = [];
    for (const c of cl) {
      // 子列表是「裸 varint 打包」还是「真消息」，按 payload 能否整段解成 ID 列表判定
      if (c.payload && !c.sub) {
        try {
          const ids = [];
          let p = 0;
          while (p < c.payload.length) {
            const v = pb.readVarint(c.payload, p);
            p = v.pos;
            ids.push(Number(v.value));
          }
          out.push(...ids);
        } catch {
          /* 非 ID 列表 */
        }
      } else if (c.sub) {
        for (const f of c.sub) if (f.wt === 0) out.push(Number(f.num));
      }
    }
    return out;
  })();
  const parent = (() => {
    const p = pb.msgs(sub, 504).find((f) => f.wt === 0);
    return p ? Number(p.num) : null;
  })();
  const kinds = data.map((d) => (d.det ? DET_SLOT[d.det.field] || `?${d.det.field}` : null)).filter(Boolean);
  return { guid, name: nameF, info, parent, children, data, kinds, det, detAll };
}

const units = [...pb.msgs(root, 1).map((u) => ({ bucket: 'graph', u })), ...pb.msgs(root, 2).map((u) => ({ bucket: 'accessories', u }))];
const decoded = units.map(({ bucket, u }) => ({ bucket, ...decodeUnit(u) }));

// ── 输出 ────────────────────────────────────────────────────────────────────
console.log('# GIA 元信息');
console.log(JSON.stringify(meta, null, 1));
console.log(`\n# GraphUnit 总数 = ${decoded.length}（graph=${decoded.filter((d) => d.bucket === 'graph').length}, accessories=${decoded.filter((d) => d.bucket === 'accessories').length}）`);
console.log('\n# 顶层单元');
for (const d of decoded.filter((x) => x.bucket === 'graph')) {
  console.log(
    `- [graph] name=${JSON.stringify(d.name)} id={class:${d.id.class},type:${d.id.type},guid:${d.id.guid}} which=${d.which} controls=${d.controls.length} script=${d.script ? JSON.stringify(d.script) : '无'} fields=${d.fields.join(',')}`,
  );
}
console.log('\n# accessories（记录/模板）——按 name 汇总');
const acc = decoded.filter((x) => x.bucket === 'accessories');
const byWhich = new Map();
for (const a of acc) byWhich.set(a.which, (byWhich.get(a.which) || 0) + 1);
console.log('which 分布:', [...byWhich.entries()].sort((x, y) => x[0] - y[0]).map(([k, v]) => `${k}:${v}`).join(' '));
const nameCount = new Map();
for (const a of acc) nameCount.set(a.name, (nameCount.get(a.name) || 0) + 1);
console.log('name 分布（name×次数）:', [...nameCount.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}×${v}`).join(' | '));

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({ meta, units: decoded }, null, 1));
  console.log(`\n已写 ${JSON_OUT}`);
}
