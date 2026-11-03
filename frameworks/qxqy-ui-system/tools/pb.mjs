// tools/pb.mjs — 最小 protobuf wire-format 读写器（无 schema 依赖）
// 用途：解析千星 `.gia` / `.gil` 的二进制体，供上层按 schema 解释。
// 依据：proto3 wire format（varint=0 / 64bit=1 / len=2 / 32bit=5）。
//
// 节点形状：{ field, wt, num?, payload?, sub? }
//   wt=0 → num: BigInt
//   wt=1 → fixed64: Buffer(8)
//   wt=2 → payload: Buffer，且尽量尝试 sub = pb.decode(payload)
//   wt=5 → f: number(float32)，raw: Buffer(4)

export function readVarint(buf, pos) {
  let result = 0n;
  let shift = 0n;
  let p = pos;
  for (;;) {
    if (p >= buf.length) throw new Error(`varint 越界 @${p}`);
    const b = buf[p++];
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7n;
    if (shift > 70n) throw new Error(`varint 过长 @${pos}`);
  }
  return { value: result, pos: p };
}

/** 尝试把 payload 解成消息；失败则返回 null（不抛异常）。 */
export function tryDecode(payload) {
  try {
    return decode(payload);
  } catch {
    return null;
  }
}

export function decode(buf, start = 0, end = buf.length) {
  const out = [];
  let p = start;
  while (p < end) {
    const at = p;
    const key = readVarint(buf, p);
    p = key.pos;
    const field = Number(key.value >> 3n);
    const wt = Number(key.value & 7n);
    if (field === 0) throw new Error(`field 0 @${at}`);
    const node = { field, wt, at };
    if (wt === 0) {
      const v = readVarint(buf, p);
      p = v.pos;
      node.num = v.value;
    } else if (wt === 1) {
      node.raw = buf.subarray(p, p + 8);
      p += 8;
    } else if (wt === 2) {
      const v = readVarint(buf, p);
      p = v.pos;
      const len = Number(v.value);
      node.payload = buf.subarray(p, p + len);
      p += len;
      node.len = len;
    } else if (wt === 5) {
      node.raw = buf.subarray(p, p + 4);
      node.f = buf.readFloatLE(p);
      p += 4;
    } else {
      throw new Error(`未知 wire type ${wt} (field ${field}) @${at}`);
    }
    if (p > end) throw new Error(`越界 @${at} field=${field} wt=${wt}`);
    out.push(node);
  }
  return out;
}

/** 带 sub 解码的深度解码：wt=2 且内容可完整解成消息时填 sub。 */
export function decodeDeep(buf) {
  const flat = decode(buf);
  for (const n of flat) {
    if (n.wt === 2 && n.len > 0) {
      const sub = tryDecode(n.payload);
      if (sub && sub.length) n.sub = decodeDeep(n.payload);
    }
  }
  return flat;
}

export const num = (fs, n) => {
  const f = (fs || []).find((x) => x.field === n && x.wt === 0);
  return f ? Number(f.num) : null;
};
export const numBig = (fs, n) => {
  const f = (fs || []).find((x) => x.field === n && x.wt === 0);
  return f ? f.num : null;
};
export const msg = (fs, n) => {
  const f = (fs || []).find((x) => x.field === n);
  return f ? (f.sub || (f.payload ? tryDecode(f.payload) : null)) : null;
};
export const msgs = (fs, n) => (fs || []).filter((x) => x.field === n);
export const txt = (fs, n) => {
  const f = (fs || []).find((x) => x.field === n && x.wt === 2);
  if (!f || !f.payload) return null;
  const s = f.payload.toString('utf8');
  // 含不可打印控制符则视为二进制
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s) ? null : s;
};
export const f32 = (fs, n) => {
  const f = (fs || []).find((x) => x.field === n && x.wt === 5);
  return f ? f.f : null;
};
/** 递归搜索：返回所有 field === n 的节点（谨慎使用，同号字段跨层含义不同）。 */
export function findAll(fs, n, acc = []) {
  for (const f of fs || []) {
    if (f.field === n) acc.push(f);
    if (f.sub) findAll(f.sub, n, acc);
  }
  return acc;
}
