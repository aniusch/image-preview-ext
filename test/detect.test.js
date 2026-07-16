'use strict';

// Plain-node tests for the pure detection logic. Run: npm test
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { tokenAt, classify, base64Mime, base64Bytes } = require('../src/detect');

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

// --- classify ---
ok('classify data uri', () => {
  const r = classify('data:image/png;base64,iVBORw0KGgo=');
  assert.equal(r.kind, 'dataUri');
  assert.equal(r.mime, 'image/png');
});
ok('classify image url', () => {
  const r = classify('https://example.com/cat.png?x=1');
  assert.equal(r.kind, 'url');
});
ok('classify non-image url -> null', () => {
  assert.equal(classify('https://example.com/page'), null);
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
    const b64 = JSON.parse(raw).objectBase64;
    ok(`sample ${file}: classifies as image`, () => {
      const r = classify(b64);
      assert.ok(r, 'should classify');
      assert.equal(r.kind, 'base64');
      assert.equal(r.mime, 'image/jpeg');
    });
    ok(`sample ${file}: tokenAt finds full blob`, () => {
      const idx = raw.indexOf(b64);
      const tok = tokenAt(raw, idx + 5000); // cursor deep inside the blob
      assert.equal(tok.value, b64);
      console.log(`      -> ${(base64Bytes(b64) / 1024).toFixed(0)} KB jpeg`);
    });
  }
}

console.log(`\n${passed} checks passed`);
