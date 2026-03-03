const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const WINDOW_SETTINGS_PATH = path.join(app.getPath('userData'), 'window-settings.json');
const LEGACY_WINDOW_SETTINGS_PATH = path.join(app.getPath('userData'), 'chalkboard-data.json');
const CHALKBOARD_DATA_PATH = path.join(app.getPath('userData'), 'chalkboard-content.json');
const TIMETABLE_DATA_PATH = path.join(app.getPath('userData'), 'timetable-content.json');
const SNAPSHOTS_DATA_PATH = path.join(app.getPath('userData'), 'snapshots-content.json');
const APP_SETTINGS_DATA_PATH = path.join(app.getPath('userData'), 'app-settings.json');
const SESSION_STATE_PATH = path.join(app.getPath('userData'), 'session-state.json');
const ICON_PATH = path.join(__dirname, 'icons', 'favicon.ico');

const DATA_FILE_MAP = {
  'chalkboard-data': CHALKBOARD_DATA_PATH,
  'timetable-data': TIMETABLE_DATA_PATH,
  'chalkboard-snapshots': SNAPSHOTS_DATA_PATH,
  'app-settings': APP_SETTINGS_DATA_PATH
};

let mainWindow;
let tray = null;
let isQuitting = false;
let startupState = {
  wasUncleanExit: false,
  startedAt: Date.now()
};

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Failed to read JSON: ${filePath}`, error);
    return null;
  }
}

function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
    return true;
  } catch (error) {
    console.error(`Failed to write JSON: ${filePath}`, error);
    return false;
  }
}

function getCurrentDisplay() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }
  return screen.getDisplayMatching(mainWindow.getBounds());
}

function getDisplayId(display) {
  if (!display) {
    return null;
  }
  return String(display.id);
}

function initSessionState() {
  const previousState = readJsonFile(SESSION_STATE_PATH);
  const wasUncleanExit = Boolean(previousState && previousState.running);

  startupState = {
    wasUncleanExit,
    startedAt: Date.now()
  };

  writeJsonFile(SESSION_STATE_PATH, {
    running: true,
    startedAt: startupState.startedAt
  });
}

function markSessionClosed() {
  writeJsonFile(SESSION_STATE_PATH, {
    running: false,
    closedAt: Date.now()
  });
}

function loadWindowSettings() {
  try {
    const modernData = readJsonFile(WINDOW_SETTINGS_PATH);
    const legacyData = modernData ? null : readJsonFile(LEGACY_WINDOW_SETTINGS_PATH);
    const data = modernData || legacyData;

    if (!data) {
      return;
    }

    if (typeof data.isAlwaysOnTop === 'boolean') {
      mainWindow.setAlwaysOnTop(data.isAlwaysOnTop);
    }

    if (data.perDisplayBounds && data.lastDisplayId) {
      const savedBounds = data.perDisplayBounds[data.lastDisplayId];
      if (savedBounds) {
        mainWindow.setBounds(savedBounds);
        return;
      }
    }

    if (data.bounds) {
      mainWindow.setBounds(data.bounds);
    }
  } catch (error) {
    console.error('Failed to load window settings:', error);
  }
}

function saveWindowSettings() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const existing = readJsonFile(WINDOW_SETTINGS_PATH) || {};
  const display = getCurrentDisplay();
  const displayId = getDisplayId(display) || 'unknown';

  const perDisplayBounds = existing.perDisplayBounds || {};
  perDisplayBounds[displayId] = mainWindow.getBounds();

  const data = {
    bounds: mainWindow.getBounds(),
    isAlwaysOnTop: mainWindow.isAlwaysOnTop(),
    lastDisplayId: displayId,
    perDisplayBounds
  };

  writeJsonFile(WINDOW_SETTINGS_PATH, data);
}

function moveWindowToDisplay(displayId) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  const targetId = String(displayId);
  const displays = screen.getAllDisplays();
  const targetDisplay = displays.find((display) => String(display.id) === targetId);

  if (!targetDisplay) {
    return false;
  }

  const settings = readJsonFile(WINDOW_SETTINGS_PATH) || {};
  const savedBounds = settings.perDisplayBounds && settings.perDisplayBounds[targetId];

  if (savedBounds) {
    mainWindow.setBounds(savedBounds);
  } else {
    const currentBounds = mainWindow.getBounds();
    const workArea = targetDisplay.workArea;
    const width = Math.min(currentBounds.width, workArea.width);
    const height = Math.min(currentBounds.height, workArea.height);
    const x = Math.round(workArea.x + (workArea.width - width) / 2);
    const y = Math.round(workArea.y + (workArea.height - height) / 2);
    mainWindow.setBounds({ x, y, width, height });
  }

  mainWindow.show();
  mainWindow.focus();
  saveWindowSettings();
  return true;
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(workArea.width, 1400),
    height: Math.min(workArea.height, 900),
    frame: false,
    transparent: false,
    backgroundColor: '#1b1b1b',
    icon: ICON_PATH,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  loadWindowSettings();
  createTray();

  mainWindow.on('close', () => {
    saveWindowSettings();
  });

  mainWindow.on('move', saveWindowSettings);
  mainWindow.on('resize', saveWindowSettings);
}

function requestSaveBeforeQuit(timeoutMs = 3000) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;

    const finalize = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      ipcMain.removeListener('save-before-quit-done', onDone);
      resolve();
    };

    const onDone = () => {
      finalize();
    };

    const timeoutId = setTimeout(finalize, timeoutMs);

    ipcMain.once('save-before-quit-done', onDone);

    try {
      mainWindow.webContents.send('save-before-quit');
    } catch (error) {
      console.error('Failed to request renderer save before quit:', error);
      finalize();
    }
  });
}

function createTray() {
  if (tray) {
    return;
  }

  try {
    const trayIcon = fs.existsSync(ICON_PATH)
      ? nativeImage.createFromPath(ICON_PATH)
      : nativeImage.createEmpty();

    tray = new Tray(trayIcon);
    tray.setToolTip('화면 칠판');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '칠판 표시',
        click: () => {
          if (!mainWindow) {
            return;
          }
          mainWindow.show();
          mainWindow.focus();
        }
      },
      { type: 'separator' },
      {
        label: '종료',
        click: () => {
          app.quit();
        }
      }
    ]);

    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
      if (!mainWindow) {
        return;
      }

      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (error) {
    console.error('Failed to create tray:', error);
  }
}

app.on('ready', () => {
  initSessionState();
  createWindow();

  if (app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
      args: []
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', async (event) => {
  if (isQuitting) {
    return;
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    markSessionClosed();
    return;
  }

  event.preventDefault();

  try {
    await requestSaveBeforeQuit();
  } catch (error) {
    console.error('Save-before-quit failed:', error);
  }

  saveWindowSettings();
  markSessionClosed();
  isQuitting = true;
  app.quit();
});

app.on('will-quit', () => {
  markSessionClosed();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.on('set-always-on-top', (event, value) => {
  if (!mainWindow) {
    return;
  }

  mainWindow.setAlwaysOnTop(Boolean(value));
  saveWindowSettings();
});

ipcMain.handle('get-window-state', () => {
  if (!mainWindow) {
    return { isAlwaysOnTop: false };
  }

  return {
    isAlwaysOnTop: mainWindow.isAlwaysOnTop()
  };
});

ipcMain.handle('get-startup-state', () => {
  return startupState;
});

ipcMain.handle('get-displays', () => {
  return screen.getAllDisplays().map((display) => ({
    id: String(display.id),
    label: display.label || `Display ${display.id}`,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor
  }));
});

ipcMain.handle('move-window-to-display', (event, displayId) => {
  return moveWindowToDisplay(displayId);
});

ipcMain.on('minimize-window', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.on('maximize-window', () => {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('close-window', () => {
  app.quit();
});

ipcMain.handle('save-data', (event, key, data) => {
  const filePath = DATA_FILE_MAP[key];
  if (!filePath) {
    return false;
  }

  try {
    fs.writeFileSync(filePath, data, 'utf-8');
    return true;
  } catch (error) {
    console.error(`Failed to save data: ${key}`, error);
    return false;
  }
});

ipcMain.handle('load-data', (event, key) => {
  const filePath = DATA_FILE_MAP[key];
  if (!filePath) {
    return null;
  }

  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    console.error(`Failed to load data: ${key}`, error);
    return null;
  }
});
