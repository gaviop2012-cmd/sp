'use strict';

const $ = id => document.getElementById(id);
const urlInput = $('spotify-url');
const formatSelect = $('format-select');
const downloadButton = $('download-button');
const buttonLabel = $('download-button-label');
const setupBanner = $('setup-banner');
const activityList = $('activity-list');
let setupReady = false;
let downloadRunning = false;
let activityCount = 0;
let agreementAccepted = false;
let licenseEntries = [];
let licensesLoaded = false;
let selectedLicenseId = null;
let currentView = 'workspace';

function formatFolderName(folder) {
  if (!folder) return 'Music / SpotDL Downloads';
  const bits = folder.replace(/\/$/, '').split('/');
  return bits.slice(-2).join(' / ') || folder;
}

function setSetupState(state) {
  setupReady = Boolean(state && state.ready);
  const icon = $('setup-icon');
  const title = $('setup-title');
  const description = $('setup-description');
  const banner = $('setup-banner');
  const pythonButton = $('python-button');
  const retryButton = $('retry-setup-button');
  const light = $('sidebar-light');
  const pulse = document.querySelector('.pulse');

  banner.classList.remove('is-error', 'is-ready');
  pythonButton.classList.add('hidden');
  retryButton.classList.add('hidden');
  if (state && state.ready) {
    banner.classList.add('is-ready');
    icon.textContent = '✓';
    title.textContent = `SpotDL ${state.version || ''} is ready`.trim();
    description.textContent = 'Your download engine is installed locally and ready to use.';
    $('sidebar-status').textContent = 'Engine ready';
    $('sidebar-version').textContent = `SpotDL ${state.version || ''}`;
    $('activity-footer-text').textContent = 'Ready for a download';
    light.classList.add('ready');
    pulse.classList.add('ready');
  } else if (state && state.error) {
    banner.classList.add('is-error');
    icon.textContent = '!';
    title.textContent = state.errorCode === 'MISSING_PYTHON' ? 'Python needs to be installed' : 'Setup needs attention';
    description.textContent = state.error;
    $('sidebar-status').textContent = 'Setup required';
    $('sidebar-version').textContent = 'One-time requirement';
    $('activity-footer-text').textContent = 'Setup required';
    light.classList.remove('ready');
    pulse.classList.remove('ready');
    retryButton.classList.remove('hidden');
    if (state.errorCode === 'MISSING_PYTHON') pythonButton.classList.remove('hidden');
  } else {
    icon.textContent = '↻';
    title.textContent = 'Preparing SpotDL';
    description.textContent = 'Checking your local setup. This happens inside the app — no Terminal window.';
    $('sidebar-status').textContent = 'Setting up engine';
    $('sidebar-version').textContent = 'May take a few minutes the first time';
    $('activity-footer-text').textContent = 'Preparing local engine';
    light.classList.remove('ready');
    pulse.classList.remove('ready');
  }
  updateButton();
}

function updateButton() {
  if (downloadRunning) {
    downloadButton.disabled = false;
    downloadButton.classList.add('busy');
    buttonLabel.textContent = 'Stop task';
    downloadButton.querySelector('.button-icon').textContent = '■';
    downloadButton.querySelector('.button-arrow').textContent = '';
    return;
  }
  downloadButton.classList.remove('busy');
  buttonLabel.textContent = 'Process link';
  downloadButton.querySelector('.button-icon').textContent = '↓';
  downloadButton.querySelector('.button-arrow').textContent = '↗';
  downloadButton.disabled = !setupReady;
}

function addActivity(payload, isSetup = false) {
  if (!payload || !payload.text) return;
  const empty = activityList.querySelector('.empty-activity');
  if (empty) empty.remove();
  activityCount += 1;
  const row = document.createElement('div');
  const type = ['success', 'error', 'warning', 'info'].includes(payload.type) ? payload.type : 'log';
  row.className = `activity-entry ${type}`;
  const dot = document.createElement('span');
  dot.className = 'entry-dot';
  const msg = document.createElement('span');
  msg.className = 'entry-text';
  msg.textContent = payload.text;
  const time = document.createElement('span');
  time.className = 'entry-time';
  time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  row.append(dot, msg, time);
  activityList.appendChild(row);
  while (activityList.children.length > 80) activityList.firstElementChild.remove();
  activityList.scrollTop = activityList.scrollHeight;
  $('activity-subtitle').textContent = isSetup ? 'Setup and update messages' : 'Setup and archive task messages';
}

function showEmptyActivity() {
  activityCount = 0;
  activityList.innerHTML = '<div class="empty-activity"><div class="empty-activity-icon">⌁</div><strong>All quiet for now</strong><span>Setup and download progress will appear here.</span></div>';
}

function showAgreement() {
  agreementAccepted = false;
  const screen = $('agreement-screen');
  screen.classList.remove('hidden');
  document.querySelector('.app-shell').inert = true;
  document.querySelector('.app-shell').setAttribute('aria-hidden', 'true');
  document.body.classList.add('agreement-open');
  $('agreement-checkbox').checked = false;
  $('agreement-continue').disabled = true;
  $('agreement-footer-note').textContent = 'You must check the box to continue. No dependency setup begins before acceptance.';
  $('agreement-checkbox').focus();
}

function hideAgreement() {
  $('agreement-screen').classList.add('hidden');
  document.querySelector('.app-shell').inert = false;
  document.querySelector('.app-shell').removeAttribute('aria-hidden');
  document.body.classList.remove('agreement-open');
  agreementAccepted = true;
}

async function initializeWorkspace() {
  setSetupState(null);
  try {
    const state = await window.spotdlStudio.initialize();
    if (state.outputFolder) updateFolder(state.outputFolder);
    setSetupState(state);
    if (state.updates) setUpdateStatus(state.updates);
  } catch (error) {
    setSetupState({ ready: false, error: error.message || 'Could not initialize the local archive engine.', errorCode: 'SETUP_FAILED' });
    addActivity({ type: 'error', text: error.message || String(error) }, true);
  }
}

async function bootstrap() {
  try {
    const gate = await window.spotdlStudio.checkAgreement();
    if (!gate || !gate.accepted) {
      showAgreement();
      return;
    }
    hideAgreement();
    await initializeWorkspace();
  } catch (error) {
    showAgreement();
    $('agreement-footer-note').textContent = `Could not verify the saved agreement: ${error.message || String(error)}. Restart the app and retry.`;
    $('agreement-continue').disabled = true;
  }
}

function setActiveView(view) {
  currentView = view;
  const workspace = view === 'workspace';
  $('workspace-view').classList.toggle('hidden', !workspace);
  $('about-view').classList.toggle('hidden', workspace);
  $('nav-new-download').classList.toggle('active', workspace);
  $('nav-about').classList.toggle('active', !workspace);
  if (workspace) {
    $('nav-new-download').setAttribute('aria-current', 'page');
    $('nav-about').removeAttribute('aria-current');
  } else {
    $('nav-about').setAttribute('aria-current', 'page');
    $('nav-new-download').removeAttribute('aria-current');
    loadLicenses().catch(error => {
      $('license-list').textContent = `Could not load license texts: ${error.message || String(error)}`;
    });
  }
}

function setUpdateStatus(summary) {
  if (!summary) return;
  const el = $('update-status');
  const checked = summary.checkedAt ? ` Last checked ${new Date(summary.checkedAt).toLocaleString()}.` : '';
  if (summary.status === 'current') el.textContent = `All checked components are current.${checked}`;
  else if (summary.status === 'updated' || summary.status === 'partially-updated') {
    const updated = (summary.items || []).filter(item => item.status === 'updated').map(item => `${item.name} ${item.currentVersion}`).join(', ');
    const partial = summary.status === 'partially-updated' ? ' Some upstream releases could not be checked.' : '';
    el.textContent = `${updated || 'Dependency check complete'}.${partial}${checked}`;
  } else if (summary.status === 'update-failed' || summary.status === 'verification-failed') {
    el.textContent = `${summary.error || 'An update could not be verified.'}${checked}`;
  } else if (summary.status === 'partially-checked' || summary.status === 'check-failed') {
    el.textContent = `${summary.error || 'Some versions could not be checked; the app will keep working with its local copy.'}${checked}`;
  } else if (summary.status === 'busy') el.textContent = summary.error || 'Finish the active archive task before updating.';
  else if (summary.status === 'not-ready') el.textContent = summary.error || 'Complete setup before updating.';
  else if (summary.status === 'unknown-version') el.textContent = 'A release was found but its version could not be compared.';
  else el.textContent = 'Update status has not been checked yet.';
}

async function loadLicenses() {
  if (licensesLoaded) return;
  $('license-list').textContent = 'Loading full license texts…';
  const result = await window.spotdlStudio.getLicenses();
  licenseEntries = Array.isArray(result && result.licenses) ? result.licenses : [];
  licensesLoaded = true;
  $('license-count').textContent = `${licenseEntries.length} notices`;
  $('license-list').replaceChildren();
  for (const entry of licenseEntries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'license-choice';
    button.setAttribute('role', 'option');
    button.dataset.licenseId = entry.id;
    const title = document.createElement('strong');
    title.textContent = entry.name;
    const subtitle = document.createElement('span');
    subtitle.textContent = entry.id === 'app-proprietary' ? 'Original application code' : 'Third-party license';
    button.append(title, subtitle);
    button.addEventListener('click', () => selectLicense(entry.id));
    $('license-list').appendChild(button);
  }
  if (result && result.updates) setUpdateStatus(result.updates);
  if (licenseEntries.length) selectLicense(selectedLicenseId || licenseEntries[0].id);
}

function selectLicense(id) {
  const entry = licenseEntries.find(item => item.id === id);
  if (!entry) return;
  selectedLicenseId = id;
  document.querySelectorAll('.license-choice').forEach(button => {
    const selected = button.dataset.licenseId === id;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
  $('license-title').textContent = entry.name;
  $('license-note').textContent = entry.note || 'Full license text.';
  $('license-text').textContent = entry.text || 'License text unavailable.';
  $('license-source-button').classList.toggle('hidden', !entry.url);
  $('license-source-button').onclick = () => entry.url && window.spotdlStudio.openUrl(entry.url);
}

$('nav-new-download').addEventListener('click', () => setActiveView('workspace'));
$('nav-about').addEventListener('click', () => setActiveView('about'));
$('agreement-checkbox').addEventListener('change', () => {
  $('agreement-continue').disabled = !$('agreement-checkbox').checked;
});
$('agreement-continue').addEventListener('click', async () => {
  const checked = $('agreement-checkbox').checked;
  $('agreement-continue').disabled = true;
  if (!checked) return;
  $('agreement-footer-note').textContent = 'Saving your acceptance…';
  try {
    const result = await window.spotdlStudio.acceptAgreement({ checked });
    if (!result || !result.ok) {
      $('agreement-footer-note').textContent = (result && result.error) || 'Could not save the agreement. Please try again.';
      $('agreement-continue').disabled = false;
      return;
    }
    hideAgreement();
    await initializeWorkspace();
  } catch (error) {
    $('agreement-footer-note').textContent = `Could not save your acceptance: ${error.message || String(error)}`;
    $('agreement-continue').disabled = false;
  }
});
document.addEventListener('keydown', event => {
  if (!agreementAccepted && !$('agreement-screen').classList.contains('hidden') && event.key === 'Escape') event.preventDefault();
});
$('check-updates-button').addEventListener('click', async () => {
  const button = $('check-updates-button');
  button.disabled = true;
  button.innerHTML = 'Checking…';
  $('update-status').textContent = 'Checking official GitHub stable releases. This may take a moment…';
  try {
    const result = await window.spotdlStudio.checkUpdates();
    setUpdateStatus(result);
    if (result && result.error) addActivity({ type: 'warning', text: result.error });
  } catch (error) {
    $('update-status').textContent = error.message || 'Update check failed.';
    addActivity({ type: 'warning', text: error.message || String(error) });
  } finally {
    button.disabled = false;
    button.innerHTML = 'Check now <span>↻</span>';
  }
});

$('choose-folder').addEventListener('click', async () => {
  const result = await window.spotdlStudio.chooseFolder();
  if (result && !result.canceled) updateFolder(result.outputFolder);
});

$('open-folder-sidebar').addEventListener('click', async () => {
  await window.spotdlStudio.openFolder();
});

$('clear-url').addEventListener('click', () => {
  urlInput.value = '';
  urlInput.focus();
});

$('python-button').addEventListener('click', () => window.spotdlStudio.openPythonDownloads());
$('retry-setup-button').addEventListener('click', async () => {
  $('retry-setup-button').disabled = true;
  setSetupState(null);
  addActivity({ type: 'info', text: 'Retrying SpotDL setup…' }, true);
  try {
    const state = await window.spotdlStudio.retrySetup();
    setSetupState(state);
  } catch (error) {
    setSetupState({ ready: false, error: error.message || 'Could not retry setup.', errorCode: 'SETUP_FAILED' });
  } finally {
    $('retry-setup-button').disabled = false;
  }
});
$('clear-activity').addEventListener('click', showEmptyActivity);
$('spotdl-docs').addEventListener('click', () => window.spotdlStudio.openUrl('https://spotdl.readthedocs.io/en/latest/'));

function updateFolder(folder) {
  $('folder-name').textContent = formatFolderName(folder);
  $('folder-path').textContent = folder;
}

urlInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !downloadButton.disabled && !downloadRunning) startDownload();
});

downloadButton.addEventListener('click', async () => {
  if (downloadRunning) {
    await window.spotdlStudio.stopDownload();
    return;
  }
  startDownload();
});

async function startDownload() {
  const url = urlInput.value.trim();
  if (!url) {
    addActivity({ type: 'warning', text: 'Paste a Spotify link to start.' });
    urlInput.focus();
    return;
  }
  downloadRunning = true;
  updateButton();
  $('activity-footer-text').textContent = 'Archive task in progress';
  $('sidebar-status').textContent = 'Archive task running';
  $('sidebar-light').classList.remove('ready');
  addActivity({ type: 'info', text: 'Preparing your local archive task…' });
  const result = await window.spotdlStudio.startDownload({ url, format: formatSelect.value });
  if (!result || !result.ok) {
    if (result && result.error) addActivity({ type: 'error', text: result.error });
    if (result && result.errorCode === 'MISSING_PYTHON') {
      setSetupState({ ready: false, error: result.error, errorCode: result.errorCode });
    }
  }
  // The state event normally clears this; also recover if the bridge returned early.
  if (!downloadRunning) return;
  if (!result || !result.ok) {
    downloadRunning = false;
    updateButton();
    $('sidebar-status').textContent = setupReady ? 'Engine ready' : 'Setup required';
    $('activity-footer-text').textContent = setupReady ? 'Ready for a download' : 'Setup required';
  }
}

window.spotdlStudio.onSetupProgress(payload => {
  addActivity(payload, true);
  if (payload.type === 'error') {
    setSetupState({ ready: false, error: payload.text, errorCode: /Python 3\.10|compatible Python/i.test(payload.text) ? 'MISSING_PYTHON' : 'SETUP_FAILED' });
  } else if (payload.type === 'success') {
    setSetupState({ ready: true, version: payload.text.match(/SpotDL\s+([^\s]+)\s+is ready/i)?.[1] || 'installed' });
  } else if (payload.type === 'info' && /Preparing|Checking|Installing|Creating|Setting up|Using Python/i.test(payload.text)) {
    setSetupState({ ready: false });
    $('setup-title').textContent = 'Preparing SpotDL';
    $('setup-description').textContent = payload.text;
  }
});

window.spotdlStudio.onDownloadLog(payload => addActivity(payload, false));
window.spotdlStudio.onDownloadState(state => {
  downloadRunning = Boolean(state && state.running);
  updateButton();
  if (state && state.running) {
    $('activity-footer-text').textContent = 'Archive task in progress';
    $('sidebar-status').textContent = 'Archive task running';
    $('sidebar-light').classList.remove('ready');
  } else {
    $('sidebar-status').textContent = setupReady ? 'Engine ready' : 'Setup required';
    $('sidebar-light').classList.toggle('ready', setupReady);
    if (state && state.stopped) $('activity-footer-text').textContent = 'Archive task stopped';
    else if (state && state.error) $('activity-footer-text').textContent = 'Archive task failed';
    else if (state && state.exitCode === 0) $('activity-footer-text').textContent = 'Archive task complete';
    else $('activity-footer-text').textContent = setupReady ? 'Ready for a download' : 'Setup required';
  }
});

window.spotdlStudio.onDependencyUpdate(payload => {
  addActivity(payload, true);
  if (payload && payload.text) $('update-status').textContent = payload.text;
});

bootstrap();
