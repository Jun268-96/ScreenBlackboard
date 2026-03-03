const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),
  setAlwaysOnTop: (value) => ipcRenderer.send('set-always-on-top', value),
  getWindowState: () => ipcRenderer.invoke('get-window-state'),
  getStartupState: () => ipcRenderer.invoke('get-startup-state'),
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  moveWindowToDisplay: (displayId) => ipcRenderer.invoke('move-window-to-display', displayId),
  onSaveBeforeQuit: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('save-before-quit', listener);
    return () => ipcRenderer.removeListener('save-before-quit', listener);
  },
  notifySaveBeforeQuitDone: () => ipcRenderer.send('save-before-quit-done')
});

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
