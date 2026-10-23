'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Cầu nối tối thiểu giữa renderer và main process.
// Không bật nodeIntegration; mọi thứ renderer cần đều đi qua đây.
contextBridge.exposeInMainWorld('pet', {
  setIgnoreMouse: (ignore) => ipcRenderer.send('pet:ignore-mouse', Boolean(ignore)),
  quit: () => ipcRenderer.send('pet:quit'),
  listModels: () => ipcRenderer.invoke('pet:list-models'),
  loadSettings: () => ipcRenderer.invoke('pet:load-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('pet:save-settings', settings)
});
