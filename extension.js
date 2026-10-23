'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const {
  tokenAt,
  classify,
  decodeInline,
  mimeExt,
  imageSize,
  fitWithin,
  describeImage,
  humanSize,
  MAX_IMAGE_BYTES,
} = require('./src/detect');
const { createStore } = require('./src/store');
const { GutterThumbnails } = require('./src/gutter');
const { showAllImages } = require('./src/gallery');
const { insertImage, copyFileAsDataUri, registerPasteAndDrop } = require('./src/insert');

// Hover thumbnail box. VS Code caps a hover at max(editor height / 4, 250px),
// so the image plus two text lines must fit in 250px or the links scroll away.
const THUMB_MAX_WIDTH = 300;
const THUMB_MAX_HEIGHT = 160;
const FETCH_TIMEOUT_MS = 6000; // abort slow remote image fetches
const URL_CACHE_MAX = 100; // remembered URL fetch results per session

const store = createStore();

function activate(context) {
  const selector = { scheme: '*', language: '*' };
  store.clearStale();

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
    ),
    vscode.commands.registerCommand('imagePreview.saveAs', (arg) => saveAs(arg)),
    vscode.commands.registerCommand('imagePreview.copyDataUri', (arg) =>
      copy(arg, 'dataUri')
    ),
    vscode.commands.registerCommand('imagePreview.copyBase64', (arg) =>
      copy(arg, 'base64')
    ),
    vscode.commands.registerCommand('imagePreview.openExternal', (arg) =>
      openExternal(arg)
    ),
    vscode.commands.registerCommand('imagePreview.showAllImages', () =>
      showAllImages(store)
    ),
    vscode.commands.registerCommand('imagePreview.insertImage', () => insertImage()),
    vscode.commands.registerCommand('imagePreview.copyFileAsDataUri', (uri, uris) =>
      copyFileAsDataUri(uri, uris)
    )
  );

  const gutter = new GutterThumbnails(store);
  context.subscriptions.push(
    gutter,
    vscode.commands.registerCommand('imagePreview.toggleGutterThumbnails', () =>
      vscode.workspace
        .getConfiguration('imagePreview')
        .update('gutterThumbnails', !gutter.enabled(), vscode.ConfigurationTarget.Global)
    ),
    vscode.window.onDidChangeVisibleTextEditors(() => gutter.schedule(0)),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (vscode.window.visibleTextEditors.some((e) => e.document === event.document)) {
        gutter.schedule();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('imagePreview.gutterThumbnails')) gutter.schedule(0);
    })
  );
  gutter.schedule(0);

  registerPasteAndDrop(context);
}

function deactivate() {
  store.clear();
}

// ---- Image resolution -----------------------------------------------------

// Resolve a classified token to raw bytes + mime, fetching remote URLs.
async function resolveImage(info, token) {
  if (info.kind === 'base64' || info.kind === 'dataUri') {
    const source = info.kind === 'base64' ? 'base64' : 'data uri';
    return { buffer: decodeInline(info, token.value), mime: info.mime, source };
  }
  if (info.kind === 'url') {
    if (!urlPreviewEnabled()) return null;
    const fetched = await fetchImageCached(info.url);
    if (!fetched) return null;
    return { ...fetched, source: 'remote' };
  }
  return null;
}

function urlPreviewEnabled() {
  return vscode.workspace
    .getConfiguration('imagePreview')
    .get('previewUrls', true);
}

// Per-session cache of URL -> { buffer, mime } (positive) or null (confirmed
// non-image). Avoids re-fetching on every hover over the same URL. Transient
// network failures are NOT cached so they can recover on the next hover.
const urlCache = new Map();
async function fetchImageCached(url) {
  if (urlCache.has(url)) return urlCache.get(url);
  const result = await fetchImage(url); // {buffer,mime} | null | undefined(=transient)
  if (result !== undefined) {
    if (urlCache.size >= URL_CACHE_MAX) urlCache.delete(urlCache.keys().next().value);
    urlCache.set(url, result);
  }
  return result || null;
}

// Returns {buffer,mime} on success, null when the URL is confirmed to be a
// non-image (or too big), and undefined on a transient error/timeout.
async function fetchImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal });
    if (!res.ok) return null;
    const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!mime.startsWith('image/')) return null;
    const len = Number(res.headers.get('content-length') || 0);
    if (len && len > MAX_IMAGE_BYTES) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) return null;
    return { buffer, mime };
  } catch (_e) {
    return undefined; // network error / timeout — don't cache, allow retry
  } finally {
    clearTimeout(timer);
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
  if (resolved.buffer.length > MAX_IMAGE_BYTES) return null;

  const range = new vscode.Range(
    document.positionAt(token.start),
    document.positionAt(token.end)
  );

  const file = store.write(resolved.buffer, resolved.mime);
  const size = imageSize(resolved.buffer);
  const arg = { file, mime: resolved.mime };

  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  // Reference the image by file URI: a file URI sidesteps the data-URI size
  // ceiling that stopped large images from rendering. The `|width=,height=`
  // suffix is VS Code's markdown image sizing, so the hover shows a thumbnail
  // without re-encoding the image.
  const fit = size ? fitWithin(size, THUMB_MAX_WIDTH, THUMB_MAX_HEIGHT) : null;
  const dimensions = fit ? `|width=${fit.width},height=${fit.height}` : '';
  md.appendMarkdown(`![preview](${vscode.Uri.file(file)}${dimensions})\n\n`);
  md.appendMarkdown(`${describeImage(resolved.buffer, resolved.mime, size)} · ${resolved.source}\n\n`);
  md.appendMarkdown(
    [
      commandLink('$(open-preview) Open full', 'imagePreview.openFull', arg),
      commandLink('$(save) Save', 'imagePreview.saveAs', arg),
      commandLink('$(copy) Data URI', 'imagePreview.copyDataUri', arg),
      commandLink('$(copy) Base64', 'imagePreview.copyBase64', arg),
      commandLink('$(link-external) External', 'imagePreview.openExternal', arg),
    ].join(' &nbsp; ')
  );

  return new vscode.Hover(md, range);
}

function commandLink(label, command, arg) {
  return `[${label}](command:${command}?${encodeURIComponent(JSON.stringify([arg]))})`;
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

// Hover links pass { file, mime } pointing at a decoded temp file.
function loadArg(arg) {
  if (!arg || !arg.file || !fs.existsSync(arg.file)) {
    vscode.window.showWarningMessage('Image is no longer available. Hover it again.');
    return null;
  }
  return { file: arg.file, buffer: fs.readFileSync(arg.file), mime: arg.mime };
}

function openFull(arg) {
  const image = loadArg(arg);
  if (image) openWebview(image.buffer, image.mime);
}

async function saveAs(arg) {
  const image = loadArg(arg);
  if (!image) return;
  const ext = mimeExt(image.mime);
  const name = `image.${ext}`;
  const doc = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document;
  const folder = doc && doc.uri.scheme === 'file'
    ? vscode.Uri.joinPath(doc.uri, '..')
    : vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0].uri;
  const target = await vscode.window.showSaveDialog({
    defaultUri: folder ? vscode.Uri.joinPath(folder, name) : undefined,
    filters: { Image: [ext] },
  });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, image.buffer);
  vscode.window.showInformationMessage(`Saved ${path.basename(target.path)}.`);
}

async function copy(arg, format) {
  const image = loadArg(arg);
  if (!image) return;
  const b64 = image.buffer.toString('base64');
  await vscode.env.clipboard.writeText(format === 'dataUri' ? `data:${image.mime};base64,${b64}` : b64);
  const what = format === 'dataUri' ? 'data URI' : 'base64';
  vscode.window.setStatusBarMessage(`Copied ${what} (${humanSize(b64.length)})`, 3000);
}

function openExternal(arg) {
  const image = loadArg(arg);
  if (image) vscode.env.openExternal(vscode.Uri.file(image.file));
}

// Open a full-size, resizable preview tab for the given image bytes.
function openWebview(buffer, mime) {
  const file = store.write(buffer, mime);
  const panel = vscode.window.createWebviewPanel(
    'imagePreview',
    'Image Preview',
    vscode.ViewColumn.Beside,
    { enableScripts: false, localResourceRoots: [vscode.Uri.file(store.dir)] }
  );
  const src = panel.webview.asWebviewUri(vscode.Uri.file(file));
  panel.webview.html = webviewHtml(src, describeImage(buffer, mime));
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
