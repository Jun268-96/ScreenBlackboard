// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// Electron API를 안전하게 노출
contextBridge.exposeInMainWorld('electronAPI', {
  // 창 제어
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  
  // 데이터 저장 및 로드 (ipcRenderer를 통해)
  saveContent: (content) => ipcRenderer.send('save-content', content),
  loadContent: () => ipcRenderer.invoke('load-content'),
});