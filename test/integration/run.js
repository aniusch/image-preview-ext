'use strict';
// Runs test/integration/suite.js inside a real VS Code (downloaded to
// .vscode-test/) with a throwaway profile. Run: npm run test:integration
// Set SHOTS_DIR to also save screenshots of the hover and views (needs X11,
// wmctrl, and ImageMagick's `import`).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runTests } = require('@vscode/test-electron');

const root = path.join(__dirname, '..', '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'image-preview-test-'));
fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
fs.writeFileSync(
  path.join(userData, 'User', 'settings.json'),
  JSON.stringify({
    'files.simpleDialog.enable': true,
    'workbench.startupEditor': 'none',
    'window.restoreWindows': 'none',
    'update.mode': 'none',
    'telemetry.telemetryLevel': 'off',
  })
);

runTests({
  extensionDevelopmentPath: root,
  extensionTestsPath: path.join(__dirname, 'suite.js'),
  launchArgs: ['--user-data-dir', userData, '--disable-extensions', '--disable-workspace-trust'],
})
  .catch(() => {
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(userData, { recursive: true, force: true }));
