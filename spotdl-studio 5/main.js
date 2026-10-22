'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const https = require('node:https');

let mainWindow;
let setupPromise = null;
let setupStatus = { ready: false, busy: false, version: null, error: null };
let activeDownload = null;
let activeDownloadPromise = null;
let chosenFolder = null;
let updateCheckPromise = null;
let lastUpdateSummary = { status: 'not-checked', checkedAt: null, items: [] };

const AGREEMENT_VERSION = 1;
const AGREEMENT_CHECKBOX_TEXT = 'I agree that this is a local backup utility for archiving media I legally own or have permission to access. I assume full legal responsibility for its use.';
const UPSTREAM_RELEASES = [
  { id: 'spotdl', name: 'SpotDL', packageName: 'spotdl', apiUrl: 'https://api.github.com/repos/spotDL/spotify-downloader/releases/latest', releasesUrl: 'https://github.com/spotDL/spotify-downloader/releases' },
  { id: 'yt-dlp', name: 'yt-dlp', packageName: 'yt-dlp', apiUrl: 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', releasesUrl: 'https://github.com/yt-dlp/yt-dlp/releases' }
];

const appSupportDir = () => path.join(app.getPath('userData'), 'runtime');
const venvDir = () => path.join(appSupportDir(), 'spotdl-venv');
const venvPython = () => path.join(venvDir(), 'bin', 'python');
const preferencePath = () => path.join(app.getPath('userData'), 'preferences.json');
const setupMarkerPath = () => path.join(appSupportDir(), 'setup-complete.json');

function emit(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function expandedPath() {
  const extras = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/opt/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), 'Library', 'Python', '3.13', 'bin'),
    path.join(os.homedir(), 'Library', 'Python', '3.12', 'bin'),
    path.join(os.homedir(), 'Library', 'Python', '3.11', 'bin')
  ];
  return [...new Set([...extras, ...(process.env.PATH || '').split(path.delimiter)])].join(path.delimiter);
}

function childEnv(extra = {}) {
  const env = { ...process.env };
  // Keep requests direct from this Mac rather than inheriting a proxy configured
  // in the launching shell. The app has no remote media proxy of its own.
  for (const key of Object.keys(env)) {
    if (/^(http|https|all|ftp|no)_proxy$/i.test(key) || /^PIP_/i.test(key)) delete env[key];
  }
  return {
    ...env,
    PATH: expandedPath(),
    PIP_CONFIG_FILE: os.devNull,
    PYTHONUNBUFFERED: '1',
    ...extra
  };
}

function runProcess(command, args, options = {}) {
  const { cwd, onLine, onSpawn, detached = false, timeoutMs = 0, env = childEnv() } = options;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        shell: false,
        detached,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      if (onSpawn) onSpawn(child);
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = '';
    let stderr = '';
    let pending = '';
    let timer = null;
    let settled = false;

    const consume = (chunk, isErr = false) => {
      const text = chunk.toString('utf8');
      if (isErr) stderr += text;
      else stdout += text;
      pending += text;
      const parts = pending.split(/[\r\n]+/);
      pending = parts.pop() || '';
      for (const part of parts) {
        const line = part.trimEnd();
        if (line && onLine) onLine(line, isErr);
      }
    };

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (child && !settled) {
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!settled && child && child.exitCode === null) child.kill('SIGKILL');
          }, 2500).unref();
        }
      }, timeoutMs);
    }

    child.stdout.on('data', chunk => consume(chunk, false));
    child.stderr.on('data', chunk => consume(chunk, true));
    child.once('error', error => {
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      settled = true;
      if (timer) clearTimeout(timer);
      if (pending.trim() && onLine) onLine(pending.trimEnd(), false);
      resolve({ code: code ?? 1, signal, stdout, stderr });
    });
  });
}

async function getPythonVersion(command) {
  try {
    const result = await runProcess(command, ['-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])'], { timeoutMs: 5000 });
    if (result.code !== 0) return null;
    const match = result.stdout.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    const version = { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), text: match[0] };
    if (version.major !== 3 || version.minor < 10 || version.minor >= 15) return null;
    return version;
  } catch {
    return null;
  }
}

async function findPython() {
  const candidates = [];
  for (const version of ['3.14', '3.13', '3.12', '3.11', '3.10']) {
    candidates.push(`/opt/homebrew/bin/python${version}`);
    candidates.push(`/usr/local/bin/python${version}`);
    candidates.push(`/Library/Frameworks/Python.framework/Versions/${version}/bin/python${version}`);
    candidates.push(`python${version}`);
  }
  candidates.push('/opt/homebrew/bin/python3', '/usr/local/bin/python3', 'python3');
  if (process.env.PYTHON) candidates.unshift(process.env.PYTHON);

  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const version = await getPythonVersion(candidate);
    if (version) return { command: candidate, version: version.text };
  }
  return null;
}

function parseVersion(output) {
  const match = String(output || '').match(/spotdl\s+version\s+([^\s]+)/i) || String(output || '').match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : 'installed';
}

async function getSavedPreferences() {
  try {
    return JSON.parse(await fs.readFile(preferencePath(), 'utf8'));
  } catch {
    return {};
  }
}

async function savePreferences(prefs) {
  await fs.mkdir(path.dirname(preferencePath()), { recursive: true });
  await fs.writeFile(preferencePath(), JSON.stringify(prefs, null, 2), 'utf8');
}

async function hasAcceptedAgreement() {
  const prefs = await getSavedPreferences();
  return Boolean(prefs.agreement && prefs.agreement.accepted === true && prefs.agreement.version === AGREEMENT_VERSION);
}

async function requireAcceptedAgreement() {
  if (!(await hasAcceptedAgreement())) {
    throw new Error('Please review and accept the startup agreement before using SpotDL Studio.');
  }
}

function requestJson(url, timeoutMs = 9000) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'SpotDL-Studio-Desktop'
      }
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`GitHub returned HTTP ${response.statusCode}${response.statusCode === 403 ? ' (the unauthenticated API rate limit may have been reached)' : ''}.`));
          return;
        }
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('GitHub returned an unreadable release response.')); }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('GitHub release check timed out.')));
    request.on('error', reject);
  });
}

function cleanReleaseVersion(tag) {
  const text = String(tag || '').trim().replace(/^v/i, '');
  const match = text.match(/\d+(?:\.\d+){1,3}/);
  return match ? match[0] : null;
}

function compareNumericVersions(left, right) {
  const a = cleanReleaseVersion(left);
  const b = cleanReleaseVersion(right);
  if (!a || !b) return null;
  const aa = a.split('.').map(Number);
  const bb = b.split('.').map(Number);
  const count = Math.max(aa.length, bb.length);
  for (let i = 0; i < count; i += 1) {
    const av = aa[i] || 0;
    const bv = bb[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

async function getInstalledDependencyVersions() {
  const result = await runProcess(venvPython(), [
    '-c',
    'import importlib.metadata as m, json; names=["spotdl", "yt-dlp"]; out={};\nfor n in names:\n try: out[n]=m.version(n)\n except m.PackageNotFoundError: out[n]=None\nprint(json.dumps(out))'
  ], { timeoutMs: 15000 });
  if (result.code !== 0) throw new Error('Could not read the installed dependency versions.');
  const line = result.stdout.trim().split(/\r?\n/).pop();
  try { return JSON.parse(line); }
  catch { throw new Error('Could not parse the installed dependency versions.'); }
}

async function getLatestStableRelease(repo) {
  const data = await requestJson(repo.apiUrl);
  if (!data || data.draft || data.prerelease || !data.tag_name) {
    throw new Error(`${repo.name} did not return a stable release tag.`);
  }
  const version = cleanReleaseVersion(data.tag_name);
  if (!version) throw new Error(`Could not understand ${repo.name}'s latest release tag (${data.tag_name}).`);
  return { version, tag: data.tag_name, url: data.html_url || repo.releasesUrl };
}

async function checkAndUpdateManagedDependencies({ manual = false } = {}) {
  if (updateCheckPromise) return updateCheckPromise;
  if (activeDownload) return { ok: false, status: 'busy', error: 'Updates cannot run while an archive task is active.' };
  if (!setupStatus.ready) return { ok: false, status: 'not-ready', error: 'Finish the local SpotDL setup before checking dependency updates.' };

  updateCheckPromise = (async () => {
    const checkedAt = new Date().toISOString();
    emit('deps:update', { type: 'info', text: 'Checking official stable releases for SpotDL and yt-dlp…' });
    let installed;
    try { installed = await getInstalledDependencyVersions(); }
    catch (error) {
      const summary = { ok: false, status: 'check-failed', checkedAt, items: [], error: error.message || String(error) };
      lastUpdateSummary = summary;
      emit('deps:update', { type: 'warning', text: `Could not read installed versions. ${summary.error}` });
      return summary;
    }

    const releaseResults = await Promise.all(UPSTREAM_RELEASES.map(async repo => {
      try { return { repo, release: await getLatestStableRelease(repo), error: null }; }
      catch (error) { return { repo, release: null, error: error.message || String(error) }; }
    }));

    const items = [];
    const packagesToUpdate = [];
    for (const result of releaseResults) {
      const localVersion = installed[result.repo.packageName] || null;
      if (result.error) {
        items.push({ id: result.repo.id, name: result.repo.name, currentVersion: localVersion, latestVersion: null, status: 'check-failed', message: result.error, releasesUrl: result.repo.releasesUrl });
        emit('deps:update', { type: 'warning', text: `${result.repo.name} update check failed: ${result.error}` });
        continue;
      }
      const remote = result.release;
      const comparison = localVersion ? compareNumericVersions(remote.version, localVersion) : 1;
      if (comparison === null) {
        items.push({ id: result.repo.id, name: result.repo.name, currentVersion: localVersion, latestVersion: remote.version, status: 'unknown-version', message: 'Could not compare version strings.', releasesUrl: remote.url });
      } else if (comparison > 0) {
        items.push({ id: result.repo.id, name: result.repo.name, currentVersion: localVersion, latestVersion: remote.version, status: 'update-available', message: `${result.repo.name} ${remote.version} is available.`, releasesUrl: remote.url });
        packagesToUpdate.push({ repo: result.repo, version: remote.version, previousVersion: localVersion });
      } else {
        items.push({ id: result.repo.id, name: result.repo.name, currentVersion: localVersion, latestVersion: remote.version, status: 'current', message: `${result.repo.name} is up to date.`, releasesUrl: remote.url });
      }
    }

    const knownFailures = items.filter(item => item.status === 'check-failed' || item.status === 'unknown-version').length;
    if (packagesToUpdate.length === 0) {
      const summary = { ok: knownFailures === 0, status: knownFailures ? 'partially-checked' : 'current', checkedAt, items };
      lastUpdateSummary = summary;
      emit('deps:update', { type: knownFailures ? 'warning' : 'success', text: knownFailures ? 'Some upstream versions could not be checked. The existing local setup was left unchanged.' : 'SpotDL and yt-dlp are already at the latest stable releases found on GitHub.' });
      return summary;
    }

    const requestedNames = packagesToUpdate.map(item => `${item.repo.name} ${item.previousVersion || 'not installed'} → ${item.version}`);
    emit('deps:update', { type: 'info', text: `Updating local dependencies: ${requestedNames.join('; ')}…` });
    const pipArgs = ['-m', 'pip', 'install', '--disable-pip-version-check', '--index-url', 'https://pypi.org/simple', '--upgrade', '--upgrade-strategy', 'only-if-needed'];
    for (const item of packagesToUpdate) pipArgs.push(`${item.repo.packageName}==${item.version}`);

    const install = await runProcess(venvPython(), pipArgs, {
      timeoutMs: 600000,
      onLine: line => emit('deps:update', { type: 'log', text: line })
    });

    if (install.code !== 0) {
      emit('deps:update', { type: 'warning', text: 'The dependency update failed. Attempting to restore the previous SpotDL and yt-dlp versions…' });
      const rollbackArgs = ['-m', 'pip', 'install', '--disable-pip-version-check', '--index-url', 'https://pypi.org/simple', '--force-reinstall'];
      for (const item of packagesToUpdate) {
        if (item.previousVersion) rollbackArgs.push(`${item.repo.packageName}==${item.previousVersion}`);
      }
      let rollbackSucceeded = false;
      if (rollbackArgs.length > 5) {
        const rollback = await runProcess(venvPython(), rollbackArgs, { timeoutMs: 600000, onLine: line => emit('deps:update', { type: 'log', text: line }) });
        rollbackSucceeded = rollback.code === 0;
      }
      const detail = (install.stderr || install.stdout || '').trim().split(/\r?\n/).slice(-3).join(' ');
      for (const item of packagesToUpdate) {
        const found = items.find(entry => entry.id === item.repo.id);
        if (found) found.status = 'update-failed';
      }
      const summary = { ok: false, status: 'update-failed', checkedAt, items, error: detail || 'pip exited unsuccessfully', rollbackSucceeded };
      lastUpdateSummary = summary;
      if (!rollbackSucceeded) {
        setupStatus = { ready: false, busy: false, version: null, error: 'A dependency update failed and restoring previous versions could not be confirmed. Retry setup to rebuild the private environment.', errorCode: 'SETUP_FAILED' };
        emit('setup:progress', { type: 'error', text: setupStatus.error });
      }
      emit('deps:update', { type: 'warning', text: rollbackSucceeded ? 'Update failed; the previous pinned versions were restored.' : 'Update failed and rollback could not be confirmed. The setup is marked unavailable until you retry setup.' });
      return summary;
    }

    const verify = await runProcess(venvPython(), ['-m', 'spotdl', '--version'], { timeoutMs: 20000 });
    if (verify.code !== 0) {
      const summary = { ok: false, status: 'verification-failed', checkedAt, items, error: 'The updated SpotDL installation did not pass its startup verification.' };
      lastUpdateSummary = summary;
      setupStatus = { ready: false, busy: false, version: null, error: `${summary.error} Retry setup to rebuild the private environment.`, errorCode: 'SETUP_FAILED' };
      emit('setup:progress', { type: 'error', text: setupStatus.error });
      emit('deps:update', { type: 'error', text: summary.error });
      return summary;
    }

    let actualVersions = installed;
    try { actualVersions = await getInstalledDependencyVersions(); } catch { /* Keep the previous best-known values if metadata readback fails. */ }
    for (const item of items) {
      if (item.status === 'update-available') {
        item.currentVersion = actualVersions[item.id === 'spotdl' ? 'spotdl' : 'yt-dlp'] || item.latestVersion;
        item.status = 'updated';
        item.message = `${item.name} is now ${item.currentVersion}.`;
      }
    }
    const spotdlVersion = actualVersions.spotdl || parseVersion(`${verify.stdout}\n${verify.stderr}`);
    setupStatus = { ...setupStatus, ready: true, busy: false, version: spotdlVersion, error: null };
    await fs.mkdir(path.dirname(setupMarkerPath()), { recursive: true });
    await fs.writeFile(setupMarkerPath(), JSON.stringify({ version: spotdlVersion, completedAt: new Date().toISOString() }, null, 2), 'utf8');
    const summary = { ok: knownFailures === 0, status: knownFailures ? 'partially-updated' : 'updated', checkedAt, items };
    lastUpdateSummary = summary;
    emit('deps:update', { type: knownFailures ? 'warning' : 'success', text: knownFailures ? `Updated available packages. Some upstream versions could not be verified; SpotDL ${spotdlVersion} passed startup verification.` : `Local dependency update complete. SpotDL ${spotdlVersion} passed verification.` });
    return summary;
  })().catch(error => {
    const summary = { ok: false, status: 'check-failed', checkedAt: new Date().toISOString(), items: [], error: error.message || String(error) };
    lastUpdateSummary = summary;
    emit('deps:update', { type: 'warning', text: `Dependency update check failed. The app will continue with the local setup. ${summary.error}` });
    return summary;
  }).finally(() => {
    updateCheckPromise = null;
  });

  return updateCheckPromise;
}

async function getDefaultFolder() {
  const saved = await getSavedPreferences();
  if (saved.outputFolder) {
    try {
      const stat = await fs.stat(saved.outputFolder);
      if (stat.isDirectory()) return saved.outputFolder;
    } catch { /* Choose the default below. */ }
  }
  const defaultFolder = path.join(os.homedir(), 'Music', 'SpotDL Downloads');
  await fs.mkdir(defaultFolder, { recursive: true });
  return defaultFolder;
}

async function ensureSpotdl() {
  if (setupStatus.ready) return setupStatus;
  if (setupPromise) return setupPromise;

  setupPromise = (async () => {
    setupStatus = { ready: false, busy: true, version: null, error: null };
    emit('setup:progress', { type: 'info', text: 'Checking the app-managed SpotDL environment…' });
    await fs.mkdir(appSupportDir(), { recursive: true });

    try {
      const currentPython = venvPython();
      try {
        const marker = JSON.parse(await fs.readFile(setupMarkerPath(), 'utf8'));
        await fs.access(currentPython);
        const check = await runProcess(currentPython, ['-m', 'spotdl', '--version'], { timeoutMs: 15000 });
        if (check.code === 0) {
          const version = parseVersion(`${check.stdout}\n${check.stderr}`);
          setupStatus = { ready: true, busy: false, version: marker.version || version, error: null };
          emit('setup:progress', { type: 'success', text: `SpotDL ${setupStatus.version} is ready.` });
          return setupStatus;
        }
      } catch { /* The managed environment is missing or incomplete; rebuild it. */ }

      await fs.rm(setupMarkerPath(), { force: true });
      emit('setup:progress', { type: 'info', text: 'SpotDL is not installed yet. Preparing its private environment…' });
      const python = await findPython();
      if (!python) {
        const error = 'A compatible Python 3.10–3.14 installation was not found. Install Python from python.org, then reopen SpotDL Studio. No Terminal commands are needed.';
        setupStatus = { ready: false, busy: false, version: null, error, errorCode: 'MISSING_PYTHON' };
        emit('setup:progress', { type: 'error', text: error });
        return setupStatus;
      }

      emit('setup:progress', { type: 'info', text: `Using Python ${python.version}. Creating a private environment…` });
      await fs.rm(venvDir(), { recursive: true, force: true });
      const createEnv = await runProcess(python.command, ['-m', 'venv', venvDir()], {
        timeoutMs: 120000,
        onLine: line => emit('setup:progress', { type: 'log', text: line })
      });
      if (createEnv.code !== 0) {
        throw new Error(`Could not create the private Python environment. ${createEnv.stderr || createEnv.stdout || ''}`.trim());
      }

      emit('setup:progress', { type: 'info', text: 'Installing SpotDL and its Python dependencies…' });
      const upgradePip = await runProcess(venvPython(), ['-m', 'pip', 'install', '--index-url', 'https://pypi.org/simple', '--upgrade', 'pip'], {
        timeoutMs: 240000,
        onLine: line => emit('setup:progress', { type: 'log', text: line })
      });
      if (upgradePip.code !== 0) {
        throw new Error(`Could not prepare pip. ${upgradePip.stderr || upgradePip.stdout || ''}`.trim());
      }
      const install = await runProcess(venvPython(), ['-m', 'pip', 'install', '--index-url', 'https://pypi.org/simple', '--upgrade', 'spotdl'], {
        timeoutMs: 600000,
        onLine: line => emit('setup:progress', { type: 'log', text: line })
      });
      if (install.code !== 0) {
        throw new Error(`SpotDL installation failed. Check the connection and retry. ${install.stderr || install.stdout || ''}`.trim());
      }

      // SpotDL's --download-ffmpeg command is interactive when FFmpeg is already
      // present: it calls input() to ask whether to overwrite. Our child processes
      // intentionally have no stdin, so invoking it unconditionally raises EOFError.
      // Probe using the same helpers that SpotDL's own console command uses first.
      emit('setup:progress', { type: 'info', text: 'Checking FFmpeg for audio conversion…' });
      const ffmpegProbe = await runProcess(venvPython(), [
        '-c',
        'from spotdl.utils.ffmpeg import get_local_ffmpeg, is_ffmpeg_installed; p = get_local_ffmpeg(); print(str(p) if p is not None else ("system ffmpeg" if is_ffmpeg_installed() else ""))'
      ], { timeoutMs: 15000 });
      if (ffmpegProbe.code === 0 && ffmpegProbe.stdout.trim()) {
        emit('setup:progress', { type: 'success', text: `FFmpeg is already available (${ffmpegProbe.stdout.trim().split(/\r?\n/).pop()}).` });
      } else {
        emit('setup:progress', { type: 'info', text: 'Downloading FFmpeg for audio conversion…' });
        const ffmpeg = await runProcess(venvPython(), ['-m', 'spotdl', '--download-ffmpeg'], {
          timeoutMs: 240000,
          onLine: line => emit('setup:progress', { type: 'log', text: line })
        });
        if (ffmpeg.code !== 0) {
          const detail = (ffmpeg.stderr || ffmpeg.stdout || '').trim();
          throw new Error(`FFmpeg setup failed. Check the connection and retry.${detail ? `\n${detail}` : ''}`);
        }
      }

      // Deno's downloader has the same interactive overwrite prompt, so only call
      // it when neither a SpotDL-local nor PATH-installed copy is available.
      emit('setup:progress', { type: 'info', text: 'Checking the optional Deno runtime for source compatibility…' });
      const denoProbe = await runProcess(venvPython(), [
        '-c',
        'from spotdl.utils.deno import get_deno_path; p = get_deno_path(); print(str(p) if p is not None else "")'
      ], { timeoutMs: 15000 });
      if (denoProbe.code === 0 && denoProbe.stdout.trim()) {
        emit('setup:progress', { type: 'success', text: `Deno is already available (${denoProbe.stdout.trim().split(/\r?\n/).pop()}).` });
      } else {
        emit('setup:progress', { type: 'info', text: 'Installing the optional Deno runtime for additional source compatibility…' });
        const deno = await runProcess(venvPython(), ['-m', 'spotdl', '--download-deno'], {
          timeoutMs: 240000,
          onLine: line => emit('setup:progress', { type: 'log', text: line })
        });
        if (deno.code !== 0) {
          emit('setup:progress', { type: 'warning', text: 'Optional Deno setup was skipped or failed. You can still try downloads.' });
        }
      }

      const check = await runProcess(venvPython(), ['-m', 'spotdl', '--version'], { timeoutMs: 15000 });
      if (check.code !== 0) throw new Error('SpotDL was installed but failed its verification check. Please retry setup.');
      const version = parseVersion(`${check.stdout}\n${check.stderr}`);
      await fs.writeFile(setupMarkerPath(), JSON.stringify({ version, completedAt: new Date().toISOString() }, null, 2), 'utf8');
      setupStatus = { ready: true, busy: false, version, error: null };
      emit('setup:progress', { type: 'success', text: `Setup complete. SpotDL ${version} is ready.` });
      return setupStatus;
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      setupStatus = { ready: false, busy: false, version: null, error: message, errorCode: 'SETUP_FAILED' };
      emit('setup:progress', { type: 'error', text: message });
      return setupStatus;
    } finally {
      setupPromise = null;
    }
  })();

  return setupPromise;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 820,
    minHeight: 680,
    title: 'SpotDL Studio',
    backgroundColor: '#0b0d12',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  if (app.isPackaged) {
    mainWindow.webContents.on('devtools-opened', () => mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.closeDevTools());
    mainWindow.webContents.on('before-input-event', (event, input) => {
      const key = String(input.key || '').toLowerCase();
      if ((input.meta && input.alt && key === 'i') || (input.meta && input.shift && key === 'i') || (input.control && input.shift && key === 'i')) event.preventDefault();
    });
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function isSpotifyUrl(raw) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      (host === 'open.spotify.com' || host === 'spotify.link' || host === 'www.spotify.com' || host.endsWith('.spotify.link'));
  } catch {
    return false;
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [{ label: 'Quit SpotDL Studio', accelerator: 'Command+Q', click: () => app.quit() }]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    }
  ]));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('app:gate-check', async () => ({
  accepted: await hasAcceptedAgreement(),
  agreementVersion: AGREEMENT_VERSION,
  checkboxText: AGREEMENT_CHECKBOX_TEXT
}));

ipcMain.handle('app:accept-agreement', async (_event, request) => {
  if (!request || request.checked !== true) return { ok: false, error: 'Check the agreement box before continuing.' };
  const prefs = await getSavedPreferences();
  prefs.agreement = {
    accepted: true,
    version: AGREEMENT_VERSION,
    acceptedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    checkboxText: AGREEMENT_CHECKBOX_TEXT
  };
  await savePreferences(prefs);
  return { ok: true, acceptedAt: prefs.agreement.acceptedAt, agreementVersion: AGREEMENT_VERSION };
});

ipcMain.handle('app:init', async () => {
  await requireAcceptedAgreement();
  chosenFolder = await getDefaultFolder();
  const status = await ensureSpotdl();
  let updates = lastUpdateSummary;
  if (status.ready) updates = await checkAndUpdateManagedDependencies({ manual: false });
  return { ...setupStatus, outputFolder: chosenFolder, platform: process.platform, updates };
});

ipcMain.handle('app:retry-setup', async () => {
  await requireAcceptedAgreement();
  setupStatus = { ready: false, busy: false, version: null, error: null };
  const status = await ensureSpotdl();
  if (status.ready) await checkAndUpdateManagedDependencies({ manual: true });
  return setupStatus;
});

ipcMain.handle('app:check-updates', async () => {
  await requireAcceptedAgreement();
  return checkAndUpdateManagedDependencies({ manual: true });
});

ipcMain.handle('app:get-licenses', async () => {
  await requireAcceptedAgreement();
  const entries = [
    { id: 'spotdl-mit', name: 'SpotDL — MIT License', file: 'spotDL-MIT.txt', note: 'Copyright (c) 2021 spotDL Developers. MIT requires this copyright and permission notice to accompany copies or substantial portions.', url: 'https://raw.githubusercontent.com/spotDL/spotify-downloader/master/LICENSE' },
    { id: 'yt-dlp-unlicense', name: 'yt-dlp — Unlicense', file: 'yt-dlp-Unlicense.txt', note: 'The upstream Python source/wheel is Unlicense. Some upstream bundled executables include components under additional licenses; see the upstream third-party notices.', url: 'https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/LICENSE' },
    { id: 'ffmpeg-lgpl', name: 'FFmpeg — GNU LGPL 2.1', file: 'FFmpeg-COPYING.LGPLv2.1.txt', note: 'FFmpeg states that most files are LGPL v2.1 or later. The actual terms depend on the specific binary and enabled components.', url: 'https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/COPYING.LGPLv2.1' },
    { id: 'ffmpeg-gpl', name: 'FFmpeg — GNU GPL 2', file: 'FFmpeg-COPYING.GPLv2.txt', note: 'Some optional FFmpeg components use GPL terms; FFmpeg documents that enabling those components changes the applicable license. This text is provided for reference and is not a claim that every build uses GPL components.', url: 'https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/COPYING.GPLv2' },
    { id: 'app-proprietary', name: 'SpotDL Studio — Application Code', file: '../LICENSE-PROPRIETARY.txt', note: 'This notice concerns the original SpotDL Studio code only; third-party dependencies keep their respective licenses.', url: null }
  ];
  const licenses = await Promise.all(entries.map(async entry => ({ ...entry, text: await fs.readFile(path.join(__dirname, 'licenses', entry.file), 'utf8').catch(async () => {
    if (entry.file.startsWith('../')) return fs.readFile(path.join(__dirname, entry.file), 'utf8');
    return 'License text is unavailable in this installation. See the upstream license link.';
  }) })));
  return { licenses, updates: lastUpdateSummary };
});

ipcMain.handle('app:choose-folder', async () => {
  await requireAcceptedAgreement();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose your archive folder',
    defaultPath: chosenFolder || path.join(os.homedir(), 'Music'),
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  chosenFolder = result.filePaths[0];
  await fs.mkdir(chosenFolder, { recursive: true });
  const prefs = await getSavedPreferences();
  prefs.outputFolder = chosenFolder;
  await savePreferences(prefs);
  return { canceled: false, outputFolder: chosenFolder };
});

ipcMain.handle('app:open-folder', async () => {
  await requireAcceptedAgreement();
  if (!chosenFolder) chosenFolder = await getDefaultFolder();
  await fs.mkdir(chosenFolder, { recursive: true });
  const error = await shell.openPath(chosenFolder);
  return { ok: !error, error: error || null };
});

ipcMain.handle('app:open-python', async () => {
  await requireAcceptedAgreement();
  await shell.openExternal('https://www.python.org/downloads/macos/');
  return { ok: true };
});

ipcMain.handle('spotdl:download', async (_event, request) => {
  await requireAcceptedAgreement();
  if (activeDownload) return { ok: false, error: 'A download is already running.' };
  const url = String(request?.url || '').trim();
  const format = String(request?.format || 'mp3').toLowerCase();
  if (!isSpotifyUrl(url)) return { ok: false, error: 'Paste a valid Spotify track, album, playlist, artist, or Spotify short link.' };
  if (!['mp3', 'm4a', 'opus', 'ogg', 'flac', 'wav'].includes(format)) return { ok: false, error: 'That audio format is not supported.' };

  const status = await ensureSpotdl();
  if (!status.ready) return { ok: false, error: status.error || 'SpotDL setup is not complete.', errorCode: status.errorCode };

  const folder = chosenFolder || await getDefaultFolder();
  try {
    await fs.mkdir(folder, { recursive: true });
  } catch (error) {
    return { ok: false, error: `Cannot access the selected folder: ${error.message}` };
  }

  emit('download:state', { running: true, folder, url, format });
  emit('download:log', { type: 'info', text: `Starting the local archive engine in ${folder}` });
  emit('download:log', { type: 'info', text: 'Only save audio you have permission to download.' });
  const args = [
    '-m', 'spotdl', 'download', url,
    '--format', format,
    '--output', '{artists} - {title}.{output-ext}',
    '--overwrite', 'skip',
    '--log-level', 'INFO'
  ];

  activeDownloadPromise = runProcess(venvPython(), args, {
    cwd: folder,
    detached: process.platform !== 'win32',
    timeoutMs: 0,
    onSpawn: child => { activeDownload = child; },
    onLine: (line, isErr) => {
      const type = /error|failed|exception/i.test(line) ? 'error' : (/warning/i.test(line) ? 'warning' : (isErr ? 'stderr' : 'log'));
      emit('download:log', { type, text: line });
    }
  }).then(result => {
    const stopped = result.signal === 'SIGTERM' || result.signal === 'SIGKILL';
    if (stopped) {
      emit('download:log', { type: 'warning', text: 'Archive task stopped.' });
    } else if (result.code === 0) {
      emit('download:log', { type: 'success', text: 'Archive task finished successfully.' });
    } else {
      const detail = (result.stderr || result.stdout || '').trim().split(/\r?\n/).slice(-4).join(' ');
      emit('download:log', { type: 'error', text: detail ? `Archive engine exited with code ${result.code}: ${detail}` : `Archive engine exited with code ${result.code}.` });
    }
    emit('download:state', { running: false, exitCode: result.code, stopped: Boolean(stopped) });
    return { ok: result.code === 0, exitCode: result.code, stopped: Boolean(stopped) };
  }).catch(error => {
    emit('download:log', { type: 'error', text: error.message || String(error) });
    emit('download:state', { running: false, error: error.message || String(error) });
    return { ok: false, error: error.message || String(error) };
  }).finally(() => {
    activeDownload = null;
    activeDownloadPromise = null;
  });
  return activeDownloadPromise;
});

ipcMain.handle('spotdl:stop', async () => {
  await requireAcceptedAgreement();
  if (!activeDownload || !activeDownloadPromise) return { ok: false, error: 'No active download.' };
  try {
    if (process.platform !== 'win32' && activeDownload.pid) {
      try { process.kill(-activeDownload.pid, 'SIGTERM'); }
      catch { activeDownload.kill('SIGTERM'); }
    } else {
      activeDownload.kill('SIGTERM');
    }
    emit('download:log', { type: 'warning', text: 'Stop requested…' });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || 'Could not stop the download.' };
  }
});

// External links are opened by explicit clicks from the renderer only.
ipcMain.handle('app:open-url', async (_event, url) => {
  await requireAcceptedAgreement();
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    await shell.openExternal(url);
    return { ok: true };
  }
  return { ok: false };
});
