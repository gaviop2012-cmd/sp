'use strict';

// Builds a Windows x64 NSIS installer with app JavaScript obfuscated inside app.asar.
// Obfuscation discourages casual copying but cannot make Electron code impossible to extract.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const JavaScriptObfuscator = require('javascript-obfuscator');

const root = path.resolve(__dirname, '..');
const sourceFiles = ['main.js', 'preload.js', 'renderer.js'];
const originals = new Map();
const options = {
  target: 'node', compact: true, controlFlowFlattening: false, deadCodeInjection: false,
  debugProtection: false, disableConsoleOutput: false, identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false, selfDefending: false, simplify: true, sourceMap: false,
  stringArray: true, stringArrayEncoding: ['base64'], stringArrayThreshold: 0.65,
  transformObjectKeys: false, unicodeEscapeSequence: false
};
function restoreSources() {
  for (const [file, contents] of originals) fs.writeFileSync(path.join(root, file), contents, 'utf8');
}
function main() {
  try {
    for (const file of sourceFiles) {
      const fullPath = path.join(root, file);
      const source = fs.readFileSync(fullPath, 'utf8');
      originals.set(file, source);
      fs.writeFileSync(fullPath, JavaScriptObfuscator.obfuscate(source, options).getObfuscatedCode(), 'utf8');
    }
    const builder = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
    if (!fs.existsSync(builder)) throw new Error('electron-builder is not installed. Run npm install first.');
    console.log('Packaging SpotDL Studio Windows x64 NSIS installer…');
    const result = spawnSync(builder, ['--win', 'nsis', '--x64'], { cwd: root, stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status || 1;
  } catch (error) {
    console.error(`Windows packaging failed: ${error.message || String(error)}`);
    process.exitCode = 1;
  } finally {
    restoreSources();
    console.log('Readable source files have been restored in the project folder.');
  }
}
main();
