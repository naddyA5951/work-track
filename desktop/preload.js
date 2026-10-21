/**
 * QuietPulse Electron Preload Script (`desktop/preload.js`)
 * Safely bridges Windows Focus Assist / DND IPC controls into the React Renderer.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronDnd', {
  isElectron: true,
  platform: process.platform,
  getStatus: () => ipcRenderer.invoke('dnd:status'),
  enableDnd: (options) => ipcRenderer.invoke('dnd:enable', options),
  restoreDnd: () => ipcRenderer.invoke('dnd:restore'),
});
