'use strict';
// Checks that run inside VS Code. Loaded by test/integration/run.js.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const vscode = require('vscode');

const PNG = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'landscape.png'));
const B64 = PNG.toString('base64');
const DATA_URI = `data:image/png;base64,${B64}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failed = 0;
async function ok(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL  ${name}\n      ${e.stack || e.message}`);
  }
}

// Screenshot of the test window, when SHOTS_DIR is set.
function shot(name) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  try {
    const line = execFileSync('wmctrl', ['-l'], { encoding: 'utf8' })
      .split('\n')
      .find((l) => l.includes('Extension Development Host'));
    if (!line) return;
    const out = path.join(dir, `${name}.png`);
    execFileSync('import', ['-window', line.split(/\s+/)[0], out]);
    console.log(`      screenshot ${out}`);
  } catch (e) {
    console.log(`      screenshot failed: ${e.message}`);
  }
}

async function hoverText(doc, position) {
  const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', doc.uri, position);
  return hovers
    .flatMap((h) => h.contents)
    .map((c) => (typeof c === 'string' ? c : c.value))
    .join('\n');
}

function linkArg(markdown, command) {
  const m = markdown.match(new RegExp(`command:${command.replace('.', '\\.')}\\?([^)]+)\\)`));
  assert.ok(m, `no ${command} link`);
  return JSON.parse(decodeURIComponent(m[1]))[0];
}

exports.run = async function run() {
  await vscode.extensions.getExtension('aniusch.inline-image-preview').activate();

  const content = `{\n  "id": "usr_8f3a21",\n  "avatar": "${B64}",\n  "logo": "${DATA_URI}"\n}\n`;
  const doc = await vscode.workspace.openTextDocument({ language: 'json', content });
  const editor = await vscode.window.showTextDocument(doc);
  const onAvatar = new vscode.Position(2, 20);
  const onLogo = new vscode.Position(3, 20);

  // Quiet the window for screenshots.
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  await vscode.commands.executeCommand('notifications.clearAll');

  await ok('hover renders in the editor', async () => {
    editor.selection = new vscode.Selection(onAvatar, onAvatar);
    // A hover closes when focus or the pointer moves, so try a few times.
    for (const attempt of [1, 2, 3]) {
      await vscode.commands.executeCommand('editor.action.showHover');
      await sleep(1200);
      shot(`hover-${attempt}`);
    }
    await vscode.commands.executeCommand('editor.action.hideHover');
  });

  let markdown = '';
  await ok('hover on raw base64 shows a sized thumbnail', async () => {
    markdown = await hoverText(doc, onAvatar);
    assert.match(markdown, /!\[preview\]\(file:\/\/\S+\.png\|width=240,height=160\)/);
  });
  await ok('hover caption has type, pixel size, bytes, source', async () => {
    assert.ok(markdown.includes(`image/png · 600×400 · `), markdown);
    assert.ok(markdown.includes(' · base64'), markdown);
  });
  await ok('hover on data URI works', async () => {
    assert.ok((await hoverText(doc, onLogo)).includes('· data uri'));
  });
  await ok('hover on plain text shows nothing', async () => {
    assert.equal(await hoverText(doc, new vscode.Position(1, 10)), '');
  });

  await ok('Copy data URI', async () => {
    await vscode.env.clipboard.writeText('');
    await vscode.commands.executeCommand('imagePreview.copyDataUri', linkArg(markdown, 'imagePreview.copyDataUri'));
    assert.equal(await vscode.env.clipboard.readText(), DATA_URI);
  });
  await ok('Copy base64', async () => {
    await vscode.commands.executeCommand('imagePreview.copyBase64', linkArg(markdown, 'imagePreview.copyBase64'));
    assert.equal(await vscode.env.clipboard.readText(), B64);
  });
  await ok('Save as writes the image', async () => {
    const target = vscode.Uri.file(path.join(os.tmpdir(), `image-preview-save-${process.pid}.png`));
    const original = vscode.window.showSaveDialog;
    vscode.window.showSaveDialog = async () => target;
    try {
      await vscode.commands.executeCommand('imagePreview.saveAs', linkArg(markdown, 'imagePreview.saveAs'));
    } finally {
      vscode.window.showSaveDialog = original;
    }
    assert.ok(fs.readFileSync(target.fsPath).equals(PNG));
    fs.rmSync(target.fsPath);
  });
  await ok('Open full opens a preview tab', async () => {
    await vscode.commands.executeCommand('imagePreview.openFull', linkArg(markdown, 'imagePreview.openFull'));
    await sleep(800);
    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).map((t) => t.label);
    assert.ok(tabs.includes('Image Preview'), tabs.join(', '));
    await vscode.commands.executeCommand('notifications.clearAll');
    shot('open-full');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  if (failed) throw new Error(`${failed} integration check(s) failed`);
};
