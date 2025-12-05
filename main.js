const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// ?섍꼍?ㅼ젙 ?곗씠?????寃쎈줈
const USER_DATA_PATH = path.join(app.getPath('userData'), 'chalkboard-data.json');
const CHALKBOARD_DATA_PATH = path.join(app.getPath('userData'), 'chalkboard-content.json');
const TIMETABLE_DATA_PATH = path.join(app.getPath('userData'), 'timetable-content.json');

// ?좏뵆由ъ??댁뀡 ?꾩씠肄?寃쎈줈 (32x32 ?ш린媛 沅뚯옣??
const ICON_PATH = path.join(__dirname, 'icons', 'favicon.ico');

let mainWindow;
let tray = null;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  
  // 硫붿씤 ?덈룄???앹꽦
  mainWindow = new BrowserWindow({
    width: Math.min(width, 1200),
    height: Math.min(height, 800),
    frame: false, // ?꾨젅???녿뒗 李?
    transparent: false,
    backgroundColor: '#262626', // 移좏뙋 諛곌꼍???낅뜲?댄듃
    icon: ICON_PATH, // ?좏뵆由ъ??댁뀡 ?꾩씠肄??ㅼ젙
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // ???섏씠吏 濡쒕뱶
  mainWindow.loadFile('index.html');
  
  // 媛쒕컻 ?섍꼍?먯꽌留?媛쒕컻?????닿린
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // 李??ㅼ젙 ???濡쒕뱶
  loadWindowSettings();
  
  // 李??ロ옄 ???ㅼ젙 ???
  mainWindow.on('close', (event) => {
    // 移좏뙋 ?곗씠??????붿껌
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('save-before-quit');
    }
    saveWindowSettings();
  });
  
  // ?쒖뒪???몃젅???ㅼ젙
  createTray();
}

// ?깆씠 以鍮꾨릺硫??덈룄???앹꽦
app.on('ready', () => {
  createWindow();

  // ?먮룞 ?ㅽ뻾 ?ㅼ젙 (?⑦궎吏뺣맂 ?깆뿉?쒕쭔)
  if (app.isPackaged) { 
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath, // ?꾩옱 ?ㅽ뻾 ?뚯씪 寃쎈줈 ?ъ슜
      args: []
    });
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// ??醫낅즺 ???곗씠?????
app.on('before-quit', async (event) => {
  console.log('?봽 ??醫낅즺 ???곗씠??????쒖옉');

  if (mainWindow && !mainWindow.isDestroyed()) {
    event.preventDefault();

    try {
      // ?뚮뜑?ъ뿉 ????붿껌
      mainWindow.webContents.send('save-before-quit');

      // ????꾨즺源뚯? ?좎떆 ?湲?
      await new Promise(resolve => setTimeout(resolve, 500));

      console.log('????醫낅즺 ???곗씠??????꾨즺');
    } catch (error) {
      console.error('????醫낅즺 ??????ㅻ쪟:', error);
    }

    // ?ㅼ젣 醫낅즺
    app.exit(0);
  }
});

// 紐⑤뱺 李쎌씠 ?ロ엳硫???醫낅즺 (macOS ?쒖쇅)
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// 李??ㅼ젙 ???
function saveWindowSettings() {
  if (!mainWindow) return;
  
  const bounds = mainWindow.getBounds();
  const isAlwaysOnTop = mainWindow.isAlwaysOnTop();
  
  const data = {
    bounds,
    isAlwaysOnTop
  };
  
  try {
    fs.writeFileSync(USER_DATA_PATH, JSON.stringify(data));
  } catch (error) {
    console.error('Failed to save window settings:', error);
  }
}

// 李??ㅼ젙 濡쒕뱶
function loadWindowSettings() {
  try {
    if (fs.existsSync(USER_DATA_PATH)) {
      const data = JSON.parse(fs.readFileSync(USER_DATA_PATH));
      
      if (data.bounds) {
        mainWindow.setBounds(data.bounds);
      }
      
      // Always-on-top ?곹깭 蹂듭썝
      if (typeof data.isAlwaysOnTop === 'boolean') {
        mainWindow.setAlwaysOnTop(data.isAlwaysOnTop);
      }
    }
  } catch (error) {
    console.error('Failed to load window settings:', error);
  }
}

// ?쒖뒪???몃젅???앹꽦 ?⑥닔
function createTray() {
  // ?몃젅???꾩씠肄섏씠 ?대? ?덉쑝硫??덈줈 ?앹꽦?섏? ?딆쓬
  if (tray) return;
  
  try {
    // ?꾩씠肄??앹꽦 (?뚯씪???놁쑝硫?湲곕낯 ?꾩씠肄??ъ슜)
    let trayIcon;
    try {
      if (fs.existsSync(ICON_PATH)) {
        trayIcon = nativeImage.createFromPath(ICON_PATH);
      } else {
        // 湲곕낯 ?꾩씠肄??ъ슜 (Electron 湲곕낯 ?꾩씠肄?
        console.log('?꾩씠肄??뚯씪??李얠쓣 ???놁뼱 湲곕낯 ?꾩씠肄섏쓣 ?ъ슜?⑸땲??');
      }
    } catch (error) {
      console.error('?꾩씠肄?濡쒕뱶 ?ㅻ쪟:', error);
    }
    
    // ?몃젅???앹꽦
    tray = new Tray(trayIcon || nativeImage.createEmpty());
    tray.setToolTip('?붾㈃ 移좏뙋');
    
    // ?몃젅??硫붾돱 ?ㅼ젙
    const contextMenu = Menu.buildFromTemplate([
      { 
        label: '移좏뙋 ?쒖떆', 
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        } 
      },
      { type: 'separator' },
      { 
        label: '醫낅즺', 
        click: () => {
          app.quit();
        } 
      }
    ]);
    
    tray.setContextMenu(contextMenu);
    
    // ?몃젅???꾩씠肄??대┃ ???덈룄???쒖떆/?④? ?좉?
    tray.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });
  } catch (error) {
    console.error('?몃젅???앹꽦 ?ㅻ쪟:', error);
  }
}

// IPC ?대깽??泥섎━
ipcMain.on('set-always-on-top', (event, value) => {
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(value);
    console.log('Always on top set to:', value);
    
    // 利됱떆 ?ㅼ젙 ???
    saveWindowSettings();
  }
});

// 湲곕낯 李?而⑦듃濡?湲곕뒫
ipcMain.on('minimize-window', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.on('maximize-window', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('close-window', () => {
  app.quit();
});

// ?곗씠?????諛?濡쒕뱶 IPC ?몃뱾??
ipcMain.handle('save-data', (event, key, data) => {
  try {
    let filePath;
    if (key === 'chalkboard-data') {
      filePath = CHALKBOARD_DATA_PATH;
    } else if (key === 'timetable-data') {
      filePath = TIMETABLE_DATA_PATH;
    } else {
      return false;
    }
    
    fs.writeFileSync(filePath, data);
    console.log(`???곗씠??????깃났: ${key}`);
    return true;
  } catch (error) {
    console.error(`???곗씠??????ㅽ뙣: ${key}`, error);
    return false;
  }
});

ipcMain.handle('load-data', (event, key) => {
  try {
    let filePath;
    if (key === 'chalkboard-data') {
      filePath = CHALKBOARD_DATA_PATH;
    } else if (key === 'timetable-data') {
      filePath = TIMETABLE_DATA_PATH;
    } else {
      return null;
    }
    
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      console.log(`???곗씠??濡쒕뱶 ?깃났: ${key}`);
      return data;
    }
    return null;
  } catch (error) {
    console.error(`???곗씠??濡쒕뱶 ?ㅽ뙣: ${key}`, error);
    return null;
  }
});

