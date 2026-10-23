'use strict';

// Decoded images are written to temp files and shown by file URI: VS Code
// renders local files without the length limit that caps inline data: URIs.
// Each window (extension host process) gets its own folder, removed when the
// window closes; folders left by windows that crashed are removed by the next
// window that starts. No dependency on `vscode`, so it is unit-tested.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mimeExt } = require('./detect');

const DEFAULT_ROOT = path.join(os.tmpdir(), 'vscode-inline-image-preview');
const LOOSE_FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function createStore(root = DEFAULT_ROOT, pid = process.pid) {
  const dir = path.join(root, `window-${pid}`);
  let ready = false;

  // Write bytes to a file named by content hash (so identical images are
  // written once) and return its path.
  function write(buffer, mime) {
    if (!ready) {
      fs.mkdirSync(dir, { recursive: true });
      ready = true;
    }
    const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 16);
    const file = path.join(dir, `${hash}.${mimeExt(mime)}`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, buffer);
    return file;
  }

  // Remove this window's folder.
  function clear() {
    fs.rmSync(dir, { recursive: true, force: true });
    ready = false;
  }

  // Remove folders of windows whose process is gone, and loose files older
  // than a day (versions before 0.3 wrote straight into the root).
  async function clearStale() {
    let entries;
    try {
      entries = await fs.promises.readdir(root, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const entry of entries) {
      const full = path.join(root, entry.name);
      const owner = entry.name.match(/^window-(\d+)$/);
      try {
        if (owner && entry.isDirectory()) {
          if (Number(owner[1]) !== pid && !isAlive(Number(owner[1]))) {
            await fs.promises.rm(full, { recursive: true, force: true });
          }
        } else if (entry.isFile()) {
          const { mtimeMs } = await fs.promises.stat(full);
          if (Date.now() - mtimeMs > LOOSE_FILE_MAX_AGE_MS) await fs.promises.rm(full, { force: true });
        }
      } catch (_e) {
        // Another window may be cleaning up the same entry.
      }
    }
  }

  return { dir, write, clear, clearStale };
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // exists, owned by someone else
  }
}

module.exports = { createStore };
