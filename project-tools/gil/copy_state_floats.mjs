// tools/gil/copy_state_floats.mjs 鈥斺€?鎶娿€愬師鍨嬨€戠姸鎬佸潡閲岀殑娴偣瀵硅ˉ杩涖€愭柊鎺т欢銆戯紙**鍙ˉ缂哄け/NaN 鐨?*锛?//
// 涓轰粈涔堥渶瑕佸畠锛?026-10-15 鐪熸満鍒ゅ喅锛岀涓夋淇锛夛細
//   鈽?`add_button.mjs` 鍏嬮殕 `home.select` 鏃?*鍙厠闅嗕簡璁板綍鏈韩涓庡瓙鎺т欢** 鉁?//     鈽?娌℃湁鎶婄姸鎬佸潡閲岄偅鍑犲"甯冨眬娴偣"琛ヤ笂 鈬?鈽?鏂版帶浠剁殑瀹冧滑鏄?**NaN** 鉁?//   鈽?瀵圭収瀹炴祴锛坄374-缁撶畻鎸夐挳-v243.gil`锛屽洓涓姸鎬佸潡 **瀹屽叏涓€鑷?*锛夛細
//       home.select : #501/#1..3 = 1,1,1   #502 = 0.5,0.5   #503 = 0.5,0.5   #506 = 0.5,0.5
//       settle.btn  : #501/#1..3 = NaN     #502 = NaN,NaN   #503 = NaN,NaN   #506 = NaN,NaN
//   鈬?鈽呪槄 缁撳眬锛氣槄 **浣嶇疆涓庡昂瀵革紙#504/#505锛夋垜鍐欏浜嗐€佽澶囧洖璇讳篃鏄鐨?* 鉁?//      鈽?浣?*閿氱偣/杞村績鏄?NaN** 鉁?鈬?鈽?鍛戒腑鍒ゅ畾绠椾笉鍑虹煩褰?鈬?鈽?鏁村睆閮界畻浣滃畠 鉁撯湏
//      锛堚槄 杩欐鏄?`raycast = false` 娌℃尅浣?锛?鎹㈠眰搴忎篃娌＄敤"鐨勫師鍥?鉁擄級
//
// 鈿狅笍 瑙勭煩锛堟湰浠撶殑鑰佽鐭?鉁擄級锛?//   路 鈽?**鍙ˉ NaN / 缂哄け**鐨勯偅浜?鉁?鈥斺€?鏈夊€肩殑瀛楁**涓€涓瓧閮戒笉鍔?* 鉁?//   路 鈽?鍙寜**鐘舵€佸潡鍐呯浉鍚岃矾寰?*鎶?鉁擄紙`#50x/#50y` 浣嶇疆鍥哄畾 鉁擄級
//   路 鈽?鍐欑洏璧?`writeGil()`锛堝線杩?锛?浠庣鐩橀噸璇?锛?diff 涓夐亾闂?鉁擄級
//
// 鐢ㄦ硶锛?//   node tools/gil/copy_state_floats.mjs --in=<in.gil> --out=<out.gil> --from=home.select --to=settle.btn [--dry]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGil, findChildListTop, asIdList } from './gilread.mjs';
import { writeGil } from './gilwrite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const argOf = (k) => { const a = argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3).replace(/^"|"$/g, '') : null; };
const DRY = argv.includes('--dry');

const IN = argOf('in'), OUT = argOf('out'), FROM = argOf('from'), TO = argOf('to');
if (!IN || !OUT || !FROM || !TO) {
  console.error('鐢ㄦ硶: node tools/gil/copy_state_floats.mjs --in=<in.gil> --out=<out.gil> --from=<鍘熷瀷鍚? --to=<鐩爣鍚? [--dry]');
  process.exit(1);
}

const g = readGil(path.isAbsolute(IN) ? IN : path.join(ROOT, IN));
const src = g.byName.get(FROM), dst = g.byName.get(TO);
if (!src) { console.error('鉂?鎵句笉鍒板師鍨?' + FROM); process.exit(2); }
if (!dst) { console.error('鉂?鎵句笉鍒扮洰鏍?' + TO); process.exit(3); }

// 鈽呪槄鈽呪槄鈽呪槄鈽呪槄 2026-10-16 **`--also=鍚嶅瓧=鍊?鍚嶅瓧=鍊糮锛氱洰鏍囧彲浠ユ槸銆愪换浣曘€戣褰曪紙鍚瓙鎺т欢 鉁擄級** 鉁椻湏鉁?//
//   鈽?涓轰粈涔堝姞杩欎釜 鉁楋紙v244 涔嬪悗鐨勭湡鏈哄弽棣?鉁擄級锛氣槄 鐢ㄦ埛璇?//     銆屸槄 **鍏ㄥ睆闂瑙ｅ喅浜嗭紝鍥涗釜鏂瑰潡鍒犳帀浜嗭紝浣嗕袱棰楃粨绠楁寜閽繕鏄病鍑虹幇**銆嶁湏
//   鈬?鈽?鎴戜笂涓€鐗堝彧琛ヤ簡**鎸夐挳鑷繁**鐨勬诞鐐?鉁?鈥斺€?鈽?鑰屽畠鐨?**`bg` / `label` 鍗佷簩涓诞鐐瑰叏鏄?NaN** 鉁?//     鈽?瀵圭収瀹炴祴 鉁擄細
//       home.select.bg     pos=0.000061  size=97脳43      锛?2 涓诞鐐癸紝0 涓?NaN 鉁擄級
//       home.select.label  pos=0.000061  size=59脳40      锛?2 涓诞鐐癸紝0 涓?NaN 鉁擄級
//       settle.btn.bg      **12/12 鍏?NaN** 鉁? settle.btn.label **12/12 鍏?NaN** 鉁?//     鈬?鈽呪槄 **瀛愭帶浠剁殑鐭╁舰涔熺畻涓嶅嚭鏉?鈬?涓€涓儚绱犻兘鐢讳笉鍑烘潵** 鉁?//       锛堚槄 涓?鎸夐挳鑷繁鏁村睆鍛戒腑"鏄?*鍚屼竴涓梾**锛屽彧鏄繖娆″湪瀛愭帶浠堕偅涓€灞?鉁擄級
//
//   鈽?璇硶 鉁擄細`--also=settle.btn.bg=217x60@0,0,settle.btn.label=28x28@0,0`
//     路 鈽?鍊?= `<瀹?x<楂?@<x>,<y>` 鉁擄紙缂?`@` 灏卞彧鍐欏昂瀵搞€佷綅缃啓 0 鉁擄級
//     路 鈽?鍚嶅瓧瑕佸湪**鐖剁骇浣滅敤鍩?*閲岃兘鍞竴鎵惧埌 鉁擄紙鏈。 `settle.btn` 涓嬬殑 `bg`/`label` 鉁擄級
//     路 鈽?瑙勫垯鍚?`--to` 鉁擄細**鍙ˉ NaN/缂哄け** 鉁?鈥斺€?鏈夊€肩殑涓€涓瓧涓嶅姩 鉁?const ALSO = (argOf('also') || '').split(';').map((s) => s.trim()).filter(Boolean).map((spec) => {
  const [name, val] = spec.split('=');
  if (!name || !val) { console.error('鉂?--also 璇硶锛氬悕瀛?<瀹?x<楂?@<x>,<y>'); process.exit(7); }
  const m = /^([\d.]+)x([\d.]+)(?:@(-?[\d.]+),(-?[\d.]+))?$/.exec(val.trim());
  if (!m) { console.error('鉂?--also 鐨勫€肩湅涓嶆噦锛? + val); process.exit(7); }
  return { name: name.trim(), w: Number(m[1]), h: Number(m[2]),
           x: m[3] !== undefined ? Number(m[3]) : 0, y: m[4] !== undefined ? Number(m[4]) : 0 };
});

// 鎶婁竴涓姸鎬佸潡鎽婂钩鎴?path(涓嶅惈鍧楀簭鍙? 鈫?wt5 瀛楁 鐨勬槧灏?function floats_(blk) {
  const m = new Map();
  (function w(fs, p) {
    for (const f of fs) {
      if (f.wt === 5) m.set(p + '/#' + f.field, f);
      if (f.sub) w(f.sub, p + '/#' + f.field);
    }
  })(blk.sub, '');
  return m;
}

// 鈽?缁欎竴鏉¤褰曡ˉ娴偣锛堚槄 鍙ˉ NaN/缂哄け 鉁擄級
//   路 鍘熷瀷鏈夊悓璺緞 鈬?鎶勫師鍨嬬殑鍊?鉁?//   路 鍘熷瀷娌℃湁 / 鎯冲己鍒?鈬?鐢?`over`锛堜竴寮?path鈫掑€?鐨勮〃 鉁擄級
function fillOne(target, proto, over, tag) {
  let n = 0;
  const nBlocks = Math.min(proto ? proto.states.length : target.states.length, target.states.length);
  for (let i = 0; i < nBlocks; i++) {
    const a = proto ? floats_(proto.states[i]) : new Map();
    const b = floats_(target.states[i]);
    for (const [p, bs] of b) {
      if (Number.isFinite(bs.f)) continue;              // 鈽?鏈夊€间笉鍔?鉁?      let v = null;
      if (over && over.has(p)) v = over.get(p);         // 鈽?over 浼樺厛 鉁?      else if (a.has(p) && Number.isFinite(a.get(p).f)) v = a.get(p).f;
      if (v === null) continue;                          // 鈽?涓よ竟閮芥病鏈?鈬?涓嶅姩 鉁?      detail.push('blk' + i + ' ' + tag + ' ' + p + ' : ' + bs.f + ' 鈫?' + v);
      bs.f = v; n++;
    }
  }
  return n;
}

let filled = 0, kept = 0, missing = 0;
const detail = [];
const nBlocks = Math.min(src.states.length, dst.states.length);
if (src.states.length !== dst.states.length) {
  console.error('鉂?鐘舵€佸潡鏁伴噺涓嶅悓锛氬師鍨?' + src.states.length + ' 鐩爣 ' + dst.states.length);
  process.exit(4);
}
// 鈽?鐩爣鐨勬诞鐐硅矾寰?鈫?鍊硷紙鍙垪 `over` 閲岀偣鍚嶇殑 鉁擄級
const overOf = (paths) => {
  const m = new Map();
  for (const p of paths) m.set(p, null);
  return m;
};
// 鈽?鐩爣鑷繁锛氬彧琛?甯冨眬娴偣"锛坄#504`/`#505` **涓嶇** 鉁?鈥斺€?閭ｆ槸鑴氭湰/宸ュ叿鍐欒繘鍘荤殑姝ｇ‘鍊?鉁擄級
for (let i = 0; i < nBlocks; i++) {
  const a = floats_(src.states[i]);
  const b = floats_(dst.states[i]);
  for (const [p, bs] of b) {
    if (p.indexOf('/#504/') === 0 || p.indexOf('/#505/') === 0) { kept++; continue; }
    if (Number.isFinite(bs.f)) { kept++; continue; }          // 鈽?鏈夊€煎氨涓嶅姩 鉁?    const as = a.get(p);
    if (!as || !Number.isFinite(as.f)) { missing++; continue; }  // 鈽?鍘熷瀷涔熸病鏈?鈬?涓嶅姩锛岃璐?鉁?    detail.push('blk' + i + ' ' + TO + ' ' + p + ' : ' + bs.f + ' 鈫?' + as.f);
    bs.f = as.f;
    filled++;
  }
}

// 鈽呪槄鈽?瀛愭帶浠讹紙`--also`锛夛細鈽?瀹冧滑鐨?`#504`/`#505` **涔熻琛?* 鉁?鈥斺€?瀹冧滑鏈潵灏辨槸 NaN 鉁?//   鈿狅笍 `readGil` 鐨勮褰?*娌℃湁** `children` 瀛楁 鉁?鈥斺€?鈽?瀛愭帶浠惰鎸?*瀛愬垪琛?*鍙?鉁擄紙韪╄繃涓€娆?鉁擄級
const kidsOf = (rec) => {
  const cl = findChildListTop(rec.field.sub);
  return cl ? (asIdList(cl.payload, true) || []).map((i) => byId.get(Number(i))).filter(Boolean) : [];
};
for (const spec of ALSO) {
  const dstKid = kidsOf(dst).find((c) => c.name === spec.name);
  if (!dstKid) { console.error('鉂?鐩爣 ' + TO + ' 涓嬮潰鎵句笉鍒板瓙鎺т欢 ' + spec.name); process.exit(8); }
  const protoKid = kidsOf(src).find((c) => c.name === spec.name) || null;
  // 鈽?over锛氫綅缃?灏哄鐢?*鐐瑰悕缁欑殑鍊?* 鉁擄紙鐩稿鎸夐挳涓績 鉁擄級锛涘叾浣欒蛋鍘熷瀷 鉁?  const over = new Map([
    ['/#504/#501', spec.x], ['/#504/#502', spec.y],
    ['/#505/#501', spec.w], ['/#505/#502', spec.h],
  ]);
  const n = fillOne(dstKid, protoKid, over, TO + '.' + spec.name);
  console.log('    鈹?' + spec.name + '锛氳ˉ ' + n + ' 涓紙pos ' + spec.x + ',' + spec.y + ' size ' + spec.w + '脳' + spec.h + '锛?);
  filled += n;
}

console.log('鍘熷瀷 ' + FROM + ' #' + src.id + ' 鈫?鐩爣 ' + TO + ' #' + dst.id);
console.log('  琛ヤ笂 ' + filled + ' 涓诞鐐?/ 淇濇寔 ' + kept + ' 涓?/ 鍘熷瀷涔熸病鏈?' + missing + ' 涓?);
for (const d of detail.slice(0, 16)) console.log('    ' + d);
if (detail.length > 16) console.log('    鈥︼紙鍏?' + detail.length + ' 鏉★級');

if (DRY) { console.log('--dry锛氫笉鍐欐枃浠?鉁?); process.exit(0); }
if (filled === 0) { console.log('锛堟病鏈夐渶瑕佽ˉ鐨?鉁?涓嶅啓鏂囦欢锛?); process.exit(0); }

const rep = writeGil(g, path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT), {
  label: '琛ョ姸鎬佸潡娴偣锛? + TO + ' 鈫?' + FROM,
  assert: (g2) => {
    const bad = [];
    const s2 = g2.byName.get(FROM), d2 = g2.byName.get(TO);
    // 鈶?鐩爣閲?NaN/缂哄け鐨勫竷灞€娴偣搴斿綋**涓€涓笉鍓?* 鉁擄紙#504/#505 闄ゅ锛?    let left = 0;
    for (let i = 0; i < d2.states.length; i++) {
      const a = floats_(s2.states[i]), b = floats_(d2.states[i]);
      for (const [p, bs] of b) {
        if (p.indexOf('/#504/') === 0 || p.indexOf('/#505/') === 0) continue;
        if (!Number.isFinite(bs.f) && a.has(p) && Number.isFinite(a.get(p).f)) left++;
      }
    }
    if (left > 0) bad.push('鍥炶浠嶆湁 ' + left + ' 涓琛ユ病琛ョ殑娴偣');
    // 鈶?浣嶇疆/灏哄蹇呴』**涓€浣嶄笉鍙?* 鉁擄紙鈽?鍙煡鐩爣鑷繁 鉁?鈥斺€?瀛愭帶浠剁殑 #504/#505 鏄湰杞€愭晠鎰忋€戣ˉ鐨?鉁擄級
    const geom = (r) => r.states.map((blk) => {
      const pair = (n) => { const p = blk.sub.find((x) => x.field === n); if (!p || !p.sub) return 'null';
        return p.sub.filter((x) => x.wt === 5).map((x) => x.f).join(','); };
      return pair(504) + '|' + pair(505);
    }).join('  ');
    const before = geom(dst), after = geom(d2);
    if (before !== after) bad.push('鐩爣鍑犱綍琚敼鍔ㄤ簡 鉁?' + before + ' 鈫?' + after);
    // 鈶?鍘熷瀷蹇呴』**涓€瀛楁湭鍔?* 鉁擄紙鈽?鍚畠鐨勫瓙鎺т欢 鉁擄級
    if (geom(src) !== geom(s2)) bad.push('鍘熷瀷琚敼鍔ㄤ簡 鉁?);
    for (const spec of ALSO) {
      const k0 = (src.children || []).find((c) => c && c.name === spec.name);
      const k1 = (s2.children || []).find((c) => c && c.name === spec.name);
      if (k0 && k1 && geom(k0) !== geom(k1)) bad.push('鍘熷瀷鐨勫瓙鎺т欢 ' + spec.name + ' 琚敼鍔ㄤ簡 鉁?);
      const d0 = (dst.children || []).find((c) => c && c.name === spec.name);
      const d1 = (d2.children || []).find((c) => c && c.name === spec.name);
      if (!d1) { bad.push('瀛愭帶浠?' + spec.name + ' 鍥炶涓嶅埌'); continue; }
      // 鈽?瀛愭帶浠剁殑鐭╁舰蹇呴』**涓嶅啀鏈?NaN** 鉁?鈥斺€?杩欐鏄湰杞殑鐩殑 鉁?      let nan = 0;
      const fb = floats_(d1.states[0]);
      for (const [, f] of fb) if (!Number.isFinite(f.f)) nan++;
      if (nan > 0) bad.push('瀛愭帶浠?' + spec.name + ' 鍥炶浠嶆湁 ' + nan + ' 涓?NaN');
    }
    return bad.length ? bad.join('锛?) : true;
  },
});
console.log('  杈撳嚭锛? + path.basename(OUT) + '锛? + rep.bytes + ' 瀛楄妭锛岃褰?' + rep.recs + ' 鏉★紝瀛楁宸紓 ' + rep.diffs + ' 澶勶級');
