const SAFE_PALETTE = [
  '#FFFFFF', '#000000', '#0072B2', '#009E73', '#E69F00', '#56B4E9', '#CC79A7', '#D55E00'
];

const CLASSIC_PALETTE = [
  '#FFFFFF', '#F87171', '#FBBF24', '#34D399', '#60A5FA', '#A78BFA', '#F472B6', '#94A3B8'
];

const BACKGROUND_BASE_COLORS = {
  plain: '#1e1e1e',
  lined: '#1e1e1e',
  grid: '#1f2023',
  coordinate: '#111827'
};

const DEFAULT_FORMAT_STATE = {
  fontSize: 72,
  color: '#ffffff',
  fontWeight: 'normal',
  fontStyle: 'normal',
  textDecoration: 'none'
};

const DEFAULT_SETTINGS = {
  editLocked: false,
  freezeMode: false,
  spotlightEnabled: false,
  maskEnabled: false,
  splitMode: false,
  splitTabId: null,
  highContrastTheme: false,
  safePalette: true,
  lowLatencyMode: false,
  touchOptimized: true,
  performancePreset: 'standard',
  sidebarWidth: 500,
  selectedMonitorId: null,
  spotlightRadius: 180,
  maskRevealPercent: 60,
  activeTool: 'text',
  drawColor: '#ffffff',
  drawSize: 6
};

const AUTO_SAVE_INTERVAL = 20000;
const AUTO_SNAPSHOT_INTERVAL = 120000;
const LOW_LATENCY_SNAPSHOT_INTERVAL = 300000;
const SNAPSHOT_LIMIT = 30;
const FONT_SIZE_STEPS = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, 84, 96, 112, 128, 144, 160, 180, 200];

let tabs = new Map();
let activeTabId = null;
let tabCounter = 0;
let textFormatter = new SimpleTextFormatter();
let storedSelection = null;
let snapshots = [];
let appSettings = { ...DEFAULT_SETTINGS };
let hasGlobalDocumentHandlers = false;
let isSpacePressed = false;
let autosaveTimer = null;
let autosnapshotTimer = null;
let debouncedSaveTimer = null;
let persistChain = Promise.resolve();
let isRestoringSnapshot = false;
let activePanState = null;
let touchPointers = new Map();
let penPointers = new Set();
let drawingStates = new Map();
let startupRecoveryFinished = false;
let hasUnsavedChanges = false;

class TabData {
  constructor(id, title) {
    this.id = id;
    this.title = title;
    this.content = '';
    this.formatState = { ...DEFAULT_FORMAT_STATE };
    this.drawingData = null;
    this.backgroundPreset = 'plain';
    this.viewState = {
      scale: 1,
      panX: 0,
      panY: 0
    };
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getSteppedFontSize(currentSize, direction) {
  const normalized = clamp(Math.round(Number(currentSize) || 72), 8, 200);
  if (direction > 0) {
    for (let i = 0; i < FONT_SIZE_STEPS.length; i += 1) {
      if (FONT_SIZE_STEPS[i] > normalized) {
        return FONT_SIZE_STEPS[i];
      }
    }
    return FONT_SIZE_STEPS[FONT_SIZE_STEPS.length - 1];
  }

  for (let i = FONT_SIZE_STEPS.length - 1; i >= 0; i -= 1) {
    if (FONT_SIZE_STEPS[i] < normalized) {
      return FONT_SIZE_STEPS[i];
    }
  }
  return FONT_SIZE_STEPS[0];
}

function applyFontSizeForTab(tabId, size, options = {}) {
  const dom = getTabDom(tabId);
  if (!dom.chalkboard) {
    return;
  }

  const clampedSize = clamp(Math.round(Number(size) || 72), 8, 200);
  if (options.restore !== false) {
    restoreSelection();
  }
  textFormatter.setFontSize(dom.chalkboard, clampedSize);
  saveSelection();
  updateToolbarState(tabId);
  markDirty();
}

function stepFontSizeForTab(tabId, direction) {
  const dom = getTabDom(tabId);
  if (!dom.chalkboard) {
    return;
  }
  const currentSize = textFormatter.getCurrentFormat(dom.chalkboard).fontSize || 72;
  const nextSize = getSteppedFontSize(currentSize, direction);
  applyFontSizeForTab(tabId, nextSize);
}

function getPalette() {
  return appSettings.safePalette ? SAFE_PALETTE : CLASSIC_PALETTE;
}

function getTabDom(tabId) {
  return {
    tabElement: document.querySelector(`.tab[data-tab-id="${tabId}"]`),
    content: document.querySelector(`.tab-content[data-tab-id="${tabId}"]`),
    toolbar: document.querySelector(`.toolbar[data-tab-id="${tabId}"]`),
    stage: document.querySelector(`.board-stage[data-tab-id="${tabId}"]`),
    transform: document.querySelector(`.board-transform[data-tab-id="${tabId}"]`),
    chalkboard: document.querySelector(`.chalkboard[data-tab-id="${tabId}"]`),
    canvas: document.querySelector(`.drawing-canvas[data-tab-id="${tabId}"]`),
    spotlightOverlay: document.querySelector(`.spotlight-overlay[data-tab-id="${tabId}"]`),
    maskOverlay: document.querySelector(`.mask-overlay[data-tab-id="${tabId}"]`),
    freezeOverlay: document.querySelector(`.freeze-overlay[data-tab-id="${tabId}"]`)
  };
}

function saveSelection() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }

  const range = selection.getRangeAt(0);
  storedSelection = {
    startContainer: range.startContainer,
    startOffset: range.startOffset,
    endContainer: range.endContainer,
    endOffset: range.endOffset
  };
}

function restoreSelection() {
  if (!storedSelection || !storedSelection.startContainer) {
    return false;
  }

  try {
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(storedSelection.startContainer, storedSelection.startOffset);
    range.setEnd(storedSelection.endContainer, storedSelection.endOffset);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  } catch (error) {
    console.error('Failed to restore selection:', error);
    storedSelection = null;
    return false;
  }
}

function insertNodeAtCursor(chalkboard, node) {
  if (!chalkboard) {
    return;
  }

  chalkboard.focus();
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    chalkboard.appendChild(node);
    return;
  }

  const range = selection.getRangeAt(0);
  const isInside = chalkboard.contains(range.commonAncestorContainer);

  if (!isInside) {
    chalkboard.appendChild(node);
    return;
  }

  range.deleteContents();
  range.insertNode(node);
  range.setStartAfter(node);
  range.setEndAfter(node);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertTextAtCursor(chalkboard, text) {
  const node = document.createTextNode(text);
  insertNodeAtCursor(chalkboard, node);
}

function parseColorToRgb(color) {
  const hex = color.startsWith('#') ? color : '#ffffff';
  const normalized = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;

  const value = normalized.slice(1);
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;

  return { r, g, b };
}

function relativeLuminance(color) {
  const { r, g, b } = parseColorToRgb(color);
  const transform = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const rr = transform(r);
  const gg = transform(g);
  const bb = transform(b);
  return (0.2126 * rr) + (0.7152 * gg) + (0.0722 * bb);
}

function contrastRatio(foreground, background) {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const brighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (brighter + 0.05) / (darker + 0.05);
}

function getBoardBackgroundColor(tabData) {
  if (appSettings.highContrastTheme) {
    return '#000000';
  }
  return BACKGROUND_BASE_COLORS[tabData.backgroundPreset] || BACKGROUND_BASE_COLORS.plain;
}

function serializeTabs() {
  captureAllTabContents();

  const serialized = {};
  tabs.forEach((tabData, tabId) => {
    serialized[tabId] = {
      id: tabData.id,
      title: tabData.title,
      content: tabData.content,
      formatState: tabData.formatState,
      drawingData: tabData.drawingData,
      backgroundPreset: tabData.backgroundPreset,
      viewState: tabData.viewState
    };
  });
  return serialized;
}

function captureTimetableItems() {
  const timetableList = document.getElementById('timetableList');
  if (!timetableList) {
    return [];
  }

  return [...timetableList.children].map((item) => ({
    subject: item.querySelector('.timetable-subject')?.value || '',
    checked: Boolean(item.querySelector('.timetable-checkbox')?.checked)
  }));
}

function captureSnapshotState() {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
    activeTabId,
    tabCounter,
    tabs: serializeTabs(),
    timetable: captureTimetableItems(),
    settings: { ...appSettings }
  };
}

async function saveAllTabsData() {
  const dataToSave = {
    tabs: serializeTabs(),
    activeTabId,
    tabCounter
  };

  try {
    if (window.storageAPI) {
      const success = await window.storageAPI.setItem('chalkboard-data', JSON.stringify(dataToSave));
      if (!success) {
        localStorage.setItem('chalkboard-data', JSON.stringify(dataToSave));
      }
    } else {
      localStorage.setItem('chalkboard-data', JSON.stringify(dataToSave));
    }
  } catch (error) {
    console.error('Chalkboard data save error:', error);
  }
}

async function loadAllTabsData() {
  try {
    let savedData = null;
    if (window.storageAPI) {
      savedData = await window.storageAPI.getItem('chalkboard-data');
    } else {
      savedData = localStorage.getItem('chalkboard-data');
    }

    if (!savedData) {
      return false;
    }

    const parsed = JSON.parse(savedData);
    if (!parsed.tabs || Object.keys(parsed.tabs).length === 0) {
      return false;
    }

    tabs.clear();
    tabCounter = 0;
    activeTabId = null;

    document.querySelector('.tabs-wrapper').innerHTML = '';
    document.getElementById('tabContents').innerHTML = '';

    Object.values(parsed.tabs).forEach((tabObj) => {
      createTab(tabObj.title || '칠판', {
        id: tabObj.id,
        data: tabObj,
        silent: true
      });
    });

    const targetTabId = parsed.activeTabId && tabs.has(parsed.activeTabId)
      ? parsed.activeTabId
      : tabs.keys().next().value;
    switchToTab(targetTabId);

    tabCounter = parsed.tabCounter || tabCounter;
    return true;
  } catch (error) {
    console.error('Chalkboard data load error:', error);
    return false;
  }
}

async function saveTimetable() {
  const items = captureTimetableItems();
  try {
    if (window.storageAPI) {
      const success = await window.storageAPI.setItem('timetable-data', JSON.stringify(items));
      if (!success) {
        localStorage.setItem('timetable-data', JSON.stringify(items));
      }
    } else {
      localStorage.setItem('timetable-data', JSON.stringify(items));
    }
  } catch (error) {
    console.error('Timetable data save error:', error);
  }
}

function appendTimetableItem(item, index) {
  const timetableList = document.getElementById('timetableList');
  const itemDiv = document.createElement('div');
  itemDiv.className = 'timetable-item';
  itemDiv.innerHTML = `
    <div class="timetable-number">${index + 1}</div>
    <input type="text" class="timetable-subject" value="${item.subject || ''}" placeholder="과목명을 입력하세요">
    <input type="checkbox" class="timetable-checkbox" ${item.checked ? 'checked' : ''}>
  `;

  const subjectInput = itemDiv.querySelector('.timetable-subject');
  const checkbox = itemDiv.querySelector('.timetable-checkbox');
  subjectInput.addEventListener('input', () => {
    markDirty();
    saveTimetable();
  });
  checkbox.addEventListener('change', () => {
    markDirty();
    saveTimetable();
  });

  timetableList.appendChild(itemDiv);
}

async function loadTimetable() {
  try {
    let savedData = null;
    if (window.storageAPI) {
      savedData = await window.storageAPI.getItem('timetable-data');
    } else {
      savedData = localStorage.getItem('timetable-data');
    }

    const timetableList = document.getElementById('timetableList');
    timetableList.innerHTML = '';

    if (!savedData) {
      updateTimetableLayout();
      return;
    }

    const items = JSON.parse(savedData);
    items.forEach((item, index) => appendTimetableItem(item, index));
    updateTimetableLayout();
  } catch (error) {
    console.error('Timetable data load error:', error);
  }
}

async function saveAppSettings() {
  try {
    if (window.storageAPI) {
      const success = await window.storageAPI.setItem('app-settings', JSON.stringify(appSettings));
      if (!success) {
        localStorage.setItem('app-settings', JSON.stringify(appSettings));
      }
    } else {
      localStorage.setItem('app-settings', JSON.stringify(appSettings));
    }
  } catch (error) {
    console.error('App settings save error:', error);
  }
}

async function loadAppSettings() {
  try {
    let savedData = null;
    if (window.storageAPI) {
      savedData = await window.storageAPI.getItem('app-settings');
    } else {
      savedData = localStorage.getItem('app-settings');
    }

    if (!savedData) {
      return;
    }

    const parsed = JSON.parse(savedData);
    appSettings = { ...DEFAULT_SETTINGS, ...parsed };
  } catch (error) {
    console.error('App settings load error:', error);
  }
}

async function saveSnapshots() {
  try {
    if (window.storageAPI) {
      const success = await window.storageAPI.setItem('chalkboard-snapshots', JSON.stringify(snapshots));
      if (!success) {
        localStorage.setItem('chalkboard-snapshots', JSON.stringify(snapshots));
      }
    } else {
      localStorage.setItem('chalkboard-snapshots', JSON.stringify(snapshots));
    }
  } catch (error) {
    console.error('Snapshot save error:', error);
  }
}

async function loadSnapshots() {
  try {
    let savedData = null;
    if (window.storageAPI) {
      savedData = await window.storageAPI.getItem('chalkboard-snapshots');
    } else {
      savedData = localStorage.getItem('chalkboard-snapshots');
    }

    snapshots = [];
    if (savedData) {
      const parsed = JSON.parse(savedData);
      if (Array.isArray(parsed)) {
        snapshots = parsed.slice(0, SNAPSHOT_LIMIT);
      }
    }
    renderSnapshotTimeline();
  } catch (error) {
    console.error('Snapshot load error:', error);
  }
}

async function createSnapshot(reason = '자동') {
  const snapshot = captureSnapshotState();
  snapshot.reason = reason;
  snapshots.unshift(snapshot);
  snapshots = snapshots.slice(0, SNAPSHOT_LIMIT);
  await saveSnapshots();
  renderSnapshotTimeline();
}

async function restoreSnapshot(snapshotId, options = {}) {
  const snapshot = snapshots.find((item) => item.id === snapshotId);
  if (!snapshot) {
    return;
  }

  isRestoringSnapshot = true;

  try {
    tabs.clear();
    tabCounter = 0;
    activeTabId = null;
    drawingStates.clear();

    document.querySelector('.tabs-wrapper').innerHTML = '';
    document.getElementById('tabContents').innerHTML = '';

    const snapshotTabs = snapshot.tabs || {};
    Object.values(snapshotTabs).forEach((tabObj) => {
      createTab(tabObj.title || '칠판', {
        id: tabObj.id,
        data: tabObj,
        silent: true
      });
    });

    const restoreTabId = snapshot.activeTabId && tabs.has(snapshot.activeTabId)
      ? snapshot.activeTabId
      : tabs.keys().next().value;
    switchToTab(restoreTabId);
    tabCounter = snapshot.tabCounter || tabCounter;

    const timetableList = document.getElementById('timetableList');
    timetableList.innerHTML = '';
    const snapshotTimetable = Array.isArray(snapshot.timetable) ? snapshot.timetable : [];
    snapshotTimetable.forEach((item, index) => appendTimetableItem(item, index));

    if (snapshot.settings) {
      appSettings = { ...appSettings, ...snapshot.settings };
      applySettingsToUI();
    }

    await queuePersist({ skipSnapshot: true, force: true });
  } catch (error) {
    console.error('Snapshot restore failed:', error);
  } finally {
    isRestoringSnapshot = false;
    if (!options.silent) {
      document.getElementById('snapshotPanel').classList.add('hidden');
    }
  }
}

async function deleteSnapshot(snapshotId) {
  snapshots = snapshots.filter((snapshot) => snapshot.id !== snapshotId);
  await saveSnapshots();
  renderSnapshotTimeline();
}

function renderSnapshotTimeline() {
  const list = document.getElementById('snapshotList');
  if (!list) {
    return;
  }

  list.innerHTML = '';

  if (snapshots.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'snapshot-empty';
    empty.textContent = '저장된 스냅샷이 없습니다.';
    list.appendChild(empty);
    return;
  }

  snapshots.forEach((snapshot) => {
    const item = document.createElement('div');
    item.className = 'snapshot-item';

    const created = new Date(snapshot.createdAt);
    const dateText = `${created.toLocaleDateString()} ${created.toLocaleTimeString()}`;

    item.innerHTML = `
      <div class="snapshot-meta">
        <div class="snapshot-reason">${snapshot.reason || '자동'}</div>
        <div class="snapshot-time">${dateText}</div>
      </div>
      <div class="snapshot-actions">
        <button class="snapshot-restore-btn">복원</button>
        <button class="snapshot-delete-btn">삭제</button>
      </div>
    `;

    item.querySelector('.snapshot-restore-btn').addEventListener('click', () => {
      restoreSnapshot(snapshot.id);
    });
    item.querySelector('.snapshot-delete-btn').addEventListener('click', () => {
      deleteSnapshot(snapshot.id);
    });

    list.appendChild(item);
  });
}

function markDirty(shouldSchedulePersist = true) {
  if (isRestoringSnapshot) {
    return;
  }

  hasUnsavedChanges = true;

  if (shouldSchedulePersist) {
    clearTimeout(debouncedSaveTimer);
    const delay = appSettings.lowLatencyMode ? 1800 : 900;
    debouncedSaveTimer = setTimeout(() => {
      queuePersist();
    }, delay);
  }
}

async function persistEverything(options = {}) {
  if (!hasUnsavedChanges && !options.snapshotReason && !options.force) {
    return;
  }

  captureAllTabContents();
  await saveAllTabsData();
  await saveTimetable();
  await saveAppSettings();

  if (!options.skipSnapshot && options.snapshotReason) {
    await createSnapshot(options.snapshotReason);
  }

  hasUnsavedChanges = false;
}

function queuePersist(options = {}) {
  persistChain = persistChain
    .then(() => persistEverything(options))
    .catch((error) => {
      console.error('Persist queue failed:', error);
    });
  return persistChain;
}

function startAutoPersistenceLoops() {
  if (autosaveTimer) {
    clearInterval(autosaveTimer);
  }
  if (autosnapshotTimer) {
    clearInterval(autosnapshotTimer);
  }

  autosaveTimer = setInterval(() => {
    if (hasUnsavedChanges) {
      queuePersist();
    }
  }, AUTO_SAVE_INTERVAL);

  const snapshotInterval = appSettings.lowLatencyMode
    ? LOW_LATENCY_SNAPSHOT_INTERVAL
    : AUTO_SNAPSHOT_INTERVAL;

  autosnapshotTimer = setInterval(() => {
    if (hasUnsavedChanges) {
      queuePersist({ snapshotReason: '자동' });
    }
  }, snapshotInterval);
}

async function handleManualSaveClick(buttonElement) {
  if (!buttonElement || buttonElement.dataset.state === 'saving') {
    return;
  }

  if (!buttonElement.dataset.defaultHtml) {
    buttonElement.dataset.defaultHtml = buttonElement.innerHTML;
  }

  const defaultHtml = buttonElement.dataset.defaultHtml;
  buttonElement.blur();
  buttonElement.disabled = true;
  buttonElement.dataset.state = 'saving';
  buttonElement.textContent = '저장중...';

  try {
    await queuePersist({ snapshotReason: '수동' });
    buttonElement.dataset.state = 'success';
    buttonElement.textContent = '저장 완료';
  } catch (error) {
    console.error('Manual save failed:', error);
    buttonElement.dataset.state = 'error';
    buttonElement.textContent = '저장 실패';
  }

  setTimeout(() => {
    buttonElement.dataset.state = '';
    buttonElement.innerHTML = defaultHtml;
    buttonElement.disabled = false;
  }, 1400);
}

function setupWindowControls() {
  const alwaysOnTopButton = document.getElementById('alwaysOnTopButton');
  const minimizeButton = document.getElementById('minimizeButton');
  const maximizeButton = document.getElementById('maximizeButton');
  const closeButton = document.getElementById('closeButton');
  const addTabButton = document.getElementById('addTabButton');
  const saveButton = document.getElementById('saveButton');

  let isAlwaysOnTop = false;

  if (window.electronAPI?.getWindowState) {
    window.electronAPI.getWindowState().then((state) => {
      isAlwaysOnTop = Boolean(state && state.isAlwaysOnTop);
      alwaysOnTopButton.classList.toggle('active', isAlwaysOnTop);
      alwaysOnTopButton.title = isAlwaysOnTop ? '항상 위에 (설정)' : '항상 위에';
    }).catch(() => {});
  }

  alwaysOnTopButton?.addEventListener('click', () => {
    if (!window.electronAPI) {
      return;
    }
    isAlwaysOnTop = !isAlwaysOnTop;
    window.electronAPI.setAlwaysOnTop(isAlwaysOnTop);
    alwaysOnTopButton.classList.toggle('active', isAlwaysOnTop);
    alwaysOnTopButton.title = isAlwaysOnTop ? '항상 위에 (설정)' : '항상 위에';
  });

  minimizeButton?.addEventListener('click', () => {
    window.electronAPI?.minimizeWindow();
  });
  maximizeButton?.addEventListener('click', () => {
    window.electronAPI?.maximizeWindow();
  });
  closeButton?.addEventListener('click', () => {
    window.electronAPI?.closeWindow();
  });

  addTabButton?.addEventListener('click', () => {
    createTab(`칠판 ${tabCounter + 1}`);
    markDirty();
  });

  saveButton?.addEventListener('click', async () => {
    await handleManualSaveClick(saveButton);
  });
}

function updateHeaderButtonStates() {
  document.getElementById('lockModeButton')?.classList.toggle('active', appSettings.editLocked);
  document.getElementById('freezeModeButton')?.classList.toggle('active', appSettings.freezeMode);
  document.getElementById('spotlightButton')?.classList.toggle('active', appSettings.spotlightEnabled);
  document.getElementById('maskButton')?.classList.toggle('active', appSettings.maskEnabled);
  document.getElementById('splitButton')?.classList.toggle('active', appSettings.splitMode);
}

function toggleSetting(key, value = null) {
  if (!(key in appSettings)) {
    return;
  }
  appSettings[key] = value === null ? !appSettings[key] : value;
  applySettingsToUI();
  markDirty();
}

function setupHeaderActions() {
  document.getElementById('lockModeButton')?.addEventListener('click', () => {
    toggleSetting('editLocked');
  });
  document.getElementById('freezeModeButton')?.addEventListener('click', () => {
    toggleSetting('freezeMode');
  });
  document.getElementById('spotlightButton')?.addEventListener('click', () => {
    toggleSetting('spotlightEnabled');
  });
  document.getElementById('maskButton')?.addEventListener('click', () => {
    toggleSetting('maskEnabled');
  });
  document.getElementById('splitButton')?.addEventListener('click', () => {
    toggleSetting('splitMode');
    updateSplitModeView();
  });
  document.getElementById('snapshotButton')?.addEventListener('click', () => {
    document.getElementById('snapshotPanel')?.classList.toggle('hidden');
  });
  document.getElementById('settingsButton')?.addEventListener('click', () => {
    document.getElementById('settingsPanel')?.classList.toggle('hidden');
  });
}

function setupPanels() {
  document.getElementById('closeSettingsPanelButton')?.addEventListener('click', () => {
    document.getElementById('settingsPanel')?.classList.add('hidden');
  });

  document.getElementById('closeSnapshotPanelButton')?.addEventListener('click', () => {
    document.getElementById('snapshotPanel')?.classList.add('hidden');
  });

  document.getElementById('createSnapshotButton')?.addEventListener('click', async () => {
    await createSnapshot('수동 생성');
  });

  document.getElementById('moveMonitorButton')?.addEventListener('click', async () => {
    const monitorSelect = document.getElementById('monitorSelect');
    const displayId = monitorSelect?.value;
    if (!displayId || !window.electronAPI?.moveWindowToDisplay) {
      return;
    }

    const moved = await window.electronAPI.moveWindowToDisplay(displayId);
    if (moved) {
      appSettings.selectedMonitorId = displayId;
      markDirty();
    }
  });

  document.getElementById('applyPresetButton')?.addEventListener('click', () => {
    const presetValue = document.getElementById('presetSelect')?.value || 'standard';
    applyPerformancePreset(presetValue);
  });

  document.getElementById('highContrastToggle')?.addEventListener('change', (event) => {
    appSettings.highContrastTheme = Boolean(event.target.checked);
    applySettingsToUI();
    markDirty();
  });
  document.getElementById('safePaletteToggle')?.addEventListener('change', (event) => {
    appSettings.safePalette = Boolean(event.target.checked);
    rerenderAllPalettes();
    applySettingsToUI();
    markDirty();
  });
  document.getElementById('lowLatencyToggle')?.addEventListener('change', (event) => {
    appSettings.lowLatencyMode = Boolean(event.target.checked);
    applySettingsToUI();
    startAutoPersistenceLoops();
    markDirty();
  });
  document.getElementById('touchOptimizeToggle')?.addEventListener('change', (event) => {
    appSettings.touchOptimized = Boolean(event.target.checked);
    applySettingsToUI();
    markDirty();
  });

  document.getElementById('splitModeToggle')?.addEventListener('change', (event) => {
    appSettings.splitMode = Boolean(event.target.checked);
    updateSplitModeView();
    updateHeaderButtonStates();
    markDirty();
  });

  document.getElementById('splitTargetSelect')?.addEventListener('change', (event) => {
    appSettings.splitTabId = event.target.value || null;
    updateSplitModeView();
    markDirty();
  });

  document.getElementById('spotlightRadiusInput')?.addEventListener('input', (event) => {
    appSettings.spotlightRadius = parseInt(event.target.value, 10) || 180;
    updateAllOverlays();
    markDirty();
  });
  document.getElementById('maskRevealInput')?.addEventListener('input', (event) => {
    appSettings.maskRevealPercent = parseInt(event.target.value, 10) || 60;
    updateAllOverlays();
    markDirty();
  });
}

function applyPerformancePreset(preset) {
  appSettings.performancePreset = preset;

  if (preset === 'low-spec') {
    appSettings.lowLatencyMode = true;
    appSettings.highContrastTheme = false;
    appSettings.safePalette = true;
    appSettings.touchOptimized = false;
    appSettings.drawSize = 4;
  } else if (preset === 'projector') {
    appSettings.lowLatencyMode = false;
    appSettings.highContrastTheme = true;
    appSettings.safePalette = true;
    appSettings.touchOptimized = true;
    appSettings.drawSize = 8;
  } else {
    appSettings.lowLatencyMode = false;
    appSettings.highContrastTheme = false;
    appSettings.safePalette = true;
    appSettings.touchOptimized = true;
    appSettings.drawSize = 6;
  }

  rerenderAllPalettes();
  syncDrawControls();
  applySettingsToUI();
  startAutoPersistenceLoops();
  markDirty();
}

async function initializeDisplayOptions() {
  const monitorSelect = document.getElementById('monitorSelect');
  if (!monitorSelect || !window.electronAPI?.getDisplays) {
    return;
  }

  const displays = await window.electronAPI.getDisplays();
  monitorSelect.innerHTML = '';

  displays.forEach((display) => {
    const option = document.createElement('option');
    const width = display.workArea?.width || display.bounds.width;
    const height = display.workArea?.height || display.bounds.height;
    option.value = display.id;
    option.textContent = `${display.label} (${width}x${height})`;
    monitorSelect.appendChild(option);
  });

  if (appSettings.selectedMonitorId) {
    monitorSelect.value = appSettings.selectedMonitorId;
  } else if (displays[0]) {
    monitorSelect.value = displays[0].id;
    appSettings.selectedMonitorId = displays[0].id;
  }
}

function applySettingsToUI() {
  document.body.classList.toggle('theme-high-contrast', appSettings.highContrastTheme);
  document.body.classList.toggle('low-latency', appSettings.lowLatencyMode);
  document.body.classList.toggle('touch-optimized', appSettings.touchOptimized);
  document.documentElement.style.setProperty('--sidebar-width', `${clamp(appSettings.sidebarWidth, 280, 760)}px`);

  document.getElementById('highContrastToggle').checked = appSettings.highContrastTheme;
  document.getElementById('safePaletteToggle').checked = appSettings.safePalette;
  document.getElementById('lowLatencyToggle').checked = appSettings.lowLatencyMode;
  document.getElementById('touchOptimizeToggle').checked = appSettings.touchOptimized;
  document.getElementById('splitModeToggle').checked = appSettings.splitMode;
  document.getElementById('spotlightRadiusInput').value = appSettings.spotlightRadius;
  document.getElementById('maskRevealInput').value = appSettings.maskRevealPercent;
  document.getElementById('presetSelect').value = appSettings.performancePreset;

  updateHeaderButtonStates();
  updateSplitTargetOptions();
  updateSplitModeView();
  applyAllInteractionStates();
  updateAllOverlays();
  updateContrastWarningForActiveTab();
}

function setupSidebar() {
  const resizer = document.getElementById('sidebarResizer');
  if (!resizer) {
    return;
  }

  let dragging = false;

  resizer.addEventListener('pointerdown', (event) => {
    dragging = true;
    resizer.setPointerCapture(event.pointerId);
  });

  resizer.addEventListener('pointermove', (event) => {
    if (!dragging) {
      return;
    }
    const newWidth = clamp(window.innerWidth - event.clientX, 280, 760);
    appSettings.sidebarWidth = newWidth;
    document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`);
    markDirty(false);
  });

  const releaseDrag = (event) => {
    if (!dragging) {
      return;
    }
    dragging = false;
    try {
      resizer.releasePointerCapture(event.pointerId);
    } catch (error) {
      // Ignore pointer capture release errors.
    }
    markDirty();
  };

  resizer.addEventListener('pointerup', releaseDrag);
  resizer.addEventListener('pointercancel', releaseDrag);
}

function updateTimetableLayout() {
  const timetableList = document.getElementById('timetableList');
  const timetableContainer = document.querySelector('.timetable-container');
  if (!timetableList || !timetableContainer) {
    return;
  }

  const items = [...timetableList.children];
  items.forEach((item, index) => {
    const numberElement = item.querySelector('.timetable-number');
    if (numberElement) {
      numberElement.textContent = String(index + 1);
    }
  });

  const count = Math.max(items.length, 1);
  const scale = clamp(8 / count, 0.34, 1);
  const gap = clamp(Math.round(16 * scale), 2, 16);
  timetableContainer.style.setProperty('--period-scale', scale.toFixed(3));
  timetableContainer.style.setProperty('--period-gap', `${gap}px`);
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('open');
}

function addTimetableItem() {
  const index = document.querySelectorAll('#timetableList .timetable-item').length;
  appendTimetableItem({ subject: '', checked: false }, index);
  updateTimetableLayout();
  markDirty();
  saveTimetable();
}

function clearChecked() {
  const timetableList = document.getElementById('timetableList');
  [...timetableList.children].forEach((item) => {
    const checked = item.querySelector('.timetable-checkbox')?.checked;
    if (checked) {
      item.remove();
    }
  });

  updateTimetableLayout();
  markDirty();
  saveTimetable();
}

function createTab(title, options = {}) {
  const tabId = options.id || `tab-${tabCounter + 1}`;

  if (options.id) {
    const parsedIndex = parseInt(String(options.id).split('-')[1], 10);
    if (Number.isFinite(parsedIndex)) {
      tabCounter = Math.max(tabCounter, parsedIndex);
    } else {
      tabCounter += 1;
    }
  } else {
    tabCounter += 1;
  }

  const tabData = new TabData(tabId, title);

  if (options.data) {
    tabData.content = options.data.content || '';
    tabData.formatState = { ...DEFAULT_FORMAT_STATE, ...(options.data.formatState || {}) };
    tabData.drawingData = options.data.drawingData || null;
    tabData.backgroundPreset = options.data.backgroundPreset || 'plain';
    tabData.viewState = {
      scale: options.data.viewState?.scale || 1,
      panX: options.data.viewState?.panX || 0,
      panY: options.data.viewState?.panY || 0
    };
  }

  tabs.set(tabId, tabData);
  createTabElement(tabId, title);
  createTabContent(tabId);

  if (!activeTabId) {
    activeTabId = tabId;
  }

  if (!options.silent) {
    switchToTab(tabId);
    markDirty();
  }

  updateSplitTargetOptions();
  return tabId;
}

function createTabElement(tabId, title) {
  const tabsWrapper = document.querySelector('.tabs-wrapper');
  const tabElement = document.createElement('div');
  tabElement.className = 'tab';
  tabElement.dataset.tabId = tabId;
  tabElement.innerHTML = `
    <span class="tab-title">${title}</span>
    <button class="tab-close" title="칠판 닫기">&times;</button>
  `;

  tabElement.addEventListener('click', (event) => {
    if (event.target.classList.contains('tab-close')) {
      return;
    }
    switchToTab(tabId);
  });

  tabElement.querySelector('.tab-close').addEventListener('click', (event) => {
    event.stopPropagation();
    closeTab(tabId);
  });

  tabsWrapper.appendChild(tabElement);
}

function createTabContent(tabId) {
  const tabContents = document.getElementById('tabContents');
  const contentElement = document.createElement('div');
  contentElement.className = 'tab-content';
  contentElement.dataset.tabId = tabId;
  contentElement.innerHTML = `
    <div class="toolbar" data-tab-id="${tabId}">
      <div class="toolbar-group">
        <button id="boldBtn" class="format-btn" title="굵게 (Ctrl+B)">B</button>
        <button id="italicBtn" class="format-btn" title="기울임 (Ctrl+I)">I</button>
        <button id="underlineBtn" class="format-btn" title="밑줄 (Ctrl+U)">U</button>
      </div>

      <div class="divider"></div>

      <div class="color-picker-container">
        <button id="colorButton" class="color-button" title="글자색">
          <div class="color-preview" style="background-color: #ffffff;"></div>
        </button>
        <div class="predefined-colors">
          <div class="predefined-colors-grid"></div>
          <div class="color-more" title="더 많은 색상">
            <input type="color" id="colorPicker" value="#ffffff" class="hidden-color-picker">
            더 보기
          </div>
        </div>
      </div>

      <div class="divider"></div>

      <div class="font-size-control">
        <label for="fontSizeInput" class="font-size-label">크기:</label>
        <div class="font-size-input-group">
          <input type="number" id="fontSizeInput" class="font-size-input" value="72" min="8" max="200">
          <div class="font-size-stepper">
            <button id="fontSizeDown" class="font-size-step-btn">-</button>
            <button id="fontSizeUp" class="font-size-step-btn">+</button>
          </div>
        </div>
        <select id="fontSizeSelect" class="font-size-select">
          <option value="16">16px</option>
          <option value="18">18px</option>
          <option value="20">20px</option>
          <option value="24">24px</option>
          <option value="30">30px</option>
          <option value="36">36px</option>
          <option value="42">42px</option>
          <option value="48">48px</option>
          <option value="56">56px</option>
          <option value="64">64px</option>
          <option value="72" selected>72px</option>
          <option value="84">84px</option>
          <option value="96">96px</option>
          <option value="112">112px</option>
          <option value="120">120px</option>
          <option value="128">128px</option>
          <option value="144">144px</option>
          <option value="160">160px</option>
          <option value="180">180px</option>
          <option value="200">200px</option>
        </select>
      </div>

      <div class="divider"></div>

      <div class="draw-controls">
        <select class="draw-tool-select" title="도구">
          <option value="text">텍스트</option>
          <option value="pen">펜</option>
          <option value="highlighter">형광펜</option>
          <option value="eraser">지우개</option>
          <option value="line">직선</option>
          <option value="arrow">화살표</option>
          <option value="rect">사각형</option>
          <option value="circle">원</option>
          <option value="pan">이동/줌</option>
        </select>
        <input type="color" class="draw-color-input" value="#ffffff" title="도구 색상">
        <input type="range" class="draw-size-input" min="1" max="36" step="1" value="6" title="도구 두께">
      </div>

      <div class="divider"></div>

      <div class="background-controls">
        <select class="background-select" title="배경">
          <option value="plain">무지</option>
          <option value="lined">줄노트</option>
          <option value="grid">모눈</option>
          <option value="coordinate">좌표</option>
        </select>
      </div>

      <button class="math-button" title="수식/심볼">수식</button>
      <div class="math-symbol-panel">
        <button class="symbol-btn" data-symbol="π">π</button>
        <button class="symbol-btn" data-symbol="√">√</button>
        <button class="symbol-btn" data-symbol="∞">∞</button>
        <button class="symbol-btn" data-symbol="∑">∑</button>
        <button class="symbol-btn" data-symbol="Δ">Δ</button>
        <button class="symbol-btn" data-symbol="≤">≤</button>
        <button class="symbol-btn" data-symbol="≥">≥</button>
        <button class="symbol-btn" data-symbol="→">→</button>
        <button class="symbol-btn" data-symbol="⇔">⇔</button>
        <button class="latex-btn">LaTeX</button>
      </div>

      <span class="contrast-indicator">대비 양호</span>
    </div>

    <div class="board-stage background-plain" data-tab-id="${tabId}">
      <div class="board-transform" data-tab-id="${tabId}">
        <div class="chalkboard" contenteditable="true" data-tab-id="${tabId}"></div>
        <canvas class="drawing-canvas" data-tab-id="${tabId}"></canvas>
        <div class="freeze-overlay" data-tab-id="${tabId}">Freeze Mode</div>
        <div class="spotlight-overlay" data-tab-id="${tabId}"></div>
        <div class="mask-overlay" data-tab-id="${tabId}"></div>
      </div>
    </div>
  `;

  tabContents.appendChild(contentElement);
  setupTabEventListeners(tabId);
  initializeCanvas(tabId);
  loadTabContent(tabId);
  applyTabBackground(tabId);
  applyViewTransform(tabId);
  applyInteractionStateToTab(tabId);
  updateToolbarState(tabId);
}

function switchToTab(tabId) {
  if (!tabs.has(tabId)) {
    return;
  }

  activeTabId = tabId;
  document.querySelectorAll('.tab').forEach((tabElement) => {
    tabElement.classList.toggle('active', tabElement.dataset.tabId === tabId);
  });

  document.querySelectorAll('.tab-content').forEach((content) => {
    content.classList.remove('active', 'split-pane', 'secondary-pane', 'primary-pane');
  });

  updateSplitModeView();
  updateToolbarState(tabId);
  applyInteractionStateToTab(tabId);
  resizeCanvas(tabId);
  updateContrastWarningForActiveTab();
}

function closeTab(tabId) {
  if (tabs.size <= 1) {
    return;
  }

  tabs.delete(tabId);
  drawingStates.delete(tabId);

  document.querySelector(`.tab[data-tab-id="${tabId}"]`)?.remove();
  document.querySelector(`.tab-content[data-tab-id="${tabId}"]`)?.remove();

  if (activeTabId === tabId) {
    const nextTabId = tabs.keys().next().value;
    switchToTab(nextTabId);
  } else {
    updateSplitModeView();
  }

  if (appSettings.splitTabId === tabId) {
    appSettings.splitTabId = null;
  }

  updateSplitTargetOptions();
  markDirty();
}

function captureAllTabContents() {
  tabs.forEach((tabData, tabId) => {
    const dom = getTabDom(tabId);
    if (dom.chalkboard) {
      tabData.content = dom.chalkboard.innerHTML;
    }
  });
}

function loadTabContent(tabId) {
  const tabData = tabs.get(tabId);
  const dom = getTabDom(tabId);
  if (!tabData || !dom.chalkboard) {
    return;
  }

  dom.chalkboard.innerHTML = tabData.content || '';
  dom.chalkboard.dataset.currentFormat = JSON.stringify(tabData.formatState || DEFAULT_FORMAT_STATE);
  if (tabData.formatState?.color) {
    dom.chalkboard.style.color = tabData.formatState.color;
  }
  if (tabData.formatState?.fontSize) {
    dom.chalkboard.style.fontSize = `${tabData.formatState.fontSize}px`;
  }

  renderDrawingData(tabId);
}

function applyTabBackground(tabId) {
  const tabData = tabs.get(tabId);
  const dom = getTabDom(tabId);
  if (!tabData || !dom.stage) {
    return;
  }

  dom.stage.classList.remove('background-plain', 'background-lined', 'background-grid', 'background-coordinate');
  dom.stage.classList.add(`background-${tabData.backgroundPreset || 'plain'}`);
}

function updateSplitTargetOptions() {
  const select = document.getElementById('splitTargetSelect');
  if (!select) {
    return;
  }

  select.innerHTML = '<option value="">비교 칠판 선택</option>';

  tabs.forEach((tabData, tabId) => {
    if (tabId === activeTabId) {
      return;
    }
    const option = document.createElement('option');
    option.value = tabId;
    option.textContent = tabData.title;
    select.appendChild(option);
  });

  if (appSettings.splitTabId && tabs.has(appSettings.splitTabId)) {
    select.value = appSettings.splitTabId;
  } else {
    appSettings.splitTabId = '';
    select.value = '';
  }
}

function updateSplitModeView() {
  const container = document.getElementById('tabContents');
  container.classList.remove('split-mode');

  const allContents = document.querySelectorAll('.tab-content');
  allContents.forEach((content) => {
    content.classList.remove('active', 'split-pane', 'secondary-pane', 'primary-pane');
  });

  if (!activeTabId || !tabs.has(activeTabId)) {
    return;
  }

  const activeContent = document.querySelector(`.tab-content[data-tab-id="${activeTabId}"]`);
  if (!activeContent) {
    return;
  }

  if (appSettings.splitMode && appSettings.splitTabId && tabs.has(appSettings.splitTabId) && appSettings.splitTabId !== activeTabId) {
    const secondaryContent = document.querySelector(`.tab-content[data-tab-id="${appSettings.splitTabId}"]`);
    if (secondaryContent) {
      container.classList.add('split-mode');
      activeContent.classList.add('active', 'split-pane', 'primary-pane');
      secondaryContent.classList.add('active', 'split-pane', 'secondary-pane');
      applyInteractionStateToTab(appSettings.splitTabId);
      resizeCanvas(appSettings.splitTabId);
      return;
    }
  }

  activeContent.classList.add('active');
}

function setupTabEventListeners(tabId) {
  const dom = getTabDom(tabId);
  if (!dom.toolbar || !dom.chalkboard || !dom.canvas || !dom.stage) {
    return;
  }

  const toolbar = dom.toolbar;
  const chalkboard = dom.chalkboard;
  const boldBtn = toolbar.querySelector('#boldBtn');
  const italicBtn = toolbar.querySelector('#italicBtn');
  const underlineBtn = toolbar.querySelector('#underlineBtn');
  const colorButton = toolbar.querySelector('#colorButton');
  const colorPicker = toolbar.querySelector('#colorPicker');
  const colorPreview = toolbar.querySelector('.color-preview');
  const fontSizeInput = toolbar.querySelector('#fontSizeInput');
  const fontSizeSelect = toolbar.querySelector('#fontSizeSelect');
  const fontSizeUp = toolbar.querySelector('#fontSizeUp');
  const fontSizeDown = toolbar.querySelector('#fontSizeDown');
  const drawToolSelect = toolbar.querySelector('.draw-tool-select');
  const drawColorInput = toolbar.querySelector('.draw-color-input');
  const drawSizeInput = toolbar.querySelector('.draw-size-input');
  const backgroundSelect = toolbar.querySelector('.background-select');
  const mathButton = toolbar.querySelector('.math-button');
  const symbolPanel = toolbar.querySelector('.math-symbol-panel');

  renderPaletteForToolbar(toolbar, tabId);

  boldBtn.addEventListener('mouseenter', saveSelection);
  italicBtn.addEventListener('mouseenter', saveSelection);
  underlineBtn.addEventListener('mouseenter', saveSelection);

  boldBtn.addEventListener('mousedown', (event) => {
    event.preventDefault();
    restoreSelection();
    textFormatter.toggleFormat(chalkboard, 'fontWeight');
    saveSelection();
    updateToolbarState(tabId);
    markDirty();
  });

  italicBtn.addEventListener('mousedown', (event) => {
    event.preventDefault();
    restoreSelection();
    textFormatter.toggleFormat(chalkboard, 'fontStyle');
    saveSelection();
    updateToolbarState(tabId);
    markDirty();
  });

  underlineBtn.addEventListener('mousedown', (event) => {
    event.preventDefault();
    restoreSelection();
    textFormatter.toggleFormat(chalkboard, 'textDecoration');
    saveSelection();
    updateToolbarState(tabId);
    markDirty();
  });

  colorButton.addEventListener('click', () => {
    toolbar.querySelector('.predefined-colors')?.classList.toggle('show');
  });

  colorPicker.addEventListener('input', (event) => {
    restoreSelection();
    const color = event.target.value;
    colorPreview.style.backgroundColor = color;
    textFormatter.setColor(chalkboard, color);
    saveSelection();
    updateToolbarState(tabId);
    markDirty();
  });

  toolbar.querySelector('.color-more').addEventListener('click', () => {
    colorPicker.click();
  });

  const commitFontSizeInput = () => {
    const size = parseInt(fontSizeInput.value, 10);
    if (!Number.isFinite(size)) {
      updateToolbarState(tabId);
      return;
    }
    applyFontSizeForTab(tabId, size);
  };

  fontSizeInput.addEventListener('focus', () => {
    saveSelection();
  });

  fontSizeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitFontSizeInput();
      chalkboard.focus();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      updateToolbarState(tabId);
      chalkboard.focus();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      stepFontSizeForTab(tabId, 1);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      stepFontSizeForTab(tabId, -1);
    }
  });

  fontSizeInput.addEventListener('blur', () => {
    commitFontSizeInput();
  });

  fontSizeInput.addEventListener('wheel', (event) => {
    if (document.activeElement !== fontSizeInput) {
      return;
    }
    event.preventDefault();
    stepFontSizeForTab(tabId, event.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  fontSizeSelect.addEventListener('change', (event) => {
    const size = parseInt(event.target.value, 10);
    if (!Number.isFinite(size)) {
      return;
    }
    fontSizeInput.value = String(size);
    applyFontSizeForTab(tabId, size);
  });

  fontSizeUp.addEventListener('mouseenter', saveSelection);
  fontSizeDown.addEventListener('mouseenter', saveSelection);

  fontSizeUp.addEventListener('mousedown', (event) => {
    event.preventDefault();
    stepFontSizeForTab(tabId, 1);
  });

  fontSizeDown.addEventListener('mousedown', (event) => {
    event.preventDefault();
    stepFontSizeForTab(tabId, -1);
  });

  drawToolSelect.addEventListener('change', (event) => {
    appSettings.activeTool = event.target.value;
    syncDrawControls();
    applyAllInteractionStates();
    markDirty();
  });

  drawColorInput.addEventListener('change', (event) => {
    appSettings.drawColor = event.target.value;
    syncDrawControls();
    markDirty();
  });

  drawSizeInput.addEventListener('input', (event) => {
    appSettings.drawSize = parseInt(event.target.value, 10) || 6;
    syncDrawControls();
    markDirty(false);
  });

  backgroundSelect.addEventListener('change', (event) => {
    const tabData = tabs.get(tabId);
    if (!tabData) {
      return;
    }
    tabData.backgroundPreset = event.target.value;
    applyTabBackground(tabId);
    updateContrastWarning(tabId);
    markDirty();
  });

  mathButton.addEventListener('mousedown', (event) => {
    event.preventDefault();
    saveSelection();
  });

  mathButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    document.querySelectorAll('.math-symbol-panel.show').forEach((panel) => {
      if (panel !== symbolPanel) {
        panel.classList.remove('show');
      }
    });
    symbolPanel.classList.toggle('show');
  });

  symbolPanel.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });

  symbolPanel.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  symbolPanel.querySelectorAll('.symbol-btn').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (appSettings.editLocked || appSettings.freezeMode) {
        return;
      }
      restoreSelection();
      insertTextAtCursor(chalkboard, button.dataset.symbol);
      updateToolbarState(tabId);
      saveSelection();
      markDirty();
    });
  });

  symbolPanel.querySelector('.latex-btn').addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (appSettings.editLocked || appSettings.freezeMode) {
      return;
    }
    const latex = window.prompt('LaTeX 입력');
    if (!latex) {
      return;
    }
    restoreSelection();
    const block = document.createElement('span');
    block.className = 'math-block';
    block.textContent = `\\(${latex}\\)`;
    insertNodeAtCursor(chalkboard, block);
    updateToolbarState(tabId);
    saveSelection();
    markDirty();
  });

  chalkboard.addEventListener('input', (event) => {
    if (appSettings.editLocked || appSettings.freezeMode) {
      return;
    }
    textFormatter.handleInput(event);
    const tabData = tabs.get(tabId);
    if (tabData) {
      tabData.content = chalkboard.innerHTML;
    }
    markDirty();
  });

  chalkboard.addEventListener('compositionstart', (event) => {
    textFormatter.handleCompositionStart(event);
  });
  chalkboard.addEventListener('compositionupdate', (event) => {
    textFormatter.handleCompositionUpdate(event);
  });
  chalkboard.addEventListener('compositionend', (event) => {
    textFormatter.handleCompositionEnd(event);
    markDirty();
  });

  chalkboard.addEventListener('keyup', () => {
    saveSelection();
    updateToolbarState(tabId);
  });
  chalkboard.addEventListener('mouseup', () => {
    saveSelection();
    updateToolbarState(tabId);
  });

  chalkboard.addEventListener('keydown', (event) => {
    if (!event.ctrlKey) {
      return;
    }

    if (event.key === 'b') {
      event.preventDefault();
      textFormatter.toggleFormat(chalkboard, 'fontWeight');
      updateToolbarState(tabId);
      markDirty();
    } else if (event.key === 'i') {
      event.preventDefault();
      textFormatter.toggleFormat(chalkboard, 'fontStyle');
      updateToolbarState(tabId);
      markDirty();
    } else if (event.key === 'u') {
      event.preventDefault();
      textFormatter.toggleFormat(chalkboard, 'textDecoration');
      updateToolbarState(tabId);
      markDirty();
    }
  });

  chalkboard.addEventListener('paste', (event) => {
    if (appSettings.editLocked || appSettings.freezeMode) {
      return;
    }

    const clipboardItems = [...(event.clipboardData?.items || [])];
    const imageItem = clipboardItems.find((item) => item.type.startsWith('image/'));
    if (!imageItem) {
      return;
    }

    event.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const image = document.createElement('img');
      image.className = 'chalk-image';
      image.src = reader.result;
      image.alt = '붙여넣은 이미지';
      insertNodeAtCursor(chalkboard, image);
      markDirty();
    };
    reader.readAsDataURL(file);
  });

  chalkboard.addEventListener('dragover', (event) => {
    event.preventDefault();
  });

  chalkboard.addEventListener('drop', (event) => {
    if (appSettings.editLocked || appSettings.freezeMode) {
      return;
    }

    event.preventDefault();
    const files = [...(event.dataTransfer?.files || [])];
    const imageFile = files.find((file) => file.type.startsWith('image/'));
    if (!imageFile) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const image = document.createElement('img');
      image.className = 'chalk-image';
      image.src = reader.result;
      image.alt = imageFile.name;
      insertNodeAtCursor(chalkboard, image);
      markDirty();
    };
    reader.readAsDataURL(imageFile);
  });

  setupDrawingHandlers(tabId);
  syncDrawControls();
}

function renderPaletteForToolbar(toolbar, tabId) {
  const grid = toolbar.querySelector('.predefined-colors-grid');
  const colorPicker = toolbar.querySelector('#colorPicker');
  const colorPreview = toolbar.querySelector('.color-preview');
  const chalkboard = toolbar.closest('.tab-content')?.querySelector('.chalkboard');
  if (!grid || !chalkboard) {
    return;
  }

  grid.innerHTML = '';
  getPalette().forEach((color) => {
    const swatch = document.createElement('button');
    swatch.className = 'color-swatch';
    swatch.type = 'button';
    swatch.title = color;
    swatch.dataset.color = color;
    swatch.style.backgroundColor = color;

    swatch.addEventListener('mouseenter', saveSelection);
    swatch.addEventListener('mousedown', (event) => {
      event.preventDefault();
      restoreSelection();
      textFormatter.setColor(chalkboard, color);
      colorPicker.value = color;
      colorPreview.style.backgroundColor = color;
      updateToolbarState(tabId);
      toolbar.querySelector('.predefined-colors')?.classList.remove('show');
      markDirty();
    });

    grid.appendChild(swatch);
  });
}

function rerenderAllPalettes() {
  document.querySelectorAll('.toolbar').forEach((toolbar) => {
    const tabId = toolbar.dataset.tabId;
    renderPaletteForToolbar(toolbar, tabId);
  });
}

function syncDrawControls() {
  document.querySelectorAll('.toolbar').forEach((toolbar) => {
    const toolSelect = toolbar.querySelector('.draw-tool-select');
    const colorInput = toolbar.querySelector('.draw-color-input');
    const sizeInput = toolbar.querySelector('.draw-size-input');
    if (toolSelect) {
      toolSelect.value = appSettings.activeTool;
    }
    if (colorInput) {
      colorInput.value = appSettings.drawColor;
    }
    if (sizeInput) {
      sizeInput.value = String(appSettings.drawSize);
    }
  });
}

function updateToolbarState(tabId) {
  const tabData = tabs.get(tabId);
  const dom = getTabDom(tabId);
  if (!tabData || !dom.toolbar || !dom.chalkboard) {
    return;
  }

  const currentFormat = textFormatter.getCurrentFormat(dom.chalkboard);
  Object.assign(tabData.formatState, currentFormat);

  dom.toolbar.querySelector('#boldBtn')?.classList.toggle('active', currentFormat.fontWeight === 'bold');
  dom.toolbar.querySelector('#italicBtn')?.classList.toggle('active', currentFormat.fontStyle === 'italic');
  dom.toolbar.querySelector('#underlineBtn')?.classList.toggle('active', currentFormat.textDecoration === 'underline');

  const colorPicker = dom.toolbar.querySelector('#colorPicker');
  const colorPreview = dom.toolbar.querySelector('.color-preview');
  if (colorPicker) {
    colorPicker.value = currentFormat.color;
  }
  if (colorPreview) {
    colorPreview.style.backgroundColor = currentFormat.color;
  }

  const fontSizeInput = dom.toolbar.querySelector('#fontSizeInput');
  const fontSizeSelect = dom.toolbar.querySelector('#fontSizeSelect');
  if (fontSizeInput && document.activeElement !== fontSizeInput) {
    fontSizeInput.value = String(currentFormat.fontSize);
  }
  if (fontSizeSelect) {
    const option = fontSizeSelect.querySelector(`option[value="${currentFormat.fontSize}"]`);
    fontSizeSelect.value = option ? String(currentFormat.fontSize) : '';
  }

  const backgroundSelect = dom.toolbar.querySelector('.background-select');
  if (backgroundSelect) {
    backgroundSelect.value = tabData.backgroundPreset || 'plain';
  }

  updateContrastWarning(tabId);
}

function updateContrastWarning(tabId) {
  const tabData = tabs.get(tabId);
  const dom = getTabDom(tabId);
  if (!tabData || !dom.toolbar) {
    return;
  }

  const currentColor = tabData.formatState?.color || '#ffffff';
  const backgroundColor = getBoardBackgroundColor(tabData);
  const ratio = contrastRatio(currentColor, backgroundColor);

  const indicator = dom.toolbar.querySelector('.contrast-indicator');
  const isLowContrast = ratio < 4.5;

  if (indicator) {
    indicator.textContent = isLowContrast ? `대비 낮음 (${ratio.toFixed(1)}:1)` : `대비 양호 (${ratio.toFixed(1)}:1)`;
    indicator.classList.toggle('warning', isLowContrast);
  }

  if (activeTabId === tabId) {
    const globalWarning = document.getElementById('globalContrastWarning');
    globalWarning.classList.toggle('hidden', !isLowContrast);
  }
}

function updateContrastWarningForActiveTab() {
  if (!activeTabId) {
    return;
  }
  updateContrastWarning(activeTabId);
}

function initializeCanvas(tabId) {
  const tabData = tabs.get(tabId);
  const dom = getTabDom(tabId);
  if (!tabData || !dom.stage || !dom.canvas) {
    return;
  }

  resizeCanvas(tabId);

  const observer = new ResizeObserver(() => {
    resizeCanvas(tabId);
  });
  observer.observe(dom.stage);
  drawingStates.set(tabId, {
    isDrawing: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    baseImage: null
  });
  tabData.resizeObserver = observer;
}

function resizeCanvas(tabId) {
  const dom = getTabDom(tabId);
  const tabData = tabs.get(tabId);
  if (!dom.canvas || !dom.stage || !tabData) {
    return;
  }

  const width = Math.max(1, Math.floor(dom.stage.clientWidth));
  const height = Math.max(1, Math.floor(dom.stage.clientHeight));
  if (width === 1 || height === 1) {
    return;
  }

  const devicePixelRatio = window.devicePixelRatio || 1;
  const targetWidth = Math.floor(width * devicePixelRatio);
  const targetHeight = Math.floor(height * devicePixelRatio);

  if (dom.canvas.width === targetWidth && dom.canvas.height === targetHeight) {
    return;
  }

  dom.canvas.width = targetWidth;
  dom.canvas.height = targetHeight;
  dom.canvas.style.width = `${width}px`;
  dom.canvas.style.height = `${height}px`;

  const ctx = dom.canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  renderDrawingData(tabId);
}

function renderDrawingData(tabId) {
  const tabData = tabs.get(tabId);
  const dom = getTabDom(tabId);
  if (!tabData || !dom.canvas) {
    return;
  }

  const ctx = dom.canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);

  if (!tabData.drawingData) {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return;
  }

  const image = new Image();
  image.onload = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
    ctx.drawImage(image, 0, 0, dom.canvas.width, dom.canvas.height);
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  image.src = tabData.drawingData;
}

function getPointerPointInCanvas(tabId, event) {
  const tabData = tabs.get(tabId);
  const dom = getTabDom(tabId);
  if (!tabData || !dom.stage) {
    return { x: 0, y: 0 };
  }

  const rect = dom.stage.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  return {
    x: (localX - tabData.viewState.panX) / tabData.viewState.scale,
    y: (localY - tabData.viewState.panY) / tabData.viewState.scale
  };
}

function configureDrawingContext(ctx, tool) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.strokeStyle = appSettings.drawColor;
  ctx.lineWidth = appSettings.drawSize;

  if (tool === 'highlighter') {
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = appSettings.drawSize * 2;
  } else if (tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1;
    ctx.lineWidth = appSettings.drawSize * 2.2;
  } else if (tool === 'line' || tool === 'arrow' || tool === 'rect' || tool === 'circle') {
    ctx.lineWidth = appSettings.drawSize;
    ctx.globalAlpha = 1;
  }
}

function drawArrow(ctx, fromX, fromY, toX, toY) {
  const headLength = Math.max(12, appSettings.drawSize * 2);
  const angle = Math.atan2(toY - fromY, toX - fromX);

  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(
    toX - headLength * Math.cos(angle - Math.PI / 6),
    toY - headLength * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    toX - headLength * Math.cos(angle + Math.PI / 6),
    toY - headLength * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fillStyle = appSettings.drawColor;
  ctx.globalAlpha = 1;
  ctx.fill();
}

function drawShape(ctx, tool, startX, startY, endX, endY) {
  if (tool === 'line') {
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    return;
  }

  if (tool === 'arrow') {
    drawArrow(ctx, startX, startY, endX, endY);
    return;
  }

  if (tool === 'rect') {
    const width = endX - startX;
    const height = endY - startY;
    ctx.strokeRect(startX, startY, width, height);
    return;
  }

  if (tool === 'circle') {
    const centerX = (startX + endX) / 2;
    const centerY = (startY + endY) / 2;
    const radiusX = Math.abs((endX - startX) / 2);
    const radiusY = Math.abs((endY - startY) / 2);
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function persistDrawingForTab(tabId) {
  const tabData = tabs.get(tabId);
  const dom = getTabDom(tabId);
  if (!tabData || !dom.canvas) {
    return;
  }
  tabData.drawingData = dom.canvas.toDataURL('image/png');
}

function canDrawOnTab(tabId) {
  const isSecondarySplit = appSettings.splitMode && appSettings.splitTabId === tabId && activeTabId !== tabId;
  if (isSecondarySplit) {
    return false;
  }
  if (appSettings.freezeMode || appSettings.editLocked) {
    return false;
  }
  if (appSettings.activeTool === 'text' || appSettings.activeTool === 'pan') {
    return false;
  }
  return true;
}

function shouldStartPan(event) {
  if (appSettings.freezeMode) {
    return false;
  }
  if (appSettings.activeTool === 'pan') {
    return true;
  }
  if (isSpacePressed && event.pointerType !== 'touch') {
    return true;
  }
  return false;
}

function setupDrawingHandlers(tabId) {
  const dom = getTabDom(tabId);
  const drawingState = drawingStates.get(tabId);
  if (!dom.canvas || !dom.stage || !drawingState) {
    return;
  }

  dom.canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'pen') {
      penPointers.add(event.pointerId);
    }
    if (event.pointerType === 'touch' && penPointers.size > 0) {
      return;
    }

    if (!canDrawOnTab(tabId)) {
      return;
    }

    const point = getPointerPointInCanvas(tabId, event);
    const ctx = dom.canvas.getContext('2d');
    configureDrawingContext(ctx, appSettings.activeTool);

    drawingState.isDrawing = true;
    drawingState.pointerId = event.pointerId;
    drawingState.startX = point.x;
    drawingState.startY = point.y;
    drawingState.baseImage = null;

    if (appSettings.activeTool === 'pen' || appSettings.activeTool === 'highlighter' || appSettings.activeTool === 'eraser') {
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
    } else {
      drawingState.baseImage = ctx.getImageData(0, 0, dom.canvas.width, dom.canvas.height);
    }

    dom.canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  dom.canvas.addEventListener('pointermove', (event) => {
    if (!drawingState.isDrawing || drawingState.pointerId !== event.pointerId) {
      return;
    }

    const point = getPointerPointInCanvas(tabId, event);
    const ctx = dom.canvas.getContext('2d');
    configureDrawingContext(ctx, appSettings.activeTool);

    if (appSettings.activeTool === 'pen' || appSettings.activeTool === 'highlighter' || appSettings.activeTool === 'eraser') {
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    } else if (drawingState.baseImage) {
      ctx.putImageData(drawingState.baseImage, 0, 0);
      drawShape(ctx, appSettings.activeTool, drawingState.startX, drawingState.startY, point.x, point.y);
    }
    event.preventDefault();
  });

  const finishDrawing = (event) => {
    if (event.pointerType === 'pen') {
      penPointers.delete(event.pointerId);
    }

    if (!drawingState.isDrawing || drawingState.pointerId !== event.pointerId) {
      return;
    }

    if (drawingState.baseImage) {
      const point = getPointerPointInCanvas(tabId, event);
      const ctx = dom.canvas.getContext('2d');
      configureDrawingContext(ctx, appSettings.activeTool);
      ctx.putImageData(drawingState.baseImage, 0, 0);
      drawShape(ctx, appSettings.activeTool, drawingState.startX, drawingState.startY, point.x, point.y);
    }

    drawingState.isDrawing = false;
    drawingState.pointerId = null;
    drawingState.baseImage = null;

    try {
      dom.canvas.releasePointerCapture(event.pointerId);
    } catch (error) {
      // Ignore pointer capture release errors.
    }

    persistDrawingForTab(tabId);
    markDirty();
  };

  dom.canvas.addEventListener('pointerup', finishDrawing);
  dom.canvas.addEventListener('pointercancel', finishDrawing);

  dom.stage.addEventListener('wheel', (event) => {
    if (!(event.ctrlKey || appSettings.activeTool === 'pan')) {
      return;
    }
    event.preventDefault();

    const tabData = tabs.get(tabId);
    if (!tabData) {
      return;
    }

    const rect = dom.stage.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const oldScale = tabData.viewState.scale;
    const scaleFactor = event.deltaY < 0 ? 1.08 : 0.92;
    const newScale = clamp(oldScale * scaleFactor, 0.5, 3.2);

    tabData.viewState.panX = localX - ((localX - tabData.viewState.panX) / oldScale) * newScale;
    tabData.viewState.panY = localY - ((localY - tabData.viewState.panY) / oldScale) * newScale;
    tabData.viewState.scale = newScale;

    applyViewTransform(tabId);
    markDirty(false);
  }, { passive: false });

  dom.stage.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch') {
      touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY, tabId });
    }

    if (appSettings.touchOptimized && event.pointerType === 'touch' && touchPointers.size >= 2) {
      const entries = [...touchPointers.values()].filter((item) => item.tabId === tabId);
      if (entries.length >= 2) {
        activePanState = {
          pointerId: 'touch-multi',
          tabId,
          lastX: (entries[0].x + entries[1].x) / 2,
          lastY: (entries[0].y + entries[1].y) / 2
        };
      }
      return;
    }

    if (!shouldStartPan(event)) {
      return;
    }

    activePanState = {
      pointerId: event.pointerId,
      tabId,
      lastX: event.clientX,
      lastY: event.clientY
    };
    dom.stage.setPointerCapture(event.pointerId);
  });

  dom.stage.addEventListener('pointermove', (event) => {
    if (appSettings.spotlightEnabled) {
      updateSpotlightPosition(tabId, event);
    }

    if (!activePanState || activePanState.tabId !== tabId) {
      if (event.pointerType === 'touch' && touchPointers.has(event.pointerId)) {
        touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY, tabId });
      }
      return;
    }

    const tabData = tabs.get(tabId);
    if (!tabData) {
      return;
    }

    if (activePanState.pointerId === 'touch-multi') {
      if (!touchPointers.has(event.pointerId)) {
        return;
      }
      touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY, tabId });
      const entries = [...touchPointers.values()].filter((item) => item.tabId === tabId);
      if (entries.length < 2) {
        return;
      }
      const avgX = (entries[0].x + entries[1].x) / 2;
      const avgY = (entries[0].y + entries[1].y) / 2;
      tabData.viewState.panX += avgX - activePanState.lastX;
      tabData.viewState.panY += avgY - activePanState.lastY;
      activePanState.lastX = avgX;
      activePanState.lastY = avgY;
      applyViewTransform(tabId);
      markDirty(false);
      return;
    }

    if (activePanState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - activePanState.lastX;
    const deltaY = event.clientY - activePanState.lastY;
    activePanState.lastX = event.clientX;
    activePanState.lastY = event.clientY;
    tabData.viewState.panX += deltaX;
    tabData.viewState.panY += deltaY;
    applyViewTransform(tabId);
    markDirty(false);
  });

  const endPan = (event) => {
    if (event.pointerType === 'touch') {
      touchPointers.delete(event.pointerId);
    }

    if (!activePanState || activePanState.tabId !== tabId) {
      return;
    }

    if (activePanState.pointerId === 'touch-multi') {
      const remaining = [...touchPointers.values()].filter((item) => item.tabId === tabId);
      if (remaining.length >= 2) {
        return;
      }
      activePanState = null;
      markDirty();
      return;
    }

    if (activePanState.pointerId !== event.pointerId) {
      return;
    }

    activePanState = null;
    try {
      dom.stage.releasePointerCapture(event.pointerId);
    } catch (error) {
      // Ignore pointer capture release errors.
    }
    markDirty();
  };

  dom.stage.addEventListener('pointerup', endPan);
  dom.stage.addEventListener('pointercancel', endPan);
  dom.stage.addEventListener('mouseleave', (event) => {
    if (appSettings.spotlightEnabled) {
      updateSpotlightPosition(tabId, event);
    }
  });
}

function applyViewTransform(tabId) {
  const tabData = tabs.get(tabId);
  const dom = getTabDom(tabId);
  if (!tabData || !dom.transform) {
    return;
  }
  dom.transform.style.transform = `translate(${tabData.viewState.panX}px, ${tabData.viewState.panY}px) scale(${tabData.viewState.scale})`;
}

function updateSpotlightPosition(tabId, event) {
  const dom = getTabDom(tabId);
  if (!dom.stage || !dom.spotlightOverlay) {
    return;
  }

  const rect = dom.stage.getBoundingClientRect();
  const x = clamp(event.clientX - rect.left, 0, rect.width);
  const y = clamp(event.clientY - rect.top, 0, rect.height);
  dom.spotlightOverlay.style.setProperty('--spotlight-x', `${x}px`);
  dom.spotlightOverlay.style.setProperty('--spotlight-y', `${y}px`);
}

function updateMaskOverlay(tabId) {
  const dom = getTabDom(tabId);
  if (!dom.maskOverlay) {
    return;
  }

  if (!appSettings.maskEnabled) {
    dom.maskOverlay.classList.remove('active');
    return;
  }

  const opacity = clamp(appSettings.maskRevealPercent, 10, 100) / 100;
  dom.maskOverlay.classList.add('active');
  dom.maskOverlay.style.top = '0';
  dom.maskOverlay.style.height = '100%';
  dom.maskOverlay.style.opacity = String(opacity);
}

function updateSpotlightOverlay(tabId) {
  const dom = getTabDom(tabId);
  if (!dom.spotlightOverlay) {
    return;
  }

  if (!appSettings.spotlightEnabled) {
    dom.spotlightOverlay.classList.remove('active');
    return;
  }

  dom.spotlightOverlay.classList.add('active');
  dom.spotlightOverlay.style.setProperty('--spotlight-radius', `${appSettings.spotlightRadius}px`);
}

function updateFreezeOverlay(tabId) {
  const dom = getTabDom(tabId);
  if (!dom.freezeOverlay) {
    return;
  }

  dom.freezeOverlay.classList.toggle('active', appSettings.freezeMode);
}

function updateAllOverlays() {
  tabs.forEach((_, tabId) => {
    updateSpotlightOverlay(tabId);
    updateMaskOverlay(tabId);
    updateFreezeOverlay(tabId);
  });
}

function applyInteractionStateToTab(tabId) {
  const dom = getTabDom(tabId);
  const tabData = tabs.get(tabId);
  if (!dom.chalkboard || !dom.canvas || !tabData) {
    return;
  }

  const isSecondarySplit = appSettings.splitMode && appSettings.splitTabId === tabId && activeTabId !== tabId;
  const canEditText = !appSettings.editLocked && !appSettings.freezeMode && !isSecondarySplit;
  const canInteractDrawing = canEditText && appSettings.activeTool !== 'text';

  dom.chalkboard.contentEditable = canEditText ? 'true' : 'false';
  dom.chalkboard.classList.toggle('locked', !canEditText);

  if (canInteractDrawing) {
    dom.canvas.style.pointerEvents = 'auto';
  } else {
    dom.canvas.style.pointerEvents = 'none';
  }

  dom.stage.classList.toggle('stage-frozen', appSettings.freezeMode);
  applyViewTransform(tabId);
  updateSpotlightOverlay(tabId);
  updateMaskOverlay(tabId);
  updateFreezeOverlay(tabId);
}

function applyAllInteractionStates() {
  tabs.forEach((_, tabId) => {
    applyInteractionStateToTab(tabId);
  });
}

function setupGlobalDocumentHandlers() {
  if (hasGlobalDocumentHandlers) {
    return;
  }
  hasGlobalDocumentHandlers = true;

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.color-picker-container')) {
      document.querySelectorAll('.predefined-colors.show').forEach((panel) => panel.classList.remove('show'));
    }
    if (!event.target.closest('.math-button') && !event.target.closest('.math-symbol-panel')) {
      document.querySelectorAll('.math-symbol-panel.show').forEach((panel) => panel.classList.remove('show'));
    }
  });

  document.addEventListener('selectionchange', () => {
    if (!activeTabId || !tabs.has(activeTabId)) {
      return;
    }
    const dom = getTabDom(activeTabId);
    if (!dom.chalkboard) {
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (!dom.chalkboard.contains(range.commonAncestorContainer)) {
      return;
    }

    saveSelection();
    updateToolbarState(activeTabId);
  });

  document.addEventListener('keydown', (event) => {
    const activeElement = document.activeElement;
    const isTypingField = activeElement && (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'SELECT' ||
      activeElement.tagName === 'TEXTAREA'
    );

    if (event.key === ' ' && !isTypingField) {
      isSpacePressed = true;
    }

    if (event.ctrlKey && event.key === 's') {
      event.preventDefault();
      const saveButton = document.getElementById('saveButton');
      handleManualSaveClick(saveButton);
      return;
    }

    if (event.ctrlKey && event.key === 'Tab') {
      event.preventDefault();
      const tabIds = [...tabs.keys()];
      if (tabIds.length <= 1) {
        return;
      }
      const currentIndex = tabIds.indexOf(activeTabId);
      const nextIndex = event.shiftKey
        ? (currentIndex - 1 + tabIds.length) % tabIds.length
        : (currentIndex + 1) % tabIds.length;
      switchToTab(tabIds[nextIndex]);
      return;
    }

    if (event.ctrlKey && (event.key === '=' || event.key === '+')) {
      event.preventDefault();
      adjustActiveFontSize(1);
      return;
    }

    if (event.ctrlKey && event.key === '-') {
      event.preventDefault();
      adjustActiveFontSize(-1);
      return;
    }

    if (event.ctrlKey && event.shiftKey && (event.key === '>' || event.key === '.')) {
      event.preventDefault();
      adjustActiveFontSize(1);
      return;
    }

    if (event.ctrlKey && event.shiftKey && (event.key === '<' || event.key === ',')) {
      event.preventDefault();
      adjustActiveFontSize(-1);
      return;
    }

    if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      toggleSetting('editLocked');
      return;
    }

    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      toggleSetting('freezeMode');
      return;
    }

    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      toggleSetting('spotlightEnabled');
      return;
    }

    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'm') {
      event.preventDefault();
      toggleSetting('maskEnabled');
      return;
    }

    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      toggleSetting('splitMode');
      updateSplitModeView();
      return;
    }
  });

  document.addEventListener('keyup', (event) => {
    if (event.key === ' ') {
      isSpacePressed = false;
    }
  });

  window.addEventListener('resize', () => {
    tabs.forEach((_, tabId) => {
      resizeCanvas(tabId);
    });
  });
}

function adjustActiveFontSize(delta) {
  if (!activeTabId) {
    return;
  }
  const dom = getTabDom(activeTabId);
  if (!dom.chalkboard) {
    return;
  }

  const direction = delta >= 0 ? 1 : -1;
  saveSelection();
  stepFontSizeForTab(activeTabId, direction);
}

async function runStartupRecoveryIfNeeded() {
  if (startupRecoveryFinished || !window.electronAPI?.getStartupState) {
    return;
  }
  startupRecoveryFinished = true;

  try {
    const startupState = await window.electronAPI.getStartupState();
    if (startupState?.wasUncleanExit && snapshots.length > 0) {
      await restoreSnapshot(snapshots[0].id, { silent: true });
    }
  } catch (error) {
    console.error('Startup recovery check failed:', error);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  setupWindowControls();
  setupHeaderActions();
  setupPanels();
  setupSidebar();
  setupGlobalDocumentHandlers();

  await loadAppSettings();
  applySettingsToUI();
  await initializeDisplayOptions();
  await loadSnapshots();

  const loadedTabs = await loadAllTabsData();
  if (!loadedTabs) {
    createTab('칠판 1', { silent: true });
    switchToTab(tabs.keys().next().value);
  }

  await loadTimetable();
  startAutoPersistenceLoops();
  await runStartupRecoveryIfNeeded();

  if (window.electronAPI?.onSaveBeforeQuit) {
    window.electronAPI.onSaveBeforeQuit(async () => {
      try {
        await queuePersist({ snapshotReason: '종료' });
      } catch (error) {
        console.error('Save-before-quit failed:', error);
      } finally {
        window.electronAPI?.notifySaveBeforeQuitDone?.();
      }
    });
  }
});

window.toggleSidebar = toggleSidebar;
window.addTimetableItem = addTimetableItem;
window.clearChecked = clearChecked;
window.closeTab = closeTab;
