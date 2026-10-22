'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function listen(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const wrapped = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld('spotdlStudio', {
  checkAgreement: () => ipcRenderer.invoke('app:gate-check'),
  acceptAgreement: request => ipcRenderer.invoke('app:accept-agreement', request),
  initialize: () => ipcRenderer.invoke('app:init'),
  retrySetup: () => ipcRenderer.invoke('app:retry-setup'),
  checkUpdates: () => ipcRenderer.invoke('app:check-updates'),
  getLicenses: () => ipcRenderer.invoke('app:get-licenses'),
  chooseFolder: () => ipcRenderer.invoke('app:choose-folder'),
  openFolder: () => ipcRenderer.invoke('app:open-folder'),
  openPythonDownloads: () => ipcRenderer.invoke('app:open-python'),
  startDownload: request => ipcRenderer.invoke('spotdl:download', request),
  stopDownload: () => ipcRenderer.invoke('spotdl:stop'),
  openUrl: url => ipcRenderer.invoke('app:open-url', url),
  onSetupProgress: callback => listen('setup:progress', callback),
  onDownloadLog: callback => listen('download:log', callback),
  onDownloadState: callback => listen('download:state', callback),
  onDependencyUpdate: callback => listen('deps:update', callback)
});
