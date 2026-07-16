'use strict';

const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
  tokenAt,
  classify,
  base64Bytes,
  mimeExt,
  humanSize,
} = require('./src/detect');

const MAX_BYTES = 16 * 1024 * 1024; // cap on any single image we materialize
const THUMB_MAX = 300; // px, longest edge of the hover thumbnail

function activate(context) {
  const selector = { scheme: '*', language: '*' };

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, {
      provideHover: (document, position) => provideHover(document, position),
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('imagePreview.showSelection', () =>
      showSelection(context)
    ),
    vscode.commands.registerCommand('imagePreview.openFull', (arg) =>
      openFull(arg)
    )
  );
}

function deactivate() {}

// ---- Image resolution -----------------------------------------------------

// Resolve a classified token to raw bytes + mime, fetching remote URLs.
async function resolveImage(info, token) {
  if (info.kind === 'base64') {
    const buf = Buffer.from(token.value.trim(), 'base64');
    return { buffer: buf, mime: info.mime, source: 'base64' };
  }
  if (info.kind === 'dataUri') {
    const body = info.dataUri.slice(info.dataUri.indexOf(',') + 1);
    return { buffer: Buffer.from(body, 'base64'), mime: info.mime, source: 'data uri' };
  }
  if (info.kind === 'url') {
    const fetched = await fetchImage(info.url);
    if (!fetched) return null;
    return { ...fetched, source: 'remote' };
  }
  return null;
}

async function fetchImage(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!mime.startsWith('image/')) return null;
    const len = Number(res.headers.get('content-length') || 0);
    if (len && len > MAX_BYTES) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_BYTES) return null;
    return { buffer, mime };
  } catch (_e) {
    return null;
  }
}

// Write bytes to a stable temp file (named by content hash so identical images
// are only written once) and return its path. VSCode hovers render local image
// files by file URI without the length limit that caps inline data: URIs — the
// reason large base64 blobs failed to preview while small ones worked.
let cacheDir;
function writeTemp(buffer, mime) {
  if (!cacheDir) {
    cacheDir = path.join(os.tmpdir(), 'vscode-inline-image-preview');
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 16);
  const file = path.join(cacheDir, `${hash}.${mimeExt(mime)}`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, buffer);
  return file;
}

// Downscale to a small thumbnail for the hover. Returns { buffer, mime } or null
// when the image is already small, the format is undecodable (webp/svg/ico), or
// jimp errors — callers then fall back to the full-size image.
async function makeThumb(buffer, mime) {
  try {
    const Jimp = require('jimp');
    const img = await Jimp.read(buffer);
    if (Math.max(img.bitmap.width, img.bitmap.height) <= THUMB_MAX) return null;
    img.scaleToFit(THUMB_MAX, THUMB_MAX);
    // Keep PNG for formats that may carry transparency; JPEG is smaller for photos.
    const keepPng = mime === 'image/png' || mime === 'image/gif' || mime === 'image/bmp';
    const outMime = keepPng ? Jimp.MIME_PNG : Jimp.MIME_JPEG;
    return { buffer: await img.getBufferAsync(outMime), mime: outMime };
  } catch (_e) {
    return null;
  }
}

// ---- Hover ----------------------------------------------------------------

async function provideHover(document, position) {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const token = tokenAt(text, offset);
  if (!token) return null;

  const info = classify(token.value);
  if (!info) return null;

  const resolved = await resolveImage(info, token);
  if (!resolved || !resolved.buffer.length) return null;
  if (resolved.buffer.length > MAX_BYTES) return null;

  const range = new vscode.Range(
    document.positionAt(token.start),
    document.positionAt(token.end)
  );

  // Full-size file backs the "open full" command; a downscaled thumbnail is what
  // the hover actually shows so the tooltip stays small.
  const fullFile = writeTemp(resolved.buffer, resolved.mime);
  const thumb = await makeThumb(resolved.buffer, resolved.mime);
  const displayFile = thumb ? writeTemp(thumb.buffer, thumb.mime) : fullFile;

  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  // Reference the image by file URI. Markdown image syntax renders reliably in
  // hovers (HTML <img> shows as literal text), and a file URI sidesteps the
  // data-URI size ceiling that stopped large images from rendering.
  md.appendMarkdown(`![preview](${vscode.Uri.file(displayFile)})\n\n`);
  const args = encodeURIComponent(JSON.stringify([{ file: fullFile, mime: resolved.mime }]));
  md.appendMarkdown(
    `${resolved.mime} · ${humanSize(resolved.buffer.length)} · ${resolved.source} · ` +
    `[Open full](command:imagePreview.openFull?${args})`
  );

  return new vscode.Hover(md, range);
}

// ---- Command / Webview ----------------------------------------------------

async function showSelection(context) {
  const editor = vscode.window.activeTextEditor;
  let candidate = '';
  if (editor) {
    const sel = editor.selection;
    if (!sel.isEmpty) {
      candidate = editor.document.getText(sel).trim();
    } else {
      const text = editor.document.getText();
      const offset = editor.document.offsetAt(sel.active);
      const token = tokenAt(text, offset);
      if (token) candidate = token.value;
    }
  }

  let info = classify(candidate);
  let tokenValue = candidate;
  if (!info) {
    const input = await vscode.window.showInputBox({
      prompt: 'Paste a base64 string, data URI, or image URL to preview',
      value: candidate.slice(0, 200),
    });
    if (!input) return;
    tokenValue = input.trim();
    info = classify(tokenValue);
    if (!info) {
      vscode.window.showWarningMessage(
        'Not a recognizable image (base64 / data URI / image URL).'
      );
      return;
    }
  }

  const resolved = await resolveImage(info, { value: tokenValue });
  if (!resolved || !resolved.buffer.length) {
    vscode.window.showWarningMessage('Could not load that image.');
    return;
  }
  openWebview(resolved.buffer, resolved.mime);
}

// Invoked by the "Open full" hover link. arg = { file, mime }.
function openFull(arg) {
  if (!arg || !arg.file || !fs.existsSync(arg.file)) {
    vscode.window.showWarningMessage('Image is no longer available.');
    return;
  }
  openWebview(fs.readFileSync(arg.file), arg.mime);
}

// Open a full-size, resizable preview tab for the given image bytes.
function openWebview(buffer, mime) {
  const file = writeTemp(buffer, mime); // ensures cacheDir exists
  const panel = vscode.window.createWebviewPanel(
    'imagePreview',
    'Image Preview',
    vscode.ViewColumn.Beside,
    { enableScripts: false, localResourceRoots: [vscode.Uri.file(cacheDir)] }
  );
  const src = panel.webview.asWebviewUri(vscode.Uri.file(file));
  panel.webview.html = webviewHtml(src, `${mime} · ${humanSize(buffer.length)}`);
}

function webviewHtml(src, caption) {
  const safeCaption = String(caption).replace(/[<>&]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])
  );
  return `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSrc(src)} https: data:; style-src 'unsafe-inline';">
<style>
  body { margin: 0; background: var(--vscode-editor-background); color: var(--vscode-foreground);
    font-family: var(--vscode-font-family); display: flex; flex-direction: column;
    align-items: center; gap: 12px; padding: 16px; box-sizing: border-box; }
  .stage { display: flex; align-items: center; justify-content: center; width: 100%; }
  img { max-width: 100%; height: auto;
    background: repeating-conic-gradient(#8883 0% 25%, transparent 0% 50%) 50% / 20px 20px;
    box-shadow: 0 2px 12px #0006; }
  .caption { font-size: 12px; opacity: 0.75; }
</style></head><body>
  <div class="stage"><img src="${src}" alt="preview" /></div>
  <div class="caption">${safeCaption}</div>
</body></html>`;
}

// Origin of a webview URI, for the CSP img-src directive.
function cspSrc(webviewUri) {
  try {
    const u = new URL(String(webviewUri));
    return `${u.protocol}//${u.host}`;
  } catch (_e) {
    return "'self'";
  }
}

module.exports = { activate, deactivate };
