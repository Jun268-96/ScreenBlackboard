// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// Electron API를 안전하게 노출
contextBridge.exposeInMainWorld('electronAPI', {
  // 창 제어
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  setAlwaysOnTop: (value) => ipcRenderer.send('set-always-on-top', value),

  // 데이터 저장 및 로드 (ipcRenderer를 통해)
  saveContent: (content) => ipcRenderer.send('save-content', content),
  loadContent: () => ipcRenderer.invoke('load-content'),

  // 앱 종료 전 저장 이벤트 리스너
  onSaveBeforeQuit: (callback) => ipcRenderer.on('save-before-quit', callback),
});

// 파일 시스템 기반 데이터 저장 API
contextBridge.exposeInMainWorld('storageAPI', {
  setItem: async (key, value) => {
    try {
      return await ipcRenderer.invoke('save-data', key, value);
    } catch (error) {
      console.error('데이터 저장 오류:', error);
      return false;
    }
  },
  getItem: async (key) => {
    try {
      return await ipcRenderer.invoke('load-data', key);
    } catch (error) {
      console.error('데이터 로드 오류:', error);
      return null;
    }
  }
});