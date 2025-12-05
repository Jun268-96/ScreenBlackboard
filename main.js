const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// 환경설정 데이터 저장 경로
const USER_DATA_PATH = path.join(app.getPath('userData'), 'chalkboard-data.json');
const CHALKBOARD_DATA_PATH = path.join(app.getPath('userData'), 'chalkboard-content.json');
const TIMETABLE_DATA_PATH = path.join(app.getPath('userData'), 'timetable-content.json');

// 애플리케이션 아이콘 경로 (32x32 크기가 권장됨)
const ICON_PATH = path.join(__dirname, 'icons', 'chalkboard-icon.png');

let mainWindow;
let tray = null;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  
  // 메인 윈도우 생성
  mainWindow = new BrowserWindow({
    width: Math.min(width, 1200),
    height: Math.min(height, 800),
    frame: false, // 프레임 없는 창
    transparent: false,
    backgroundColor: '#262626', // 칠판 배경색 업데이트
    icon: ICON_PATH, // 애플리케이션 아이콘 설정
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // 웹 페이지 로드
  mainWindow.loadFile('index.html');
  
  // 개발 환경에서만 개발자 툴 열기
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // 창 설정 저장 로드
  loadWindowSettings();
  
  // 창 닫힐 때 설정 저장
  mainWindow.on('close', (event) => {
    // 칠판 데이터 저장 요청
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('save-before-quit');
    }
    saveWindowSettings();
  });
  
  // 시스템 트레이 설정
  createTray();
}

// 앱이 준비되면 윈도우 생성
app.on('ready', () => {
  createWindow();

  // 자동 실행 설정 (패키징된 앱에서만)
  if (app.isPackaged) { 
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath, // 현재 실행 파일 경로 사용
      args: []
    });
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 앱 종료 전 데이터 저장
app.on('before-quit', async (event) => {
  console.log('🔄 앱 종료 전 데이터 저장 시작');

  if (mainWindow && !mainWindow.isDestroyed()) {
    event.preventDefault();

    try {
      // 렌더러에 저장 요청
      mainWindow.webContents.send('save-before-quit');

      // 저장 완료까지 잠시 대기
      await new Promise(resolve => setTimeout(resolve, 500));

      console.log('✅ 앱 종료 전 데이터 저장 완료');
    } catch (error) {
      console.error('❌ 앱 종료 전 저장 오류:', error);
    }

    // 실제 종료
    app.exit(0);
  }
});

// 모든 창이 닫히면 앱 종료 (macOS 제외)
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// 창 설정 저장
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

// 창 설정 로드
function loadWindowSettings() {
  try {
    if (fs.existsSync(USER_DATA_PATH)) {
      const data = JSON.parse(fs.readFileSync(USER_DATA_PATH));
      
      if (data.bounds) {
        mainWindow.setBounds(data.bounds);
      }
      
      // Always-on-top 상태 복원
      if (typeof data.isAlwaysOnTop === 'boolean') {
        mainWindow.setAlwaysOnTop(data.isAlwaysOnTop);
      }
    }
  } catch (error) {
    console.error('Failed to load window settings:', error);
  }
}

// 시스템 트레이 생성 함수
function createTray() {
  // 트레이 아이콘이 이미 있으면 새로 생성하지 않음
  if (tray) return;
  
  try {
    // 아이콘 생성 (파일이 없으면 기본 아이콘 사용)
    let trayIcon;
    try {
      if (fs.existsSync(ICON_PATH)) {
        trayIcon = nativeImage.createFromPath(ICON_PATH);
      } else {
        // 기본 아이콘 사용 (Electron 기본 아이콘)
        console.log('아이콘 파일을 찾을 수 없어 기본 아이콘을 사용합니다.');
      }
    } catch (error) {
      console.error('아이콘 로드 오류:', error);
    }
    
    // 트레이 생성
    tray = new Tray(trayIcon || nativeImage.createEmpty());
    tray.setToolTip('화면 칠판');
    
    // 트레이 메뉴 설정
    const contextMenu = Menu.buildFromTemplate([
      { 
        label: '칠판 표시', 
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
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
    
    // 트레이 아이콘 클릭 시 윈도우 표시/숨김 토글
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
    console.error('트레이 생성 오류:', error);
  }
}

// IPC 이벤트 처리
ipcMain.on('set-always-on-top', (event, value) => {
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(value);
    console.log('Always on top set to:', value);
    
    // 즉시 설정 저장
    saveWindowSettings();
  }
});

// 기본 창 컨트롤 기능
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

// 데이터 저장 및 로드 IPC 핸들러
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
    console.log(`✅ 데이터 저장 성공: ${key}`);
    return true;
  } catch (error) {
    console.error(`❌ 데이터 저장 실패: ${key}`, error);
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
      console.log(`✅ 데이터 로드 성공: ${key}`);
      return data;
    }
    return null;
  } catch (error) {
    console.error(`❌ 데이터 로드 실패: ${key}`, error);
    return null;
  }
});
