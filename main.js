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
const DRAWINGS_DIR = path.join(app.getPath('userData'), 'drawings');
const ICON_PATH = path.join(__dirname, 'icons', 'favicon.ico');
const PNG_ICON_PATH = path.join(__dirname, 'icons', 'chalkboard-icon.png');

const DATA_FILE_MAP = {
  'chalkboard-data': CHALKBOARD_DATA_PATH,
  'timetable-data': TIMETABLE_DATA_PATH,
  'chalkboard-snapshots': SNAPSHOTS_DATA_PATH,
  'app-settings': APP_SETTINGS_DATA_PATH
};

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow;
let tray = null;
let isQuitting = false;
let windowSettingsSaveTimer = null;
let startupState = {
  wasUncleanExit: false,
  startedAt: Date.now()
};

function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch (error) {
    console.error(`Failed to create directory: ${dirPath}`, error);
  }
}

function writeFileAtomic(filePath, data, encoding = 'utf-8') {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  try {
    ensureDir(path.dirname(filePath));
    if (encoding) {
      fs.writeFileSync(tmpPath, data, encoding);
    } else {
      fs.writeFileSync(tmpPath, data);
    }
    try {
      fs.renameSync(tmpPath, filePath);
    } catch (renameError) {
      fs.copyFileSync(tmpPath, filePath);
      fs.unlinkSync(tmpPath);
    }
    return true;
  } catch (error) {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch (cleanupError) {
      // Ignore temp cleanup errors.
    }
    console.error(`Failed to write file: ${filePath}`, error);
    return false;
  }
}

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
  return writeFileAtomic(filePath, JSON.stringify(data), 'utf-8');
}

function sanitizeDrawingName(name) {
  const base = path.basename(String(name || '')).replace(/[^a-zA-Z0-9._-]/g, '');
  if (!base || base === '.' || base === '..') {
    return null;
  }
  return base.endsWith('.png') ? base : `${base}.png`;
}

function drawingPathFor(name) {
  const safeName = sanitizeDrawingName(name);
  if (!safeName) {
    return null;
  }
  return path.join(DRAWINGS_DIR, safeName);
}

function dataUrlToBuffer(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    return null;
  }
  const comma = dataUrl.indexOf(',');
  if (comma < 0) {
    return null;
  }
  try {
    return Buffer.from(dataUrl.slice(comma + 1), 'base64');
  } catch (error) {
    console.error('Failed to decode drawing data URL', error);
    return null;
  }
}

function bufferToPngDataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString('base64')}`;
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

function boundsOverlapWorkArea(bounds, workArea, minOverlap = 80) {
  if (!bounds || !workArea) {
    return false;
  }
  const overlapW = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
  const overlapH = Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y);
  return overlapW > minOverlap && overlapH > minOverlap;
}

function isBoundsOnAnyDisplay(bounds) {
  return screen.getAllDisplays().some((display) => boundsOverlapWorkArea(bounds, display.workArea));
}

function clampBoundsToDisplay(bounds, display) {
  const workArea = display.workArea;
  const width = Math.min(Math.max(360, bounds.width || 1400), workArea.width);
  const height = Math.min(Math.max(240, bounds.height || 900), workArea.height);
  const x = Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width);
  const y = Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function resolveUsableBounds(bounds, preferredDisplayId) {
  if (!bounds) {
    return null;
  }

  const displays = screen.getAllDisplays();
  const preferred = displays.find((display) => String(display.id) === String(preferredDisplayId));
  if (preferred && boundsOverlapWorkArea(bounds, preferred.workArea)) {
    return clampBoundsToDisplay(bounds, preferred);
  }

  const matching = displays.find((display) => boundsOverlapWorkArea(bounds, display.workArea));
  if (matching) {
    return clampBoundsToDisplay(bounds, matching);
  }

  const fallback = preferred || screen.getPrimaryDisplay();
  return clampBoundsToDisplay({
    x: fallback.workArea.x,
    y: fallback.workArea.y,
    width: Math.min(bounds.width || 1400, fallback.workArea.width),
    height: Math.min(bounds.height || 900, fallback.workArea.height)
  }, fallback);
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
    const legacyLooksLikeWindow = !modernData ? readJsonFile(LEGACY_WINDOW_SETTINGS_PATH) : null;
    const data = modernData || (
      legacyLooksLikeWindow && (legacyLooksLikeWindow.bounds || legacyLooksLikeWindow.perDisplayBounds)
        ? legacyLooksLikeWindow
        : null
    );

    if (!data) {
      return;
    }

    if (typeof data.isAlwaysOnTop === 'boolean') {
      applyAlwaysOnTop(data.isAlwaysOnTop);
    }

    if (data.perDisplayBounds && data.lastDisplayId) {
      const savedBounds = data.perDisplayBounds[data.lastDisplayId];
      const usable = resolveUsableBounds(savedBounds, data.lastDisplayId);
      if (usable) {
        mainWindow.setBounds(usable);
        return;
      }
    }

    const usable = resolveUsableBounds(data.bounds, data.lastDisplayId);
    if (usable) {
      mainWindow.setBounds(usable);
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

function scheduleSaveWindowSettings() {
  if (windowSettingsSaveTimer) {
    clearTimeout(windowSettingsSaveTimer);
  }
  windowSettingsSaveTimer = setTimeout(() => {
    windowSettingsSaveTimer = null;
    saveWindowSettings();
  }, 250);
}

function applyAlwaysOnTop(value) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const enabled = Boolean(value);
  try {
    mainWindow.setAlwaysOnTop(enabled, 'floating');
  } catch (error) {
    mainWindow.setAlwaysOnTop(enabled);
  }

  try {
    mainWindow.setVisibleOnAllWorkspaces(enabled, { visibleOnFullScreen: true });
  } catch (error) {
    // Some platforms reject visibleOnFullScreen.
  }
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
  const usable = resolveUsableBounds(savedBounds || {
    x: targetDisplay.workArea.x,
    y: targetDisplay.workArea.y,
    width: Math.min(mainWindow.getBounds().width, targetDisplay.workArea.width),
    height: Math.min(mainWindow.getBounds().height, targetDisplay.workArea.height)
  }, targetId) || clampBoundsToDisplay(mainWindow.getBounds(), targetDisplay);

  mainWindow.setBounds(usable);
  mainWindow.show();
  mainWindow.focus();
  saveWindowSettings();
  return true;
}

function resolveTrayIcon() {
  const pngExists = fs.existsSync(PNG_ICON_PATH);
  const icoExists = fs.existsSync(ICON_PATH);
  const preferred = process.platform === 'win32'
    ? (icoExists ? ICON_PATH : PNG_ICON_PATH)
    : (pngExists ? PNG_ICON_PATH : ICON_PATH);

  if (!preferred || !fs.existsSync(preferred)) {
    return nativeImage.createEmpty();
  }
  return nativeImage.createFromPath(preferred);
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

  mainWindow.on('close', (event) => {
    saveWindowSettings();
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('move', scheduleSaveWindowSettings);
  mainWindow.on('resize', scheduleSaveWindowSettings);
}

function requestSaveBeforeQuit(timeoutMs = 8000) {
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

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) {
    return;
  }

  try {
    tray = new Tray(resolveTrayIcon());
    tray.setToolTip('화면 칠판');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '칠판 표시',
        click: () => {
          showMainWindow();
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
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        showMainWindow();
      }
    });
  } catch (error) {
    console.error('Failed to create tray:', error);
  }
}

if (gotLock) {
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.on('ready', () => {
    ensureDir(DRAWINGS_DIR);
    initSessionState();
    createWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      showMainWindow();
    }
  });
}

app.on('before-quit', async (event) => {
  if (!gotLock || isQuitting) {
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
  if (!gotLock) {
    return;
  }
  markSessionClosed();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit();
  }
});

ipcMain.on('set-always-on-top', (event, value) => {
  applyAlwaysOnTop(value);
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
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
});

ipcMain.handle('save-data', (event, key, data) => {
  const filePath = DATA_FILE_MAP[key];
  if (!filePath) {
    return false;
  }
  return writeFileAtomic(filePath, data, 'utf-8');
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

ipcMain.handle('save-drawing', (event, name, dataUrl) => {
  const filePath = drawingPathFor(name);
  if (!filePath) {
    return false;
  }
  const buffer = dataUrlToBuffer(dataUrl);
  if (!buffer) {
    return false;
  }
  return writeFileAtomic(filePath, buffer, null);
});

ipcMain.handle('load-drawing', (event, name) => {
  const filePath = drawingPathFor(name);
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  try {
    const buffer = fs.readFileSync(filePath);
    return bufferToPngDataUrl(buffer);
  } catch (error) {
    console.error(`Failed to load drawing: ${name}`, error);
    return null;
  }
});

ipcMain.handle('delete-drawing', (event, name) => {
  const filePath = drawingPathFor(name);
  if (!filePath || !fs.existsSync(filePath)) {
    return true;
  }
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (error) {
    console.error(`Failed to delete drawing: ${name}`, error);
    return false;
  }
});
