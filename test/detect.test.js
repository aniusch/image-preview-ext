'use strict';

// Plain-node tests for the pure detection logic. Run: npm test
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { tokenAt, classify, base64Mime, base64Bytes, imageSize, fitWithin } = require('../src/detect');

let passed = 0;
function ok(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
  }
}

// --- magic byte detection ---
ok('jpeg magic', () => assert.equal(base64Mime('/9j/4AAQSkZ'), 'image/jpeg'));
ok('png magic', () => assert.equal(base64Mime('iVBORw0KGgoAAAA'), 'image/png'));
ok('gif magic', () => assert.equal(base64Mime('R0lGODlhAQAB'), 'image/gif'));
ok('non-image magic', () => assert.equal(base64Mime('SGVsbG8gd29ybGQ'), null));

// --- image dimensions (7x5 images made with ImageMagick) ---
const FIXTURES = {
  'png': 'iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFAQMAAACzVGSbAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURTNmzP///w3eOY0AAAABYktHRAH/Ai3eAAAAB3RJTUUH6goXFhQXSaNokwAAAAtJREFUCNdjYIABAAAKAAHn+Nr6AAAAAElFTkSuQmCC',
  'gif': 'R0lGODlhBwAFAPAAADNmzAAAACH5BAAAAAAAIf8LSW1hZ2VNYWdpY2sOZ2FtbWE9MC40NTQ1NDUALAAAAAAHAAUAAAIFhI+puwUAOw==',
  'jpeg': '/9j/4AAQSkZJRgABAQAAAAAAAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAAFAAcDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAB//EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAHCP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AC9UAkf/2Q==',
  'progressive jpeg': '/9j/4AAQSkZJRgABAQAAAAAAAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wgARCAAFAAcDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAABv/EABUBAQEAAAAAAAAAAAAAAAAAAAYH/9oADAMBAAIQAxAAAAEvUCP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAn//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AX//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AX//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/An//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAED//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==',
  'bmp': 'Qk0CAQAAAAAAAIoAAAB8AAAABwAAAAUAAAABABgAAAAAAHgAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AAD/AAD/AAAAAAAA/0JHUnMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAzGYzzGYzzGYzzGYzzGYzzGYzzGYzAAAAzGYzzGYzzGYzzGYzzGYzzGYzzGYzAAAAzGYzzGYzzGYzzGYzzGYzzGYzzGYzAAAAzGYzzGYzzGYzzGYzzGYzzGYzzGYzAAAAzGYzzGYzzGYzzGYzzGYzzGYzzGYzAAAA',
  'ico': 'AAABAAEABwUAAAEAIADIAAAAFgAAACgAAAAHAAAACgAAAAEAIAAAAAAAjAAAAAAAAAAAAAAAAAAAAAAAAADMZjP/zGYz/8xmM//MZjP/zGYz/8xmM//MZjP/zGYz/8xmM//MZjP/zGYz/8xmM//MZjP/zGYz/8xmM//MZjP/zGYz/8xmM//MZjP/zGYz/8xmM//MZjP/zGYz/8xmM//MZjP/zGYz/8xmM//MZjP/zGYz/8xmM//MZjP/zGYz/8xmM//MZjP/zGYz/wAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'webp lossy (VP8)': 'UklGRjYAAABXRUJQVlA4ICoAAADQAQCdASoHAAUAAgA0JaACdLoB+AADsAD+7L2P/PTNeYP8nP+3Jl5tsAA=',
  'webp lossless (VP8L)': 'UklGRh4AAABXRUJQVlA4TBEAAAAvBgABAAdQs86Uuf+BiOh/AAA=',
  'webp extended (VP8X)': 'UklGRloAAABXRUJQVlA4WAoAAAAQAAAABgAABAAAQUxQSAoAAAABB1DAiAhERP8DVlA4ICoAAADQAQCdASoHAAUAAgA0JaACdLoB+AADsAD+7L2P/PTNeYP8nP+3Jl5tsAA=',
};
for (const [name, b64] of Object.entries(FIXTURES)) {
  ok(`size ${name}`, () => assert.deepEqual(imageSize(Buffer.from(b64, 'base64')), { width: 7, height: 5 }));
}
ok('size svg width/height', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640px" height="480"></svg>';
  assert.deepEqual(imageSize(Buffer.from(svg)), { width: 640, height: 480 });
});
ok('size svg viewBox', () => {
  const svg = '<?xml version="1.0"?><svg viewBox="0 0 24 16" width="100%"></svg>';
  assert.deepEqual(imageSize(Buffer.from(svg)), { width: 24, height: 16 });
});
ok('size unknown / truncated -> null', () => {
  assert.equal(imageSize(Buffer.from('hello world, not an image')), null);
  assert.equal(imageSize(Buffer.from(FIXTURES.png, 'base64').subarray(0, 12)), null);
  assert.equal(imageSize(Buffer.from(FIXTURES.jpeg, 'base64').subarray(0, 30)), null);
});
ok('fitWithin scales down, never up', () => {
  assert.deepEqual(fitWithin({ width: 600, height: 400 }, 300), { width: 300, height: 200 });
  assert.deepEqual(fitWithin({ width: 100, height: 3000 }, 300), { width: 10, height: 300 });
  assert.deepEqual(fitWithin({ width: 7, height: 5 }, 300), { width: 7, height: 5 });
  assert.deepEqual(fitWithin({ width: 600, height: 400 }, 300, 160), { width: 240, height: 160 });
});

// --- classify ---
ok('classify data uri', () => {
  const r = classify('data:image/png;base64,iVBORw0KGgo=');
  assert.equal(r.kind, 'dataUri');
  assert.equal(r.mime, 'image/png');
});
ok('classify image url (extension) -> no probe', () => {
  const r = classify('https://example.com/cat.png?x=1');
  assert.equal(r.kind, 'url');
  assert.equal(r.probe, false);
});
ok('classify extension-less url -> probe candidate', () => {
  const r = classify('https://example.com/avatar/123');
  assert.equal(r.kind, 'url');
  assert.equal(r.probe, true);
});
ok('classify known non-image url -> null', () => {
  assert.equal(classify('https://example.com/index.html'), null);
  assert.equal(classify('https://example.com/data.json'), null);
});
ok('classify url strips trailing punctuation', () => {
  const r = classify('https://example.com/cat.png,');
  assert.equal(r.url, 'https://example.com/cat.png');
});
ok('classify raw jpeg base64', () => {
  const r = classify('/9j/4AAQSkZJRgABAQAAAQABAAD' + 'A'.repeat(40));
  assert.equal(r.kind, 'base64');
  assert.equal(r.mime, 'image/jpeg');
  assert.ok(r.dataUri.startsWith('data:image/jpeg;base64,/9j/'));
});
ok('classify plain text -> null', () => {
  assert.equal(classify('just some words here'), null);
});

// --- tokenAt scanning across quotes ---
ok('tokenAt within JSON string', () => {
  const text = '{"objectBase64":"/9j/4AAQSkZ==","other":1}';
  const off = text.indexOf('4AAQ');
  const tok = tokenAt(text, off);
  assert.equal(tok.value, '/9j/4AAQSkZ==');
});

// --- real sample payloads ---
const samplesDir = path.join(__dirname, '..', 'samples');
if (fs.existsSync(samplesDir)) {
  for (const file of fs.readdirSync(samplesDir).filter((f) => f.endsWith('.json'))) {
    const raw = fs.readFileSync(path.join(samplesDir, file), 'utf8');
    const payload = JSON.parse(raw);
    const value = payload.objectBase64 || payload.avatar || '';

    if (value.startsWith('http')) {
      ok(`sample ${file}: classifies as previewable url`, () => {
        const r = classify(value);
        assert.ok(r, 'should classify');
        assert.equal(r.kind, 'url');
        console.log(`      -> url (probe=${r.probe})`);
      });
      ok(`sample ${file}: tokenAt finds the url`, () => {
        const tok = tokenAt(raw, raw.indexOf(value) + 10);
        assert.equal(tok.value, value);
      });
    } else {
      ok(`sample ${file}: classifies as image`, () => {
        const r = classify(value);
        assert.ok(r, 'should classify');
        assert.equal(r.kind, 'base64');
        assert.equal(r.mime, 'image/jpeg');
      });
      ok(`sample ${file}: tokenAt finds full blob`, () => {
        const idx = raw.indexOf(value);
        const tok = tokenAt(raw, idx + 5000); // cursor deep inside the blob
        assert.equal(tok.value, value);
        console.log(`      -> ${(base64Bytes(value) / 1024).toFixed(0)} KB jpeg`);
      });
    }
  }
}

console.log(`\n${passed} checks passed`);
