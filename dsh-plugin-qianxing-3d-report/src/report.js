// 3D 场景确认报告：SceneSpec + 设计图 + 俯视预览 + Blender 渲染图 → PDF + placement.json
//
// 目的：把「设计图 / Blender 渲染 / 元件坐标表」整合成一份给用户确认和调整的报告，
// 而不是只留在会话内部当参考。
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH || '',
  '/usr/local/bin/google-chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean)

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
    } catch {
      /* next */
    }
  }
  const which = spawnSync('bash', ['-lc', 'command -v google-chrome || command -v chromium || command -v chromium-browser'], { encoding: 'utf8' })
  const out = (which.stdout || '').trim().split('\n')[0]
  return out || ''
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const fmt = (n, d = 2) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(d) : '—')

function readJsonArg(value) {
  if (value && typeof value === 'object') return { spec: value, file: null }
  if (typeof value === 'string' && value.trim()) {
    const p = path.resolve(value.trim())
    return { spec: JSON.parse(fs.readFileSync(p, 'utf8')), file: p }
  }
  throw new Error('spec 必须是 SceneSpec 对象或 JSON 文件路径')
}

function dataUri(file) {
  const ext = path.extname(file).toLowerCase()
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/png'
  const buf = fs.readFileSync(file)
  return { uri: `data:${mime};base64,${buf.toString('base64')}`, bytes: buf.length }
}

function collectImage(fp, label, warnings) {
  if (!fp || typeof fp !== 'string' || !fp.trim()) return null
  const abs = path.resolve(fp)
  if (!fs.existsSync(abs)) {
    warnings.push(`图片不存在：${abs}`)
    return null
  }
  try {
    const { uri, bytes } = dataUri(abs)
    return { path: abs, label, uri, bytes }
  } catch (err) {
    warnings.push(`图片读取失败：${abs}（${err?.message ?? err}）`)
    return null
  }
}

function buildPlacement(spec) {
  const objects = Array.isArray(spec.objects) ? spec.objects : []
  return objects.map((o, i) => ({
    index: i,
    id: o.id ?? `obj-${i + 1}`,
    kind: o.kind ?? '?',
    x: Array.isArray(o.pos) ? o.pos[0] : null,
    y: Array.isArray(o.pos) ? o.pos[1] : null,
    z: Array.isArray(o.pos) ? o.pos[2] : null,
    rotYDeg: typeof o.rotYDeg === 'number' ? o.rotYDeg : 0,
    size: Array.isArray(o.size) ? { width: o.size[0], height: o.size[1], depth: o.size[2] } : null,
    color: o.color ?? null,
  }))
}

/** 生成 HTML 报告 */
export function buildReportHtml({ spec, designImage, previewImage, renderImages, placement, title }) {
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
  const rooms = Array.isArray(spec.rooms) ? spec.rooms : []
  const walls = Array.isArray(spec.walls) ? spec.walls : []
  const lights = Array.isArray(spec.lights) ? spec.lights : []
  const bounds = spec.bounds ?? {}
  const counts = placement.reduce((acc, o) => {
    acc[o.kind] = (acc[o.kind] || 0) + 1
    return acc
  }, {})

  const imgCard = (img, caption, cls = '') => img
    ? `<figure class="${esc(cls)}"><img src="${img.uri}" alt="${esc(caption)}"><figcaption>${esc(caption)}</figcaption></figure>`
    : ''
  const renderCards = renderImages.map((img) => imgCard(img, img.label, 'render')).join('\n')
  const objectRows = placement.map((o) => `
      <tr>
        <td class="num">${o.index + 1}</td>
        <td>${esc(o.id)}</td>
        <td>${esc(o.kind)}</td>
        <td class="num">${fmt(o.x)}</td>
        <td class="num">${fmt(o.y)}</td>
        <td class="num">${fmt(o.z)}</td>
        <td class="num">${fmt(o.rotYDeg, 1)}°</td>
        <td class="num">${o.size ? `${fmt(o.size.width)}×${fmt(o.size.height)}×${fmt(o.size.depth)}` : '—'}</td>
        <td>${o.color ? `<span class="swatch" style="background:${esc(o.color)}"></span>${esc(o.color)}` : '—'}</td>
      </tr>`).join('')
  const roomRows = rooms.map((r, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td>${esc(r.name ?? r.id ?? '')}</td>
        <td><span class="swatch" style="background:${esc(r.color ?? '#ccc')}"></span>${esc(r.color ?? '')}</td>
        <td class="num">${Array.isArray(r.cells) ? r.cells.length : '—'}</td>
      </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Noto Sans CJK SC", "Droid Sans Fallback", "WenQuanYi Zen Hei", sans-serif; color: #1f2937; font-size: 11px; line-height: 1.55; }
  h1 { font-size: 20px; margin: 0 0 4px; color: #0f172a; }
  h2 { font-size: 14px; margin: 18px 0 8px; padding-left: 8px; border-left: 4px solid #38bdf8; color: #0f172a; }
  .meta { color: #64748b; font-size: 10px; }
  .summary { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 4px; }
  .chip { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px 10px; }
  .chip b { color: #0f172a; }
  .grid2 { display: flex; flex-wrap: wrap; gap: 10px; }
  figure { margin: 0; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px; background: #fff; }
  figure img { display: block; max-width: 100%; height: auto; border-radius: 4px; }
  figcaption { color: #475569; font-size: 10px; margin-top: 4px; text-align: center; }
  figure.half { width: calc(50% - 5px); }
  figure.render { width: calc(50% - 5px); }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 9.5px; }
  th, td { border: 1px solid #cbd5e1; padding: 4px 5px; text-align: left; vertical-align: middle; }
  th { background: #eff6ff; font-weight: 600; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; border: 1px solid #94a3b8; margin-right: 4px; vertical-align: -1px; }
  .note { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 10px 12px; margin-top: 10px; }
  .note b { color: #92400e; }
  .pagebreak { page-break-before: always; }
  code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-size: 9px; }
  ul { margin: 6px 0; padding-left: 18px; }
</style></head>
<body>
  <h1>${esc(title)}</h1>
  <div class="meta">场景：${esc(spec.name ?? '(未命名)')} · 生成时间：${esc(now)} · 单位：米 · 坐标系：原点=场景平面左下角，y 向上</div>

  <div class="summary">
    <span class="chip">房间 <b>${rooms.length}</b></span>
    <span class="chip">物件 <b>${placement.length}</b></span>
    <span class="chip">墙段 <b>${walls.length}</b></span>
    <span class="chip">灯光 <b>${lights.length}</b></span>
    <span class="chip">包围盒 <b>${fmt(bounds.width, 1)}×${fmt(bounds.depth, 1)}</b> m</span>
    ${Object.entries(counts).map(([k, v]) => `<span class="chip">${esc(k)} × ${v}</span>`).join('')}
  </div>

  <h2>1. 设计图 / 俯视预览</h2>
  <div class="grid2">
    ${imgCard(designImage, '设计图（输入）', 'half')}
    ${imgCard(previewImage, '俯视预览（SceneSpec 渲染）', 'half')}
  </div>

  ${renderImages.length > 0 ? `<h2>2. Blender 渲染结果</h2>
  <div class="grid2">
    ${renderCards}
  </div>` : `<h2>2. Blender 渲染结果</h2><div class="note">本次没有提供渲染图（可以先用 <code>scene_build_blender</code> 渲染，再重新生成报告）。</div>`}

  <h2 class="pagebreak">3. 元件坐标表（供确认 / 调整）</h2>
  <table>
    <thead><tr><th>#</th><th>id</th><th>kind</th><th>x</th><th>y</th><th>z</th><th>rotY</th><th>尺寸 w×h×d</th><th>颜色</th></tr></thead>
    <tbody>${objectRows || '<tr><td colspan="9">（没有物件）</td></tr>'}</tbody>
  </table>

  ${rooms.length > 0 ? `<h2>4. 房间</h2>
  <table>
    <thead><tr><th>#</th><th>名称</th><th>颜色</th><th>格数</th></tr></thead>
    <tbody>${roomRows}</tbody>
  </table>` : ''}

  <h2>5. 确认与调整</h2>
  <div class="note">
    <b>这份报告是给你确认和调整用的，不是内部参考资料。</b>
    <ul>
      <li>看第 2 节渲染图，确认摆位、朝向、比例是否符合预期。</li>
      <li>看第 3 节坐标表，需要改哪件就记下它的 <code>id / kind / x / y / z / rotY</code>。</li>
      <li>调整方式：把坐标表反馈给 bot，它会用 <code>scene3d_apply_placement</code> 直接改存档（离线、不经过 Blender/GIA）。</li>
      <li>同目录的 <code>placement.json</code> 与本表一致，可直接作为调整输入。</li>
    </ul>
  </div>
</body></html>`
}

export function buildSceneReportPdf({ spec: specArg, design, preview, renders, outDir, title, root }, _env) {
  const warnings = []
  const { spec, file: specFile } = readJsonArg(specArg)
  const baseDir = root && typeof root === 'string' ? root : process.cwd()
  const outRoot = outDir && String(outDir).trim() ? path.resolve(String(outDir)) : path.join(specFile ? path.dirname(specFile) : baseDir, 'report')
  fs.mkdirSync(outRoot, { recursive: true })

  const designImage = collectImage(typeof design === 'string' ? design : '', '设计图（输入）', warnings)
  const previewImage = collectImage(typeof preview === 'string' ? preview : '', '俯视预览（SceneSpec）', warnings)
  const renderList = Array.isArray(renders) ? renders : []
  const renderImages = []
  renderList.forEach((item, i) => {
    const fp = typeof item === 'string' ? item : item?.path
    const label = (typeof item === 'object' && item?.label) || path.basename(String(fp || `render-${i + 1}`))
    const img = collectImage(fp, label, warnings)
    if (img) renderImages.push(img)
  })

  const placement = buildPlacement(spec)
  const safeTitle = (typeof title === 'string' && title.trim()) || `${spec.name ?? '3D 场景'} · 场景确认报告`
  const html = buildReportHtml({ spec, designImage, previewImage, renderImages, placement, title: safeTitle })

  const htmlPath = path.join(outRoot, 'scene-report.html')
  fs.writeFileSync(htmlPath, html, 'utf8')
  const placementPath = path.join(outRoot, 'placement.json')
  fs.writeFileSync(placementPath, JSON.stringify({ spec: spec.name ?? null, unit: 'm', objects: placement }, null, 2), 'utf8')

  const chrome = findChrome()
  if (!chrome) return { ok: false, error: 'E_NO_CHROME', hint: '服务器没有 Google Chrome/Chromium，无法导出 PDF', htmlPath, placementPath, warnings }

  const pdfPath = path.join(outRoot, 'scene-report.pdf')
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-pdf-header-footer',
    '--virtual-time-budget=4000',
    `--print-to-pdf=${pdfPath}`,
    pathToFileURL(htmlPath).href,
  ]
  const res = spawnSync(chrome, args, { encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 })
  const stderrTail = String(res.stderr || '').slice(-1500)
  const ok = fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 0
  return {
    ok,
    pdf: ok ? pdfPath : null,
    bytes: ok ? fs.statSync(pdfPath).size : 0,
    html: htmlPath,
    placementJson: placementPath,
    images: [
      ...(designImage ? [{ label: designImage.label, path: designImage.path }] : []),
      ...(previewImage ? [{ label: previewImage.label, path: previewImage.path }] : []),
      ...renderImages.map((r) => ({ label: r.label, path: r.path })),
    ],
    rows: placement.length,
    warnings,
    ...(ok ? {} : { error: 'E_PDF_FAILED', chrome, exit: res.status, stderrTail }),
  }
}
