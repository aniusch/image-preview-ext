'use strict';

// Small thumbnails in the gutter beside lines that hold an inline image
// (imagePreview.gutterThumbnails). A gutter icon is fixed per decoration type,
// so there is one type per distinct image, disposed once no visible editor
// shows that image.

const crypto = require('crypto');
const vscode = require('vscode');
const { findImages, decodeInline, MAX_IMAGE_BYTES } = require('./detect');

const MAX_PER_EDITOR = 300;
const MAX_TEXT_LENGTH = 32 * 1024 * 1024;
const MAX_REMEMBERED = 1000;

class GutterThumbnails {
  constructor(store) {
    this.store = store;
    this.types = new Map(); // temp file -> decoration type
    this.files = new Map(); // sha1 of token -> temp file
    this.timer = undefined;
  }

  enabled() {
    return vscode.workspace.getConfiguration('imagePreview').get('gutterThumbnails', false);
  }

  schedule(delay = 300) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), delay);
  }

  refresh() {
    const used = new Set();
    const plans = [];
    if (this.enabled()) {
      for (const editor of vscode.window.visibleTextEditors) {
        const ranges = this.rangesFor(editor.document);
        for (const file of ranges.keys()) used.add(file);
        plans.push([editor, ranges]);
      }
    }
    for (const file of used) {
      if (!this.types.has(file)) {
        this.types.set(file, vscode.window.createTextEditorDecorationType({
          gutterIconPath: vscode.Uri.file(file),
          gutterIconSize: 'contain',
        }));
      }
    }
    for (const [editor, ranges] of plans) {
      for (const [file, type] of this.types) editor.setDecorations(type, ranges.get(file) || []);
    }
    for (const [file, type] of this.types) {
      if (!used.has(file)) {
        type.dispose();
        this.types.delete(file);
      }
    }
  }

  // temp file -> ranges, one image per line (the gutter has room for one icon).
  rangesFor(document) {
    const ranges = new Map();
    const text = document.getText();
    if (text.length > MAX_TEXT_LENGTH) return ranges;
    const lines = new Set();
    for (const image of findImages(text, { max: MAX_PER_EDITOR })) {
      const position = document.positionAt(image.start);
      if (lines.has(position.line)) continue;
      const file = this.fileFor(image);
      if (!file) continue;
      lines.add(position.line);
      if (!ranges.has(file)) ranges.set(file, []);
      ranges.get(file).push(new vscode.Range(position, position));
    }
    return ranges;
  }

  fileFor(image) {
    const key = crypto.createHash('sha1').update(image.value).digest('hex');
    if (this.files.has(key)) return this.files.get(key);
    const buffer = decodeInline(image.info, image.value);
    const file = buffer && buffer.length && buffer.length <= MAX_IMAGE_BYTES
      ? this.store.write(buffer, image.info.mime)
      : null;
    if (this.files.size >= MAX_REMEMBERED) this.files.clear();
    this.files.set(key, file);
    return file;
  }

  dispose() {
    clearTimeout(this.timer);
    for (const type of this.types.values()) type.dispose();
    this.types.clear();
  }
}

module.exports = { GutterThumbnails };
