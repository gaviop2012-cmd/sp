'use strict';

// Builds a release with the original application JavaScript obfuscated
// inside app.asar, then restores the readable source files in the source folder.
// This raises the effort for casual copying but does not make Electron code
// impossible to extract or reverse engineer.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const JavaScriptObfuscator = require('javascript-obfuscator');

const root = path.resolve(__dirname, '..');
const sourceFiles = ['main.js', 'preload.js', 'renderer.js'];
const originals = new Map();
const options = {
  target: 'node',
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  sourceMap: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.65,
  transformObjectKeys: false,
  unicodeEscapeSequence: false
};

function restoreSources() {
  for (const [file, contents] of originals) {
    fs.writeFileSync(path.join(root, file), contents, 'utf8');
  }
}

function main() {
  if (process.platform !== 'darwin') {
    console.error('Run npm run pack:mac on macOS to create a native .dmg/.zip package.');
    process.exitCode = 1;
    return;
  }

  try {
    for (const file of sourceFiles) {
      const fullPath = path.join(root, file);
      const source = fs.readFileSync(fullPath, 'utf8');
      originals.set(file, source);
      const obfuscated = JavaScriptObfuscator.obfuscate(source, options).getObfuscatedCode();
      fs.writeFileSync(fullPath, obfuscated, 'utf8');
    }

    const builder = path.join(root, 'node_modules', '.bin', 'electron-builder');
    if (!fs.existsSync(builder)) throw new Error('electron-builder is not installed. Run npm install first.');
    console.log('Packaging SpotDL Studio with obfuscated app code inside app.asar…');
    const result = spawnSync(builder, ['--mac', 'zip', 'dmg'], { cwd: root, stdio: 'inherit', env: process.env });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status || 1;
  } catch (error) {
    console.error(`macOS packaging failed: ${error.message || String(error)}`);
    process.exitCode = 1;
  } finally {
    restoreSources();
    console.log('Readable source files have been restored in the project folder.');
  }
}

main();
