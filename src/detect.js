// Pure detection helpers. No dependency on the `vscode` module so this file can
// be unit-tested with plain node.

'use strict';

// Characters that terminate a base64 / data-uri / url token. Anything NOT in this
// set is considered part of the token when we scan outward from the cursor.
const DELIMITERS = new Set([
  '"', "'", '`', ' ', '\t', '\n', '\r', '<', '>', '(', ')', '[', ']', '{', '}',
  '\\', '|',
]);

// Magic base64 prefixes -> mime type. These are the leading bytes of the file,
// base64-encoded. Because base64 encodes 3 bytes into 4 chars, a fixed byte
// prefix maps to a stable leading substring (modulo the final partial group,
// which we keep short enough to stay stable).
const BASE64_MAGIC = [
  ['/9j/', 'image/jpeg'],
  ['iVBORw0KGgo', 'image/png'],
  ['R0lGODdh', 'image/gif'],
  ['R0lGODlh', 'image/gif'],
  ['UklGR', 'image/webp'], // RIFF (webp container)
  ['Qk', 'image/bmp'], // BM
  ['AAABAA', 'image/x-icon'],
  ['PHN2Zy', 'image/svg+xml'], // "<svg"
  ['PHN2Zw', 'image/svg+xml'],
  ['PD94bWw', 'image/svg+xml'], // "<?xml"
];

const DATA_URI_RE = /^data:image\/[\w.+-]+;base64,/i;
const URL_RE = /^https?:\/\/[^\s]+$/i;
const IMG_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif|tiff?)(\?[^\s]*)?$/i;
const BASE64_BODY_RE = /^[A-Za-z0-9+/]+={0,2}$/;

// Expand from `offset` in `text` outward until hitting a delimiter, returning the
// enclosed token plus its [start, end) bounds. Handles very long tokens (base64
// blobs spanning tens of thousands of chars) via a simple linear scan.
function tokenAt(text, offset) {
  if (offset < 0 || offset > text.length) return null;
  let start = offset;
  let end = offset;
  // If we're sitting exactly on a delimiter, nudge left one so a hover at the
  // closing quote still resolves the token.
  if (start > 0 && (start >= text.length || DELIMITERS.has(text[start]))) start--;
  while (start > 0 && !DELIMITERS.has(text[start - 1])) start--;
  while (end < text.length && !DELIMITERS.has(text[end])) end++;
  if (end <= start) return null;
  return { value: text.slice(start, end), start, end };
}

// Classify a raw token into a previewable image descriptor, or null.
// Returns { kind, mime, dataUri?, url? }.
function classify(token) {
  if (!token) return null;
  const t = token.trim();
  if (t.length < 8) return null;

  if (DATA_URI_RE.test(t)) {
    const mime = t.slice(5, t.indexOf(';')).toLowerCase();
    return { kind: 'dataUri', mime, dataUri: t };
  }

  if (URL_RE.test(t)) {
    // Only treat as an image URL if it looks like one; otherwise skip so we
    // don't try to render arbitrary pages. Query strings are tolerated.
    if (IMG_EXT_RE.test(t)) return { kind: 'url', url: t };
    return null;
  }

  // Raw base64 (no data: prefix) — the shape used by the sample payloads.
  if (t.length >= 32 && BASE64_BODY_RE.test(t)) {
    const mime = base64Mime(t);
    if (mime) return { kind: 'base64', mime, dataUri: `data:${mime};base64,${t}` };
  }

  return null;
}

function base64Mime(b64) {
  for (const [prefix, mime] of BASE64_MAGIC) {
    if (b64.startsWith(prefix)) return mime;
  }
  return null;
}

// Approximate decoded byte size of a base64 body (ignoring padding nuances).
function base64Bytes(b64) {
  const len = b64.length;
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((len * 3) / 4) - pad);
}

// File extension for a mime type, used when writing decoded images to disk.
const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/tiff': 'tiff',
};

function mimeExt(mime) {
  return MIME_EXT[(mime || '').toLowerCase()] || 'img';
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

module.exports = {
  DELIMITERS,
  BASE64_MAGIC,
  tokenAt,
  classify,
  base64Mime,
  base64Bytes,
  mimeExt,
  humanSize,
};
