// Pure detection helpers. No dependency on the `vscode` module so this file can
// be unit-tested with plain node.

'use strict';

const path = require('path');

// Largest image we decode, write, or insert.
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

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
// Known non-image resources — skip these so we never fetch a page/asset that
// obviously isn't an image. Extension-less URLs (CDN/S3/signed) fall through and
// are probed by Content-Type at fetch time.
const NON_IMG_EXT_RE =
  /\.(html?|php|aspx?|jsp|js|mjs|cjs|ts|tsx|jsx|vue|css|scss|less|json|xml|ya?ml|md|markdown|txt|csv|tsv|pdf|zip|t?gz|tar|rar|7z|mp[34]|m4a|mov|avi|mkv|webm|wav|ogg|flac|doc|docx|xls|xlsx|ppt|pptx|woff2?|ttf|otf|eot|wasm|exe|dmg|deb|rpm)(\?[^\s]*)?$/i;
const URL_TRAILING_PUNCT_RE = /[.,;:!?]+$/;
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
    // Trim trailing punctuation that commonly abuts a URL in prose/JSON.
    const url = t.replace(URL_TRAILING_PUNCT_RE, '');
    // Definite image extension -> preview without probing.
    if (IMG_EXT_RE.test(url)) return { kind: 'url', url, probe: false };
    // Known non-image resource -> skip (never fetch pages/assets).
    if (NON_IMG_EXT_RE.test(url)) return null;
    // Extension-less URL (CDN/S3/signed) -> candidate; confirm via Content-Type.
    return { kind: 'url', url, probe: true };
  }

  // Raw base64 (no data: prefix) — the shape used by the sample payloads.
  if (t.length >= 32 && BASE64_BODY_RE.test(t)) {
    const mime = base64Mime(t);
    if (mime) return { kind: 'base64', mime, dataUri: `data:${mime};base64,${t}` };
  }

  return null;
}

// Every previewable token in `text`, in document order: { start, end, value,
// info }. Inline images (raw base64, data URIs) always; image URLs only with
// { urls: true }, and only those whose extension says image, so listing never
// needs the network. Tokens are split on the same DELIMITERS as tokenAt.
const TOKEN_RE = /[^"'`\s<>()[\]{}\\|]+/g;
function findImages(text, { urls = false, max = Infinity } = {}) {
  const found = [];
  const re = new RegExp(TOKEN_RE);
  let m;
  while (found.length < max && (m = re.exec(text))) {
    const value = m[0];
    // Base64 and data URIs are long; skip ordinary words cheaply.
    if (value.length < 32 && !(urls && value.startsWith('http'))) continue;
    const info = classify(value);
    if (!info) continue;
    if (info.kind === 'url' && (!urls || info.probe)) continue;
    found.push({ start: m.index, end: m.index + value.length, value, info });
  }
  return found;
}

// Bytes of an inline image (raw base64 or data URI); null for URLs.
function decodeInline(info, value) {
  if (info.kind === 'base64') return Buffer.from(value.trim(), 'base64');
  if (info.kind === 'dataUri') {
    return Buffer.from(info.dataUri.slice(info.dataUri.indexOf(',') + 1), 'base64');
  }
  return null;
}

// Mime type from a file's first bytes, else from its extension.
function sniffMime(buffer, fileName = '') {
  const fromBytes = base64Mime(buffer.subarray(0, 12).toString('base64'));
  if (fromBytes) return fromBytes;
  // SVG may start with whitespace, a comment, or a doctype.
  if (/<svg[\s>]/i.test(buffer.toString('utf8', 0, 1024))) return 'image/svg+xml';
  const ext = path.extname(fileName).slice(1).toLowerCase();
  return EXT_MIME[ext] || null;
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

const EXT_MIME = Object.fromEntries(Object.entries(MIME_EXT).map(([mime, ext]) => [ext, mime]));
EXT_MIME.jpeg = 'image/jpeg';
EXT_MIME.tif = 'image/tiff';
const IMAGE_EXTS = Object.keys(EXT_MIME);

function mimeExt(mime) {
  return MIME_EXT[(mime || '').toLowerCase()] || 'img';
}

// Pixel dimensions read from the image header, or null when the format is
// unknown or the header is malformed. Returns { width, height }.
function imageSize(buf) {
  try {
    if (!buf || buf.length < 10) return null;
    // PNG: IHDR is always the first chunk.
    if (buf.readUInt32BE(0) === 0x89504e47 && buf.length >= 24) {
      return dims(buf.readUInt32BE(16), buf.readUInt32BE(20));
    }
    // GIF: logical screen size right after the signature.
    if (buf.toString('latin1', 0, 3) === 'GIF') {
      return dims(buf.readUInt16LE(6), buf.readUInt16LE(8));
    }
    // JPEG: walk segments until a start-of-frame marker.
    if (buf[0] === 0xff && buf[1] === 0xd8) return jpegSize(buf);
    // WebP: RIFF container with a VP8 / VP8L / VP8X chunk.
    if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
      return webpSize(buf);
    }
    // BMP: BITMAPINFOHEADER; height is negative for top-down bitmaps.
    if (buf[0] === 0x42 && buf[1] === 0x4d && buf.length >= 26) {
      return dims(buf.readInt32LE(18), Math.abs(buf.readInt32LE(22)));
    }
    // ICO: first directory entry; 0 means 256.
    if (buf.readUInt32BE(0) === 0x00000100 && buf.length >= 8) {
      return dims(buf[6] || 256, buf[7] || 256);
    }
    const head = buf.toString('utf8', 0, Math.min(buf.length, 4096));
    if (/<svg[\s>]/i.test(head)) return svgSize(head);
  } catch (_e) {
    // Truncated or corrupt header.
  }
  return null;
}

function dims(width, height) {
  return width > 0 && height > 0 ? { width, height } : null;
}

function jpegSize(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    // SOF0-SOF15, except DHT (C4), JPG (C8), and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return dims(buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5));
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

function webpSize(buf) {
  const chunk = buf.toString('latin1', 12, 16);
  if (chunk === 'VP8 ' && buf.length >= 30) {
    return dims(buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff);
  }
  if (chunk === 'VP8L' && buf.length >= 25) {
    const bits = buf.readUInt32LE(21);
    return dims((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8X' && buf.length >= 30) {
    return dims(buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1);
  }
  return null;
}

// width/height attributes in px (or unitless), else the viewBox size.
function svgSize(head) {
  const tag = head.match(/<svg\b[^>]*>/i);
  if (!tag) return null;
  const attr = (name) => {
    const m = tag[0].match(new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, 'i'));
    return m ? Math.round(parseFloat(m[1])) : 0;
  };
  const width = attr('width');
  const height = attr('height');
  if (width && height) return dims(width, height);
  const box = tag[0].match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  return box ? dims(Math.round(parseFloat(box[1])), Math.round(parseFloat(box[2]))) : null;
}

// Fit (width, height) inside a maxWidth x maxHeight box without upscaling.
function fitWithin(size, maxWidth, maxHeight = maxWidth) {
  const scale = Math.min(1, maxWidth / size.width, maxHeight / size.height);
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

// "image/png · 600×400 · 15.9 KB"
function describeImage(buffer, mime, size = imageSize(buffer)) {
  const parts = [mime];
  if (size) parts.push(`${size.width}×${size.height}`);
  parts.push(humanSize(buffer.length));
  return parts.join(' · ');
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

module.exports = {
  MAX_IMAGE_BYTES,
  IMAGE_EXTS,
  DELIMITERS,
  BASE64_MAGIC,
  tokenAt,
  classify,
  findImages,
  decodeInline,
  sniffMime,
  base64Mime,
  base64Bytes,
  mimeExt,
  imageSize,
  fitWithin,
  describeImage,
  humanSize,
};
