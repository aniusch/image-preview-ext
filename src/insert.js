'use strict';

// The other direction: turn image files, pasted images, and dropped images
// into base64 / data URI text.

const path = require('path');
const vscode = require('vscode');
const { sniffMime, humanSize, IMAGE_EXTS, MAX_IMAGE_BYTES } = require('./detect');

const IMAGE_PATH_RE = new RegExp(`\\.(${IMAGE_EXTS.join('|')})$`, 'i');

function config() {
  return vscode.workspace.getConfiguration('imagePreview');
}

function encode(image, format) {
  const b64 = image.buffer.toString('base64');
  return format === 'base64' ? b64 : `data:${image.mime};base64,${b64}`;
}

async function readImage(uri) {
  const buffer = Buffer.from(await vscode.workspace.fs.readFile(uri));
  const mime = sniffMime(buffer, uri.path);
  if (!mime) throw new Error(`${path.basename(uri.path)} is not an image`);
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`${path.basename(uri.path)} is larger than ${humanSize(MAX_IMAGE_BYTES)}`);
  }
  return { buffer, mime };
}

// "Insert Image as Base64…": a selected path to an image file is replaced by
// the image; otherwise pick files. Every cursor gets the text.
async function insertImage() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const selected = editor.document.getText(editor.selection).trim().replace(/^["'`]|["'`]$/g, '');
  let uris = selected ? await resolveImagePath(editor.document, selected) : null;
  if (!uris) {
    uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: 'Insert',
      filters: { Images: IMAGE_EXTS },
      defaultUri: folderOf(editor.document),
    });
  }
  if (!uris || !uris.length) return;
  let text;
  try {
    const images = await Promise.all(uris.map(readImage));
    text = images.map((image) => encode(image, config().get('insertFormat', 'dataUri'))).join('\n');
  } catch (e) {
    vscode.window.showWarningMessage(e.message);
    return;
  }
  await editor.edit((edit) => {
    for (const selection of editor.selections) edit.replace(selection, text);
  });
}

// [uri] when `text` names an existing image file, absolute or relative to the
// document or a workspace folder; else null.
async function resolveImagePath(document, text) {
  if (!IMAGE_PATH_RE.test(text) || text.includes('\n')) return null;
  const candidates = [];
  if (path.isAbsolute(text)) {
    candidates.push(vscode.Uri.file(text));
  } else {
    if (document.uri.scheme !== 'untitled') candidates.push(vscode.Uri.joinPath(document.uri, '..', text));
    for (const folder of vscode.workspace.workspaceFolders || []) candidates.push(vscode.Uri.joinPath(folder.uri, text));
  }
  for (const uri of candidates) {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type & vscode.FileType.File) return [uri];
    } catch (_e) {
      // Not here; try the next candidate.
    }
  }
  return null;
}

function folderOf(document) {
  if (document.uri.scheme === 'file') return vscode.Uri.joinPath(document.uri, '..');
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length ? folders[0].uri : undefined;
}

// Explorer → "Copy as Data URI" on one or more image files.
async function copyFileAsDataUri(uri, uris) {
  const targets = uris && uris.length ? uris : uri ? [uri] : [];
  if (!targets.length) return;
  try {
    const images = await Promise.all(targets.map(readImage));
    const text = images.map((image) => encode(image, 'dataUri')).join('\n');
    await vscode.env.clipboard.writeText(text);
    vscode.window.setStatusBarMessage(`Copied data URI (${humanSize(text.length)})`, 3000);
  } catch (e) {
    vscode.window.showWarningMessage(e.message);
  }
}

// ---- Paste and drop ----------------------------------------------------------

// Images carried by a paste or drop: image data first (screenshots, images
// dragged from a browser), else image files from a uri-list.
async function imagesFrom(dataTransfer, token) {
  const images = [];
  let uriList;
  for (const [mime, item] of dataTransfer) {
    if (mime === 'text/uri-list') uriList = item;
    if (!mime.startsWith('image/')) continue;
    const file = item.asFile();
    if (!file) continue;
    const buffer = Buffer.from(await file.data());
    if (token.isCancellationRequested) return [];
    if (buffer.length && buffer.length <= MAX_IMAGE_BYTES) {
      images.push({ buffer, mime: sniffMime(buffer, file.name) || mime });
    }
  }
  if (images.length || !uriList) return images;
  const uris = (await uriList.asString())
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => vscode.Uri.parse(line.trim()))
    .filter((uri) => IMAGE_PATH_RE.test(uri.path));
  for (const uri of uris) {
    if (token.isCancellationRequested) return [];
    try {
      images.push(await readImage(uri));
    } catch (_e) {
      // Unreadable or too large: leave it to the other drop/paste options.
    }
  }
  return images;
}

// Edits for both formats, the configured one first. They yield to plain text,
// file paths, and Markdown's own image handling, so pasting text or dropping a
// file into a document works as before and these show up in the paste/drop
// menu; a pasted screenshot, which nothing else handles, is inserted directly.
function editsFor(images, EditClass, kinds) {
  const Kind = vscode.DocumentDropOrPasteEditKind;
  const yieldTo = [Kind.Empty.append('text'), Kind.Empty.append('uri'), Kind.Empty.append('markdown')];
  const what = images.length === 1 ? 'image' : `${images.length} images`;
  const formats = config().get('insertFormat', 'dataUri') === 'base64'
    ? ['base64', 'dataUri']
    : ['dataUri', 'base64'];
  return formats.map((format) => {
    const title = format === 'dataUri' ? `Insert ${what} as data URI` : `Insert ${what} as base64`;
    const edit = new EditClass(images.map((image) => encode(image, format)).join('\n'), title, kinds[format]);
    edit.yieldTo = yieldTo;
    return edit;
  });
}

function registerPasteAndDrop(context) {
  const Kind = vscode.DocumentDropOrPasteEditKind;
  // Older editors lack the paste API and edit kinds; they keep the command
  // and the explorer action.
  if (!Kind || !vscode.languages.registerDocumentPasteEditProvider) return;
  const kinds = {
    dataUri: Kind.Empty.append('imagePreview', 'dataUri'),
    base64: Kind.Empty.append('imagePreview', 'base64'),
  };
  const enabled = () => config().get('pasteAndDrop', true);
  const selector = { scheme: '*', language: '*' };

  context.subscriptions.push(
    vscode.languages.registerDocumentPasteEditProvider(selector, {
      async provideDocumentPasteEdits(_document, _ranges, dataTransfer, _context, token) {
        if (!enabled()) return undefined;
        const images = await imagesFrom(dataTransfer, token);
        return images.length ? editsFor(images, vscode.DocumentPasteEdit, kinds) : undefined;
      },
    }, {
      providedPasteEditKinds: Object.values(kinds),
      pasteMimeTypes: ['image/*', 'text/uri-list'],
    }),
    vscode.languages.registerDocumentDropEditProvider(selector, {
      async provideDocumentDropEdits(_document, _position, dataTransfer, token) {
        if (!enabled()) return undefined;
        const images = await imagesFrom(dataTransfer, token);
        return images.length ? editsFor(images, vscode.DocumentDropEdit, kinds) : undefined;
      },
    }, {
      providedDropEditKinds: Object.values(kinds),
      dropMimeTypes: ['image/*', 'text/uri-list', 'files'],
    })
  );
}

module.exports = { insertImage, copyFileAsDataUri, registerPasteAndDrop, imagesFrom, editsFor };
