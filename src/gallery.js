'use strict';

// "Show All Images in File": a grid of every image in a document. Clicking a
// card jumps to the image in the editor. The grid follows edits to the file.

const crypto = require('crypto');
const path = require('path');
const vscode = require('vscode');
const {
  findImages,
  decodeInline,
  describeImage,
  MAX_IMAGE_BYTES,
} = require('./detect');

const MAX_IMAGES = 500;
const LABEL_MAX = 48;

function showAllImages(store) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('Open a file to see its images.');
    return;
  }
  const document = editor.document;
  const column = editor.viewColumn;
  const name = path.basename(document.uri.path) || 'file';
  const panel = vscode.window.createWebviewPanel(
    'imagePreview.gallery',
    `Images · ${name}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true, localResourceRoots: [vscode.Uri.file(store.dir)] }
  );

  let images = [];
  const render = () => {
    const urls = vscode.workspace.getConfiguration('imagePreview').get('previewUrls', true);
    images = findImages(document.getText(), { urls, max: MAX_IMAGES + 1 });
    const cards = images.slice(0, MAX_IMAGES).map((image, index) =>
      card(image, index, document, store, panel.webview)
    );
    panel.webview.html = galleryHtml({
      title: name,
      cards,
      truncated: images.length > MAX_IMAGES,
      cspSource: panel.webview.cspSource,
      nonce: crypto.randomBytes(16).toString('base64'),
    });
  };
  render();

  let timer;
  const subscription = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document !== document) return;
    clearTimeout(timer);
    timer = setTimeout(render, 500);
  });
  panel.onDidDispose(() => {
    clearTimeout(timer);
    subscription.dispose();
  });

  panel.webview.onDidReceiveMessage(async (message) => {
    const image = message && message.type === 'reveal' && images[message.index];
    if (!image) return;
    const start = document.positionAt(image.start);
    const shown = await vscode.window.showTextDocument(document, {
      viewColumn: column,
      selection: new vscode.Selection(start, start),
    });
    shown.revealRange(new vscode.Range(start, document.positionAt(image.end)),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  });
}

// { src, meta, label, line } for one image.
function card(image, index, document, store, webview) {
  const position = document.positionAt(image.start);
  const before = document.lineAt(position.line).text.slice(0, position.character)
    .replace(/["'`(]+\s*$/, '').trim();
  const label = before.length > LABEL_MAX ? `…${before.slice(-LABEL_MAX)}` : before;
  const base = { index, label, line: position.line + 1 };
  if (image.info.kind === 'url') {
    return { ...base, src: image.info.url, meta: `remote · ${new URL(image.info.url).host}` };
  }
  const buffer = decodeInline(image.info, image.value);
  if (!buffer || !buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    return { ...base, src: '', meta: `${image.info.mime} · too large or unreadable` };
  }
  const file = store.write(buffer, image.info.mime);
  return {
    ...base,
    src: String(webview.asWebviewUri(vscode.Uri.file(file))),
    meta: `${describeImage(buffer, image.info.mime)} · ${image.info.kind === 'dataUri' ? 'data uri' : 'base64'}`,
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );
}

function galleryHtml({ title, cards, truncated, cspSource, nonce }) {
  const count = cards.length === 1 ? '1 image' : `${cards.length}${truncated ? '+' : ''} images`;
  const grid = cards.map((c) => `
    <button class="card" data-index="${c.index}" title="Go to line ${c.line}">
      <div class="thumb">${c.src ? `<img src="${escapeHtml(c.src)}" alt="" loading="lazy">` : ''}</div>
      <div class="meta">${escapeHtml(c.meta)}</div>
      <div class="where"><span class="line">Line ${c.line}</span>${c.label ? ` <span class="label">${escapeHtml(c.label)}</span>` : ''}</div>
    </button>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { margin: 0; padding: 16px; background: var(--vscode-editor-background);
    color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: 13px; }
  h1 { font-size: 13px; font-weight: 600; margin: 0 0 14px; opacity: 0.85; }
  h1 .count { font-weight: 400; opacity: 0.7; margin-left: 6px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
  .card { display: flex; flex-direction: column; gap: 6px; padding: 8px; text-align: left; cursor: pointer;
    font: inherit; color: inherit; border-radius: 6px;
    background: var(--vscode-editorWidget-background, #0000);
    border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border, #8884)); }
  .card:hover, .card:focus-visible { border-color: var(--vscode-focusBorder); outline: none; }
  .thumb { height: 120px; display: flex; align-items: center; justify-content: center; border-radius: 4px;
    background: repeating-conic-gradient(#8882 0% 25%, transparent 0% 50%) 50% / 16px 16px; overflow: hidden; }
  .thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .meta { font-size: 12px; opacity: 0.85; overflow-wrap: anywhere; }
  .where { font-size: 12px; opacity: 0.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .label { font-family: var(--vscode-editor-font-family); }
  .empty { opacity: 0.7; }
</style></head><body>
  <h1>${escapeHtml(title)}<span class="count">${count}${truncated ? ` (showing the first ${cards.length})` : ''}</span></h1>
  ${cards.length ? `<div class="grid">${grid}</div>` : '<p class="empty">No images in this file.</p>'}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', (event) => {
      const card = event.target.closest('.card');
      if (card) vscode.postMessage({ type: 'reveal', index: Number(card.dataset.index) });
    });
  </script>
</body></html>`;
}

module.exports = { showAllImages, galleryHtml };
