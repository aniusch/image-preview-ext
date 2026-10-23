'use strict';
// Regenerates icon.png and the README screenshot in images/ with headless
// Chrome. The screenshot uses a synthetic picture (no real faces) and mirrors
// the hover the extension renders: a 300px thumbnail plus the caption line.
// Run: node scripts/images.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { humanSize, imageSize, fitWithin } = require('../src/detect');

const ROOT = path.join(__dirname, '..');
const CHROME = process.env.CHROME || 'google-chrome';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'image-preview-images-'));

function shoot(html, out, width, height, scale) {
  const page = path.join(TMP, path.basename(out) + '.html');
  fs.writeFileSync(page, html);
  execFileSync(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    '--default-background-color=00000000',
    `--force-device-scale-factor=${scale}`,
    `--window-size=${width},${height}`,
    `--screenshot=${out}`,
    `file://${page}`,
  ], { stdio: 'ignore' });
  console.log('wrote', path.relative(ROOT, out));
}

const bare = (body) => `<html><body style="margin:0;background:transparent">${body}</body></html>`;

// ---- Icon -----------------------------------------------------------------

const svg = path.join(ROOT, 'images', 'icon.svg');
shoot(bare(`<img src="file://${svg}" width="256" height="256" style="display:block">`),
  path.join(ROOT, 'icon.png'), 256, 256, 1);

// ---- Synthetic picture for the payload -------------------------------------

const PICTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2b3a67"/><stop offset="0.55" stop-color="#e07a5f"/><stop offset="1" stop-color="#f2cc8f"/>
    </linearGradient>
    <linearGradient id="lake" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f2cc8f" stop-opacity="0.7"/><stop offset="1" stop-color="#2b3a67"/>
    </linearGradient>
  </defs>
  <rect width="600" height="400" fill="url(#sky)"/>
  <circle cx="420" cy="150" r="44" fill="#fde68a"/>
  <path d="M0 260 L90 170 L160 225 L250 120 L350 230 L430 180 L520 240 L600 190 L600 290 L0 290 Z" fill="#3d405b"/>
  <path d="M0 290 L70 240 L150 275 L230 215 L330 280 L420 245 L520 285 L600 255 L600 300 L0 300 Z" fill="#2a2c45"/>
  <rect y="300" width="600" height="100" fill="url(#lake)"/>
  <rect x="380" y="318" width="80" height="4" rx="2" fill="#fde68a" opacity="0.6"/>
  <rect x="395" y="336" width="50" height="3" rx="1.5" fill="#fde68a" opacity="0.4"/>
</svg>`;
const pictureSvg = path.join(TMP, 'picture.svg');
fs.writeFileSync(pictureSvg, PICTURE);
const picturePng = path.join(TMP, 'picture.png');
shoot(bare(`<img src="file://${pictureSvg}" width="600" height="400" style="display:block">`),
  picturePng, 600, 400, 1);
const picture = fs.readFileSync(picturePng);
const b64 = picture.toString('base64');

// ---- Hero: editor + hover ---------------------------------------------------

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const k = (s) => `<span class="k">"${esc(s)}"</span>`;
const v = (s) => `<span class="s">"${esc(s)}"</span>`;
const LINES = [
  '{',
  `  ${k('id')}: ${v('usr_8f3a21')},`,
  `  ${k('name')}: ${v('Ada Martins')},`,
  `  ${k('role')}: ${v('admin')},`,
  `  ${k('avatar')}: <span class="s hovered">"${b64.slice(0, 160)}</span>`,
  `  ${k('thumbnail')}: ${v('https://cdn.example.com/u/8f3a21/thumb')},`,
  `  ${k('createdAt')}: ${v('2026-10-20T14:32:07Z')},`,
  `  ${k('verified')}: <span class="b">true</span>`,
  '}',
];

const size = imageSize(picture);
const thumb = fitWithin(size, 300, 160);
const caption = `image/png · ${size.width}×${size.height} · ${humanSize(picture.length)} · base64`;
const actions = ['⧉ Open full', '🖫 Save', '⎘ Data URI', '⎘ Base64', '↗ External']
  .map((label) => `<a>${label}</a>`)
  .join('');
const hero = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; width: 1100px; height: 620px; overflow: hidden;
    background: #1f1f1f; color: #cccccc;
    font: 14px/21px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .tabs { height: 36px; background: #181818; border-bottom: 1px solid #2b2b2b; display: flex;
    font: 13px system-ui, sans-serif; }
  .tab { padding: 0 16px; display: flex; align-items: center; gap: 8px; color: #9d9d9d;
    border-right: 1px solid #2b2b2b; }
  .tab.active { background: #1f1f1f; color: #ffffff; box-shadow: inset 0 1px 0 #0078d4; }
  .tab .dot { color: #cbcb41; font-weight: 700; }
  .crumbs { height: 22px; padding: 0 20px; color: #9d9d9d; font: 12px/22px system-ui, sans-serif; }
  .editor { position: relative; padding-top: 4px; }
  .row { display: flex; white-space: pre; }
  .ln { width: 56px; padding-right: 18px; text-align: right; color: #6e7681; flex: none; }
  .row.cur .ln { color: #cccccc; }
  .row.cur { background: #ffffff08; }
  .k { color: #9cdcfe; } .s { color: #ce9178; } .b { color: #569cd6; }
  .hovered { text-decoration: underline; text-decoration-color: #ce917880; }
  .hover { position: absolute; left: 236px; top: 110px; padding: 8px 10px 6px;
    background: #202020; border: 1px solid #454545; border-radius: 4px;
    box-shadow: 0 4px 18px #000a; font: 13px/19px system-ui, sans-serif; }
  .hover img { display: block; margin-bottom: 8px; }
  .hover .cap { color: #cccccc; }
  .hover .actions { display: flex; gap: 14px; margin-top: 4px; }
  .hover a { color: #4daafc; text-decoration: none; }
  .cursor { position: absolute; left: 372px; top: 92px; width: 2px; height: 21px; background: #aeafad; }
</style></head><body>
  <div class="tabs">
    <div class="tab active"><span class="dot">{}</span> user.response.json</div>
    <div class="tab"><span class="dot">{}</span> fixtures.json</div>
  </div>
  <div class="crumbs">api › snapshots › user.response.json › avatar</div>
  <div class="editor">
    ${LINES.map((line, i) => `<div class="row${i === 4 ? ' cur' : ''}"><span class="ln">${i + 1}</span><span>${line}</span></div>`).join('')}
    <div class="cursor"></div>
    <div class="hover">
      <img src="data:image/png;base64,${b64}" width="${thumb.width}" height="${thumb.height}" alt="">
      <div class="cap">${caption}</div>
      <div class="actions">${actions}</div>
    </div>
  </div>
</body></html>`;
shoot(hero, path.join(ROOT, 'images', 'hover.png'), 1100, 420, 2);

fs.rmSync(TMP, { recursive: true, force: true });
