'use strict';

// Plain-node tests for the temp-file store. Run: npm test
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../src/store');

let passed = 0;
async function ok(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
  }
}

// A pid far above any real one, so it is never running.
const DEAD_PID = 2 ** 22 + 12345;

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'image-preview-store-test-'));
  const store = createStore(root, process.pid);

  await ok('write names files by content hash, once', () => {
    const a = store.write(Buffer.from('same bytes'), 'image/png');
    const b = store.write(Buffer.from('same bytes'), 'image/png');
    assert.equal(a, b);
    assert.ok(a.startsWith(path.join(root, `window-${process.pid}`)));
    assert.ok(a.endsWith('.png'));
    assert.equal(fs.readFileSync(a, 'utf8'), 'same bytes');
  });

  await ok('clearStale removes dead windows and old loose files only', async () => {
    const dead = createStore(root, DEAD_PID);
    const deadFile = dead.write(Buffer.from('x'), 'image/gif');
    const alive = createStore(root, process.ppid); // our parent is running
    const aliveFile = alive.write(Buffer.from('y'), 'image/gif');
    const oldLoose = path.join(root, 'abc.png');
    const newLoose = path.join(root, 'def.png');
    fs.writeFileSync(oldLoose, '');
    fs.writeFileSync(newLoose, '');
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldLoose, twoDaysAgo, twoDaysAgo);

    await store.clearStale();
    assert.ok(!fs.existsSync(deadFile), 'dead window folder kept');
    assert.ok(fs.existsSync(aliveFile), 'live window folder removed');
    assert.ok(fs.existsSync(store.dir), 'own folder removed');
    assert.ok(!fs.existsSync(oldLoose), 'old loose file kept');
    assert.ok(fs.existsSync(newLoose), 'new loose file removed');
  });

  await ok('clear removes this window folder, and write recreates it', () => {
    store.clear();
    assert.ok(!fs.existsSync(store.dir));
    assert.ok(fs.existsSync(store.write(Buffer.from('z'), 'image/png')));
  });

  await ok('clearStale on a missing root is a no-op', async () => {
    await createStore(path.join(root, 'missing')).clearStale();
  });

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} store checks passed`);
})();
