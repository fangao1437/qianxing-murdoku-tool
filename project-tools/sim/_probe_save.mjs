import fs from "node:fs";
const f = process.argv[2];
const j = JSON.parse(fs.readFileSync(f, "utf8"));
const want = new Set(process.argv.slice(3));
const found = [];
(function walk(n) {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) { for (const x of n) walk(x); return; }
  if (n.name && want.has(n.name)) {
    const t = n.transformByPlatform && n.transformByPlatform.KEYBOARD;
    found.push({ name: n.name, id: n.id, guid: n.guid, kind: n.kind,
      off: t ? t.offset : null, size: t ? t.size : null,
      anchorMin: t ? t.anchorMin : null, anchorMax: t ? t.anchorMax : null, pivot: t ? t.pivot : null,
      active: n.active, visible: n.visible,
      raycastTarget: n.raycastTarget, interactable: n.interactable,
      showCursor: n.showCursor, isolateNavigation: n.isolateNavigation,
      disableCursorEventPassthrough: n.disableCursorEventPassthrough,
      children: Array.isArray(n.children) ? n.children.map(c => c.name) : undefined,
      imageId: n.imageId, imageColor: n.imageColor, text: n.text,
    });
  }
  for (const k of Object.keys(n)) walk(n[k]);
})(j);
for (const r of found) console.log(JSON.stringify(r));
