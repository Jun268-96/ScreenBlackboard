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
  maskRevealPercent: 96,
  activeTool: 'text',
  drawColor: '#ffffff',
  drawSize: 6
};

const AUTO_SAVE_INTERVAL = 20000;
const AUTO_SNAPSHOT_INTERVAL = 120000;
const LOW_LATENCY_SNAPSHOT_INTERVAL = 300000;
const SNAPSHOT_LIMIT = 30;
const LASER_FADE_MS = 900;
const LASER_TRAIL_GRACE_MS = 500;
const LASSO_POINT_MIN_DISTANCE = 4;
const CANVAS_WORLD_MIN_WIDTH = 3200;
const CANVAS_WORLD_MIN_HEIGHT = 2000;
const CANVAS_WORLD_WIDTH_MULTIPLIER = 2;
const CANVAS_WORLD_HEIGHT_MULTIPLIER = 2;
const CANVAS_WORLD_MAX_WIDTH = 5200;
const CANVAS_WORLD_MAX_HEIGHT = 3200;
const CANVAS_WORLD_EXPAND_STEP = 480;
const CANVAS_WORLD_AUTO_EXPAND_THRESHOLD = 240;
const UNDO_HISTORY_LIMIT = 24;
const UNDO_CAPTURE_DEBOUNCE_MS = 260;
const CANVAS_TEXT_COLOR_PRESETS = {
  red: '#dc2626',
  blue: '#1d4ed8'
};
const TEXT_BOX_BG_PRESET_COLORS = ['#ffffff', '#fff7cc', '#ffe4e6', '#dbeafe', '#dcfce7', '#ede9fe'];
const TOOL_KEYPAD_SHORTCUTS = {
  Digit1: 'pan',
  Numpad1: 'pan',
  Digit2: 'pen',
  Numpad2: 'pen',
  Digit3: 'highlighter',
  Numpad3: 'highlighter',
  Digit4: 'eraser',
  Numpad4: 'eraser',
  Digit5: 'line',
  Numpad5: 'line',
  Digit6: 'arrow',
  Numpad6: 'arrow',
  Digit7: 'rect',
  Numpad7: 'rect',
  Digit8: 'circle',
  Numpad8: 'circle',
  Digit9: 'lasso',
  Numpad9: 'lasso',
  Digit0: 'laser',
  Numpad0: 'laser'
};
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
let isApplyingUndoRedo = false;
let activePanState = null;
let touchPointers = new Map();
let penPointers = new Set();
let drawingStates = new Map();
let laserStates = new Map();
let lassoStates = new Map();
let undoStack = [];
let redoStack = [];
let undoCaptureTimer = null;
let startupRecoveryFinished = false;
let hasUnsavedChanges = false;

class TabData {
  constructor(id, title) {
    this.id = id;
    this.title = title;
    this.kind = 'chalkboard';
    this.content = '';
    this.formatState = { ...DEFAULT_FORMAT_STATE };
    this.drawingData = null;
    this.canvasItems = [];
    this.backgroundPreset = 'plain';
    this.viewState = {
      scale: 1,
      panX: 0,
      panY: 0,
      worldWidth: null,
      worldHeight: null
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
    laserCanvas: document.querySelector(`.laser-canvas[data-tab-id="${tabId}"]`),
    lassoCanvas: document.querySelector(`.lasso-canvas[data-tab-id="${tabId}"]`),
    objectLayer: document.querySelector(`.canvas-object-layer[data-tab-id="${tabId}"]`),
    textInlineToolbar: document.querySelector(`.canvas-text-inline-toolbar[data-tab-id="${tabId}"]`),
    maskOverlay: document.querySelector(`.mask-overlay[data-tab-id="${tabId}"]`)
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

function isCanvasTab(tabId) {
  return tabs.get(tabId)?.kind === 'canvas';
}

function createCanvasObjectId() {
  return `obj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function createCanvasObjectElement(item) {
  const object = document.createElement('div');
  object.className = `canvas-object canvas-object-${item.type}`;
  object.dataset.itemId = item.id || createCanvasObjectId();
  object.dataset.itemType = item.type;
  object.style.left = `${Math.max(0, Math.round(Number(item.x) || 0))}px`;
  object.style.top = `${Math.max(0, Math.round(Number(item.y) || 0))}px`;
  object.style.width = `${clamp(Math.round(Number(item.width) || 320), 120, 1600)}px`;
  object.style.height = `${clamp(Math.round(Number(item.height) || 220), 80, 1200)}px`;

  const label = item.type === 'image' ? '이미지' : '텍스트';
  const isTextObject = item.type === 'text';
  const textBgColor = isTextObject ? (item.bgColor || '#ffffff') : '';
  if (isTextObject) {
    object.dataset.bgColor = textBgColor;
  }
  const bgPaletteButtons = TEXT_BOX_BG_PRESET_COLORS
    .map((color) => `<button type="button" class="canvas-object-bg-chip" data-color="${color}" style="background-color: ${color};" title="${color}"></button>`)
    .join('');
  const textActions = isTextObject
    ? `
      <button type="button" class="canvas-object-bg-toggle" title="텍스트 박스 배경색">색상</button>
      <div class="canvas-object-bg-palette">${bgPaletteButtons}</div>
    `
    : '';
  object.innerHTML = `
    <div class="canvas-object-handle">
      <span class="canvas-object-title">${label}</span>
      <div class="canvas-object-actions">
        ${textActions}
        <button type="button" class="canvas-object-remove" title="삭제">&times;</button>
      </div>
    </div>
    <div class="canvas-object-body"></div>
    <button type="button" class="canvas-object-resize" title="크기 조절"></button>
  `;

  const body = object.querySelector('.canvas-object-body');
  if (item.type === 'image') {
    const image = document.createElement('img');
    image.src = item.src || '';
    image.alt = '캔버스 이미지';
    body.appendChild(image);
  } else {
    body.style.backgroundColor = textBgColor || '#ffffff';
    const text = document.createElement('div');
    text.className = 'canvas-text-content';
    text.contentEditable = 'true';
    text.innerHTML = item.html || '텍스트 입력';
    body.appendChild(text);
  }

  return object;
}

function syncCanvasItemsFromDom(tabId) {
  const tabData = tabs.get(tabId);
  const dom = getTabDom(tabId);
  if (!tabData || !dom.objectLayer) {
    return;
  }

  const items = [];
  dom.objectLayer.querySelectorAll('.canvas-object').forEach((object) => {
    const type = object.dataset.itemType;
    if (type !== 'image' && type !== 'text') {
      return;
    }
    const width = parseFloat(object.style.width) || object.offsetWidth || 320;
    const height = parseFloat(object.style.height) || object.offsetHeight || 220;
    const item = {
      id: object.dataset.itemId || createCanvasObjectId(),
      type,
      x: parseFloat(object.style.left) || 0,
      y: parseFloat(object.style.top) || 0,
      width,
      height
    };

    if (type === 'image') {
      item.src = object.querySelector('img')?.src || '';
    } else {
      item.html = object.querySelector('.canvas-text-content')?.innerHTML || '';
      item.bgColor = object.dataset.bgColor || '#ffffff';
    }

    items.push(item);
  });

  tabData.canvasItems = items;
}

function restoreCanvasItems(tabId) {
  const tabData = tabs.get(tabId);
  const dom = getTabDom(tabId);
  if (!tabData || !dom.objectLayer) {
    return;
  }

  dom.objectLayer.innerHTML = '';
  (tabData.canvasItems || []).forEach((item) => {
    if (item?.type !== 'image' && item?.type !== 'text') {
      return;
    }
    dom.objectLayer.appendChild(createCanvasObjectElement(item));
  });
}

function addCanvasItem(tabId, item) {
  if (!isCanvasTab(tabId)) {
    return;
  }
  const dom = getTabDom(tabId);
  if (!dom.objectLayer) {
    return;
  }
  if (item?.type !== 'image' && item?.type !== 'text') {
    return;
  }
  dom.objectLayer.appendChild(createCanvasObjectElement(item));
  syncCanvasItemsFromDom(tabId);
  markDirty();
}

function addCanvasImageFromData(tabId, dataUrl) {
  addCanvasItem(tabId, {
    id: createCanvasObjectId(),
    type: 'image',
    x: 80,
    y: 80,
    width: 420,
    height: 280,
    src: dataUrl
  });
}

function addCanvasTextBox(tabId) {
  addCanvasItem(tabId, {
    id: createCanvasObjectId(),
    type: 'text',
    x: 100,
    y: 90,
    width: 360,
    height: 220,
    html: '텍스트 입력',
    bgColor: '#ffffff'
  });
}

function clearCanvasTabContent(tabId) {
  if (!isCanvasTab(tabId)) {
    return;
  }

  const tabData = tabs.get(tabId);
  const dom = getTabDom(tabId);
  if (!tabData || !dom.canvas) {
    return;
  }

  const ctx = dom.canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const laserState = laserStates.get(tabId);
  if (laserState) {
    laserState.isDrawing = false;
    laserState.pointerId = null;
    laserState.lastPoint = null;
    laserState.lastFrameAt = 0;
    laserState.trailUntil = 0;
    if (laserState.rafId) {
      cancelAnimationFrame(laserState.rafId);
      laserState.rafId = null;
    }
  }
  if (dom.laserCanvas) {
    const laserCtx = dom.laserCanvas.getContext('2d');
    laserCtx?.clearRect(0, 0, dom.laserCanvas.width, dom.laserCanvas.height);
  }

  const lassoState = lassoStates.get(tabId);
  if (lassoState) {
    lassoState.mode = 'idle';
    lassoState.points = [];
    lassoState.selectionCanvas = null;
    lassoState.selectionWidth = 0;
    lassoState.selectionHeight = 0;
  }
  if (dom.lassoCanvas) {
    const lassoCtx = dom.lassoCanvas.getContext('2d');
    lassoCtx?.clearRect(0, 0, dom.lassoCanvas.width, dom.lassoCanvas.height);
  }

  tabData.drawingData = null;
  tabData.canvasItems = [];
  if (dom.objectLayer) {
    dom.objectLayer.innerHTML = '';
  }
  if (dom.chalkboard) {
    dom.chalkboard.innerHTML = '';
  }
  markDirty();
}

function handleCanvasClipboardPayload(tabId, clipboardData) {
  if (!isCanvasTab(tabId) || !clipboardData) {
    return false;
  }

  const items = [...(clipboardData.items || [])];
  const imageItem = items.find((item) => item.type.startsWith('image/'));
  if (!imageItem) {
    return false;
  }

  const file = imageItem.getAsFile();
  if (!file) {
    return false;
  }

  const reader = new FileReader();
  reader.onload = () => {
    addCanvasImageFromData(tabId, reader.result);
  };
  reader.readAsDataURL(file);
  return true;
}

function setActiveTool(tool, options = {}) {
  if (!tool) {
    return;
  }

  if (tool !== 'lasso' && activeTabId && isCanvasTab(activeTabId)) {
    commitLassoSelection(activeTabId, { markDirty: false });
  }

  appSettings.activeTool = tool;
  syncDrawControls();
  applyAllInteractionStates();
  if (options.markDirty !== false) {
    markDirty();
  }
}

function setupCanvasObjectLayerHandlers(tabId) {
  const dom = getTabDom(tabId);
  if (!dom.objectLayer || dom.objectLayer.dataset.bound === 'true') {
    return;
  }
  dom.objectLayer.dataset.bound = 'true';

  let dragState = null;
  let inlineRange = null;
  let inlineTextHost = null;
  let suppressInlineSelectionUpdates = false;

  const closeAllTextBgPalettes = () => {
    dom.objectLayer.querySelectorAll('.canvas-object-bg-palette.show').forEach((panel) => {
      panel.classList.remove('show');
    });
  };

  const getTextContentForRange = (range) => {
    if (!range) {
      return null;
    }
    const containerElement = range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer?.parentElement;
    const textContent = containerElement?.closest('.canvas-text-content');
    if (!textContent || !dom.objectLayer.contains(textContent)) {
      return null;
    }
    return textContent;
  };

  const cacheInlineSelectionFromWindow = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return false;
    }

    const range = selection.getRangeAt(0);
    const textContent = getTextContentForRange(range);
    if (!textContent) {
      return false;
    }

    inlineRange = range.cloneRange();
    inlineTextHost = textContent;
    return true;
  };

  const restoreInlineSelection = () => {
    if (!inlineRange || !inlineTextHost) {
      return false;
    }

    inlineTextHost.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection) {
      return false;
    }

    selection.removeAllRanges();
    selection.addRange(inlineRange.cloneRange());
    return selection.rangeCount > 0;
  };

  const getSelectedTextNodes = (range) => {
    if (!range) {
      return [];
    }
    const root = range.commonAncestorContainer;
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (!node?.nodeValue || node.nodeValue.trim().length === 0) {
            return NodeFilter.FILTER_REJECT;
          }
          try {
            return range.intersectsNode(node)
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_REJECT;
          } catch (error) {
            return NodeFilter.FILTER_REJECT;
          }
        }
      }
    );

    const nodes = [];
    if (root.nodeType === Node.TEXT_NODE && root.nodeValue?.trim().length > 0) {
      nodes.push(root);
    }
    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
    }
    return nodes;
  };

  const isSelectionStyled = (range, checker) => {
    const textNodes = getSelectedTextNodes(range);
    if (textNodes.length === 0) {
      return false;
    }
    return textNodes.every((node) => {
      const host = node.parentElement || inlineTextHost;
      if (!host) {
        return false;
      }
      return checker(window.getComputedStyle(host));
    });
  };

  const clearInlineStyleProperty = (rootNode, property) => {
    const kebab = property.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
    const traverse = (node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        node.style?.removeProperty(kebab);
        if (node.getAttribute && node.getAttribute('style') === '') {
          node.removeAttribute('style');
        }
      }
      node.childNodes?.forEach((child) => traverse(child));
    };
    traverse(rootNode);
  };

  const applyInlineStyleToSelection = (style, clearKeys = []) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return false;
    }

    const range = selection.getRangeAt(0);
    if (range.collapsed) {
      return false;
    }

    const textContent = getTextContentForRange(range);
    if (!textContent) {
      return false;
    }

    const fragment = range.extractContents();
    clearKeys.forEach((key) => clearInlineStyleProperty(fragment, key));
    const span = document.createElement('span');
    Object.assign(span.style, style);
    span.appendChild(fragment);
    range.insertNode(span);

    const nextRange = document.createRange();
    nextRange.selectNodeContents(span);
    selection.removeAllRanges();
    selection.addRange(nextRange);
    inlineRange = nextRange.cloneRange();
    inlineTextHost = textContent;
    return true;
  };

  const hideInlineTextToolbar = (clearSelection = false) => {
    if (!dom.textInlineToolbar) {
      return;
    }
    dom.textInlineToolbar.classList.remove('show');
    if (clearSelection) {
      inlineRange = null;
      inlineTextHost = null;
    }
  };

  const updateInlineTextToolbar = () => {
    const toolbar = dom.textInlineToolbar;
    if (!toolbar) {
      return;
    }

    if (activeTabId !== tabId || appSettings.editLocked) {
      hideInlineTextToolbar(true);
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      hideInlineTextToolbar(false);
      return;
    }

    const range = selection.getRangeAt(0);
    const textContent = getTextContentForRange(range);

    if (!textContent) {
      hideInlineTextToolbar(false);
      return;
    }

    const candidateRect = range.getBoundingClientRect();
    const rect = (candidateRect.width > 0 || candidateRect.height > 0)
      ? candidateRect
      : range.getClientRects()?.[0];
    if (!rect) {
      hideInlineTextToolbar(false);
      return;
    }

    const stageRect = dom.stage.getBoundingClientRect();
    const halfWidth = 120;
    const x = clamp(
      (rect.left + (rect.width / 2)) - stageRect.left,
      halfWidth,
      Math.max(halfWidth, stageRect.width - halfWidth)
    );
    const y = clamp(
      rect.top - stageRect.top - 12,
      8,
      Math.max(8, stageRect.height - 8)
    );

    toolbar.style.left = `${x}px`;
    toolbar.style.top = `${y}px`;
    toolbar.classList.add('show');
    inlineRange = range.cloneRange();
    inlineTextHost = textContent;
  };

  if (dom.textInlineToolbar && dom.textInlineToolbar.dataset.bound !== 'true') {
    const toolbar = dom.textInlineToolbar;
    toolbar.dataset.bound = 'true';

    toolbar.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      suppressInlineSelectionUpdates = true;
      cacheInlineSelectionFromWindow();
    });

    toolbar.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      suppressInlineSelectionUpdates = true;
      cacheInlineSelectionFromWindow();
    });

    toolbar.addEventListener('click', (event) => {
      if (appSettings.editLocked) {
        suppressInlineSelectionUpdates = false;
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest('.canvas-inline-tool-btn');
      if (!button) {
        suppressInlineSelectionUpdates = false;
        return;
      }

      if (!cacheInlineSelectionFromWindow() && !inlineRange) {
        suppressInlineSelectionUpdates = false;
        return;
      }

      if (!restoreInlineSelection()) {
        suppressInlineSelectionUpdates = false;
        return;
      }

      const action = button.dataset.action;
      let applied = false;
      if (action === 'bold') {
        const selection = window.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        const isBold = isSelectionStyled(range, (computed) => {
          const weight = Number.parseInt(computed.fontWeight, 10);
          return computed.fontWeight === 'bold' || Number.isFinite(weight) && weight >= 600;
        });
        applied = applyInlineStyleToSelection(
          { fontWeight: isBold ? '400' : '700' },
          ['fontWeight']
        );
      } else if (action === 'italic') {
        const selection = window.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        const isItalic = isSelectionStyled(range, (computed) => computed.fontStyle === 'italic' || computed.fontStyle === 'oblique');
        applied = applyInlineStyleToSelection(
          { fontStyle: isItalic ? 'normal' : 'italic' },
          ['fontStyle']
        );
      } else if (action === 'color') {
        const colorKey = button.dataset.color;
        const color = CANVAS_TEXT_COLOR_PRESETS[colorKey];
        if (color) {
          const targetColor = colorToRgba(color, 1).replace(', 1)', ')').replace('rgba', 'rgb');
          const selection = window.getSelection();
          const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
          const isTargetColor = isSelectionStyled(range, (computed) => computed.color.replace(/\s+/g, '') === targetColor.replace(/\s+/g, ''));
          applied = applyInlineStyleToSelection(
            { color: isTargetColor ? '#111827' : color },
            ['color']
          );
        }
      }

      if (!applied) {
        suppressInlineSelectionUpdates = false;
        return;
      }

      syncCanvasItemsFromDom(tabId);
      markDirty();
      setTimeout(() => {
        suppressInlineSelectionUpdates = false;
        updateInlineTextToolbar();
      }, 0);
    });
  }

  dom.objectLayer.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }

    const removeButton = target.closest('.canvas-object-remove');
    if (!removeButton) {
      const bgToggle = target.closest('.canvas-object-bg-toggle');
      if (bgToggle) {
        const object = bgToggle.closest('.canvas-object');
        const palette = object?.querySelector('.canvas-object-bg-palette');
        if (!palette) {
          return;
        }
        const shouldOpen = !palette.classList.contains('show');
        closeAllTextBgPalettes();
        palette.classList.toggle('show', shouldOpen);
        return;
      }

      const bgChip = target.closest('.canvas-object-bg-chip');
      if (bgChip) {
        const object = bgChip.closest('.canvas-object');
        const color = bgChip.dataset.color;
        if (!object || !color) {
          return;
        }
        object.dataset.bgColor = color;
        const body = object.querySelector('.canvas-object-body');
        if (body) {
          body.style.backgroundColor = color;
        }
        closeAllTextBgPalettes();
        syncCanvasItemsFromDom(tabId);
        markDirty();
        return;
      }

      if (!target.closest('.canvas-object-bg-palette')) {
        closeAllTextBgPalettes();
      }
      return;
    }
    const object = removeButton.closest('.canvas-object');
    object?.remove();
    syncCanvasItemsFromDom(tabId);
    markDirty();
  });

  dom.objectLayer.addEventListener('input', (event) => {
    if (!event.target.closest('.canvas-text-content')) {
      return;
    }
    syncCanvasItemsFromDom(tabId);
    markDirty(false);
    setTimeout(updateInlineTextToolbar, 0);
  });

  dom.objectLayer.addEventListener('mouseup', () => {
    setTimeout(updateInlineTextToolbar, 0);
  });

  dom.objectLayer.addEventListener('keyup', (event) => {
    if (event.target.closest('.canvas-text-content')) {
      setTimeout(updateInlineTextToolbar, 0);
    }
  });

  dom.objectLayer.addEventListener('scroll', (event) => {
    if (event.target.closest('.canvas-text-content')) {
      setTimeout(updateInlineTextToolbar, 0);
    }
  }, true);

  document.addEventListener('selectionchange', () => {
    if (activeTabId !== tabId) {
      return;
    }
    if (suppressInlineSelectionUpdates) {
      return;
    }
    updateInlineTextToolbar();
  });

  document.addEventListener('pointerdown', (event) => {
    if (activeTabId !== tabId) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      hideInlineTextToolbar(true);
      closeAllTextBgPalettes();
      return;
    }
    if (target.closest(`.canvas-text-inline-toolbar[data-tab-id="${tabId}"]`) || target.closest('.canvas-text-content')) {
      return;
    }
    hideInlineTextToolbar(true);
    if (!target.closest('.canvas-object-bg-toggle') && !target.closest('.canvas-object-bg-palette')) {
      closeAllTextBgPalettes();
    }
  });

  dom.objectLayer.addEventListener('pointerdown', (event) => {
    if (appSettings.editLocked) {
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }

    if (target.closest('.canvas-object-bg-toggle') || target.closest('.canvas-object-bg-palette')) {
      event.stopPropagation();
      return;
    }

    if (target.closest('.canvas-object-remove')) {
      event.stopPropagation();
      return;
    }

    if (target.closest('.canvas-text-content')) {
      return;
    }

    const resizeHandle = target.closest('.canvas-object-resize');
    const handle = target.closest('.canvas-object-handle');
    if (!handle && !resizeHandle) {
      return;
    }
    const object = (handle || resizeHandle).closest('.canvas-object');
    if (!object) {
      return;
    }

    hideInlineTextToolbar(true);
    closeAllTextBgPalettes();

    const pointerPoint = getPointerPointInCanvas(tabId, event);
    const objectLeft = parseFloat(object.style.left) || 0;
    const objectTop = parseFloat(object.style.top) || 0;
    const objectWidth = parseFloat(object.style.width) || object.offsetWidth || 320;
    const objectHeight = parseFloat(object.style.height) || object.offsetHeight || 220;
    if (resizeHandle) {
      dragState = {
        mode: 'resize',
        pointerId: event.pointerId,
        object,
        startPointerX: pointerPoint.x,
        startPointerY: pointerPoint.y,
        startWidth: objectWidth,
        startHeight: objectHeight
      };
      object.classList.add('resizing');
    } else {
      dragState = {
        mode: 'move',
        pointerId: event.pointerId,
        object,
        offsetX: pointerPoint.x - objectLeft,
        offsetY: pointerPoint.y - objectTop
      };
      object.classList.add('dragging');
    }

    dom.objectLayer.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  });

  dom.objectLayer.addEventListener('pointermove', (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const tabData = tabs.get(tabId);
    const pointerPoint = getPointerPointInCanvas(tabId, event);
    const worldWidth = Number(tabData?.viewState?.worldWidth) || dom.objectLayer.clientWidth || dom.stage.clientWidth || 1;
    const worldHeight = Number(tabData?.viewState?.worldHeight) || dom.objectLayer.clientHeight || dom.stage.clientHeight || 1;

    if (dragState.mode === 'resize') {
      const left = parseFloat(dragState.object.style.left) || 0;
      const top = parseFloat(dragState.object.style.top) || 0;
      const maxWidth = Math.max(140, worldWidth - left);
      const maxHeight = Math.max(100, worldHeight - top);
      const nextWidth = clamp(dragState.startWidth + (pointerPoint.x - dragState.startPointerX), 140, maxWidth);
      const nextHeight = clamp(dragState.startHeight + (pointerPoint.y - dragState.startPointerY), 100, maxHeight);
      dragState.object.style.width = `${Math.round(nextWidth)}px`;
      dragState.object.style.height = `${Math.round(nextHeight)}px`;
    } else {
      const objectWidth = parseFloat(dragState.object.style.width) || dragState.object.offsetWidth || 320;
      const objectHeight = parseFloat(dragState.object.style.height) || dragState.object.offsetHeight || 220;
      const maxX = Math.max(0, worldWidth - objectWidth);
      const maxY = Math.max(0, worldHeight - objectHeight);
      const x = clamp(pointerPoint.x - dragState.offsetX, 0, maxX);
      const y = clamp(pointerPoint.y - dragState.offsetY, 0, maxY);
      dragState.object.style.left = `${Math.round(x)}px`;
      dragState.object.style.top = `${Math.round(y)}px`;
    }
    markDirty(false);
    event.preventDefault();
  });

  const finishDrag = (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    dragState.object.classList.remove('dragging');
    dragState.object.classList.remove('resizing');
    try {
      dom.objectLayer.releasePointerCapture(event.pointerId);
    } catch (error) {
      // Ignore pointer capture release errors.
    }
    dragState = null;
    syncCanvasItemsFromDom(tabId);
    markDirty();
  };

  dom.objectLayer.addEventListener('pointerup', finishDrag);
  dom.objectLayer.addEventListener('pointercancel', finishDrag);
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

function colorToRgba(color, alpha = 1) {
  const { r, g, b } = parseColorToRgb(color || '#ffffff');
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${clamp(alpha, 0, 1)})`;
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
      kind: tabData.kind,
      content: tabData.content,
      formatState: tabData.formatState,
      drawingData: tabData.drawingData,
      canvasItems: tabData.canvasItems,
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

function cloneSerializableState(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function captureUndoHistoryState() {
  const snapshot = captureSnapshotState();
  return {
    activeTabId: snapshot.activeTabId,
    tabCounter: snapshot.tabCounter,
    tabs: cloneSerializableState(snapshot.tabs || {}),
    timetable: cloneSerializableState(snapshot.timetable || []),
    settings: cloneSerializableState(snapshot.settings || {})
  };
}

function resetUndoHistory() {
  undoStack = [];
  redoStack = [];
  if (undoCaptureTimer) {
    clearTimeout(undoCaptureTimer);
    undoCaptureTimer = null;
  }
}

function pushUndoCheckpoint(options = {}) {
  if (isRestoringSnapshot || isApplyingUndoRedo) {
    return;
  }

  undoStack.push(captureUndoHistoryState());
  if (undoStack.length > UNDO_HISTORY_LIMIT) {
    undoStack = undoStack.slice(undoStack.length - UNDO_HISTORY_LIMIT);
  }

  if (!options.keepRedo) {
    redoStack = [];
  }
}

function scheduleUndoCheckpoint() {
  if (isRestoringSnapshot || isApplyingUndoRedo) {
    return;
  }

  if (undoCaptureTimer) {
    clearTimeout(undoCaptureTimer);
  }
  undoCaptureTimer = setTimeout(() => {
    undoCaptureTimer = null;
    pushUndoCheckpoint();
  }, UNDO_CAPTURE_DEBOUNCE_MS);
}

function flushPendingUndoCheckpoint() {
  if (!undoCaptureTimer) {
    return;
  }
  clearTimeout(undoCaptureTimer);
  undoCaptureTimer = null;
  pushUndoCheckpoint();
}

async function applyCapturedState(state) {
  if (!state) {
    return false;
  }

  isRestoringSnapshot = true;
  isApplyingUndoRedo = true;

  try {
    tabs.clear();
    tabCounter = 0;
    activeTabId = null;
    drawingStates.clear();
    laserStates.clear();
    lassoStates.clear();

    document.querySelector('.tabs-wrapper').innerHTML = '';
    document.getElementById('tabContents').innerHTML = '';

    const snapshotTabs = state.tabs || {};
    Object.values(snapshotTabs).forEach((tabObj) => {
      createTab(tabObj.title || '칠판', {
        id: tabObj.id,
        data: tabObj,
        silent: true
      });
    });

    const restoreTabId = state.activeTabId && tabs.has(state.activeTabId)
      ? state.activeTabId
      : tabs.keys().next().value;
    if (restoreTabId) {
      switchToTab(restoreTabId);
    }
    tabCounter = state.tabCounter || tabCounter;

    const timetableList = document.getElementById('timetableList');
    timetableList.innerHTML = '';
    const snapshotTimetable = Array.isArray(state.timetable) ? state.timetable : [];
    snapshotTimetable.forEach((item, index) => appendTimetableItem(item, index));
    updateTimetableLayout();

    if (state.settings) {
      appSettings = { ...appSettings, ...cloneSerializableState(state.settings) };
      applySettingsToUI();
    }

    await queuePersist({ skipSnapshot: true, force: true });
    return true;
  } catch (error) {
    console.error('Undo/redo apply failed:', error);
    return false;
  } finally {
    isRestoringSnapshot = false;
    isApplyingUndoRedo = false;
  }
}

async function undoLastChange() {
  flushPendingUndoCheckpoint();
  if (undoStack.length <= 1) {
    return false;
  }

  const current = undoStack.pop();
  redoStack.push(current);
  if (redoStack.length > UNDO_HISTORY_LIMIT) {
    redoStack = redoStack.slice(redoStack.length - UNDO_HISTORY_LIMIT);
  }

  const previous = undoStack[undoStack.length - 1];
  return applyCapturedState(cloneSerializableState(previous));
}

async function redoLastUndo() {
  if (redoStack.length === 0) {
    return false;
  }

  const next = redoStack.pop();
  undoStack.push(next);
  if (undoStack.length > UNDO_HISTORY_LIMIT) {
    undoStack = undoStack.slice(undoStack.length - UNDO_HISTORY_LIMIT);
  }

  return applyCapturedState(cloneSerializableState(next));
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
    const normalized = { ...DEFAULT_SETTINGS };
    Object.keys(DEFAULT_SETTINGS).forEach((key) => {
      if (parsed[key] !== undefined) {
        normalized[key] = parsed[key];
      }
    });
    appSettings = normalized;
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
  let restored = false;

  try {
    tabs.clear();
    tabCounter = 0;
    activeTabId = null;
    drawingStates.clear();
    laserStates.clear();
    lassoStates.clear();

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
    restored = true;
  } catch (error) {
    console.error('Snapshot restore failed:', error);
  } finally {
    isRestoringSnapshot = false;
    if (restored) {
      resetUndoHistory();
      pushUndoCheckpoint();
    }
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
  if (isRestoringSnapshot || isApplyingUndoRedo) {
    return;
  }

  hasUnsavedChanges = true;

  if (shouldSchedulePersist) {
    scheduleUndoCheckpoint();
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
  const addCanvasTabButton = document.getElementById('addCanvasTabButton');
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

  addCanvasTabButton?.addEventListener('click', () => {
    createTab(`캔버스 ${tabCounter + 1}`, { kind: 'canvas' });
    markDirty();
  });

  saveButton?.addEventListener('click', async () => {
    await handleManualSaveClick(saveButton);
  });
}

function updateHeaderButtonStates() {
  document.getElementById('lockModeButton')?.classList.toggle('active', appSettings.editLocked);
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

  document.getElementById('maskRevealInput')?.addEventListener('input', (event) => {
    appSettings.maskRevealPercent = parseInt(event.target.value, 10) || 96;
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
  appSettings.maskRevealPercent = clamp(parseInt(appSettings.maskRevealPercent, 10) || 96, 80, 100);

  const highContrastToggle = document.getElementById('highContrastToggle');
  const safePaletteToggle = document.getElementById('safePaletteToggle');
  const lowLatencyToggle = document.getElementById('lowLatencyToggle');
  const touchOptimizeToggle = document.getElementById('touchOptimizeToggle');
  const splitModeToggle = document.getElementById('splitModeToggle');
  const maskRevealInput = document.getElementById('maskRevealInput');
  const presetSelect = document.getElementById('presetSelect');

  if (highContrastToggle) {
    highContrastToggle.checked = appSettings.highContrastTheme;
  }
  if (safePaletteToggle) {
    safePaletteToggle.checked = appSettings.safePalette;
  }
  if (lowLatencyToggle) {
    lowLatencyToggle.checked = appSettings.lowLatencyMode;
  }
  if (touchOptimizeToggle) {
    touchOptimizeToggle.checked = appSettings.touchOptimized;
  }
  if (splitModeToggle) {
    splitModeToggle.checked = appSettings.splitMode;
  }
  if (maskRevealInput) {
    maskRevealInput.value = String(appSettings.maskRevealPercent);
  }
  if (presetSelect) {
    presetSelect.value = appSettings.performancePreset;
  }

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
  tabData.kind = options.kind || options.data?.kind || 'chalkboard';

  if (options.data) {
    tabData.content = options.data.content || '';
    tabData.formatState = { ...DEFAULT_FORMAT_STATE, ...(options.data.formatState || {}) };
    tabData.drawingData = options.data.drawingData || null;
    tabData.canvasItems = Array.isArray(options.data.canvasItems) ? options.data.canvasItems : [];
    tabData.backgroundPreset = options.data.backgroundPreset || 'plain';
    const savedScale = Number(options.data.viewState?.scale);
    const savedPanX = Number(options.data.viewState?.panX);
    const savedPanY = Number(options.data.viewState?.panY);
    const savedWorldWidth = Number(options.data.viewState?.worldWidth);
    const savedWorldHeight = Number(options.data.viewState?.worldHeight);
    tabData.viewState = {
      scale: Number.isFinite(savedScale) && savedScale > 0 ? savedScale : 1,
      panX: Number.isFinite(savedPanX) ? savedPanX : 0,
      panY: Number.isFinite(savedPanY) ? savedPanY : 0,
      worldWidth: Number.isFinite(savedWorldWidth) ? Math.round(savedWorldWidth) : null,
      worldHeight: Number.isFinite(savedWorldHeight) ? Math.round(savedWorldHeight) : null
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
  const tabData = tabs.get(tabId);
  const isCanvas = tabData?.kind === 'canvas';
  const tabContents = document.getElementById('tabContents');
  const contentElement = document.createElement('div');
  contentElement.className = `tab-content ${isCanvas ? 'canvas-tab' : ''}`;
  contentElement.dataset.tabId = tabId;
  contentElement.innerHTML = `
    <div class="toolbar ${isCanvas ? 'canvas-toolbar' : ''}" data-tab-id="${tabId}">
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
        ${isCanvas ? `
        <div class="canvas-tool-palette">
          <button class="canvas-palette-btn" data-tool="pan" title="1: 이동/줌">이동</button>
          <button class="canvas-palette-btn" data-tool="pen" title="2: 펜">펜</button>
          <button class="canvas-palette-btn" data-tool="highlighter" title="3: 형광펜">형광</button>
          <button class="canvas-palette-btn" data-tool="eraser" title="4: 지우개">지우개</button>
          <button class="canvas-palette-btn" data-tool="line" title="5: 직선">직선</button>
          <button class="canvas-palette-btn" data-tool="arrow" title="6: 화살표">화살표</button>
          <button class="canvas-palette-btn" data-tool="rect" title="7: 사각형">사각형</button>
          <button class="canvas-palette-btn" data-tool="circle" title="8: 원">원</button>
          <button class="canvas-palette-btn" data-tool="lasso" title="9: 올가미 선택/이동">올가미</button>
          <button class="canvas-palette-btn" data-tool="laser" title="0: 레이저 포인터">레이저</button>
        </div>
        ` : ''}
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
          <option value="lasso">올가미</option>
          <option value="laser">레이저</option>
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

      ${isCanvas ? `
      <div class="divider"></div>

      <div class="canvas-tools">
        <button class="canvas-tool-btn canvas-add-image-btn" title="이미지 붙여넣기/파일 추가">이미지</button>
        <button class="canvas-tool-btn canvas-add-text-btn" title="드래그 가능한 텍스트 박스 추가">텍스트박스</button>
        <button class="canvas-tool-btn canvas-clear-btn" title="캔버스 전체 지우기">전체지우기</button>
        <input type="file" class="canvas-image-input hidden-color-picker" accept="image/*">
      </div>
      ` : ''}

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
        ${isCanvas ? `<div class="canvas-object-layer" data-tab-id="${tabId}"></div>` : ''}
        <canvas class="drawing-canvas" data-tab-id="${tabId}"></canvas>
        <canvas class="lasso-canvas" data-tab-id="${tabId}"></canvas>
        <div class="mask-overlay" data-tab-id="${tabId}"></div>
      </div>
      <canvas class="laser-canvas" data-tab-id="${tabId}"></canvas>
      ${isCanvas ? `
      <div class="canvas-text-inline-toolbar" data-tab-id="${tabId}">
        <button type="button" class="canvas-inline-tool-btn" data-action="bold">B</button>
        <button type="button" class="canvas-inline-tool-btn italic" data-action="italic">I</button>
        <button type="button" class="canvas-inline-tool-btn color-red" data-action="color" data-color="red">빨강</button>
        <button type="button" class="canvas-inline-tool-btn color-blue" data-action="color" data-color="blue">파랑</button>
      </div>
      ` : ''}
    </div>
  `;

  tabContents.appendChild(contentElement);
  initializeCanvas(tabId);
  setupTabEventListeners(tabId);
  setupCanvasObjectLayerHandlers(tabId);
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

  const targetTab = tabs.get(tabId);
  activeTabId = tabId;

  if (targetTab?.kind === 'canvas') {
    if (appSettings.drawColor.toLowerCase() === '#ffffff') {
      appSettings.drawColor = '#111111';
    }
    if (appSettings.activeTool === 'text') {
      setActiveTool('pen', { markDirty: false });
    } else {
      syncDrawControls();
      applyAllInteractionStates();
    }
  } else {
    if (appSettings.activeTool !== 'text') {
      setActiveTool('text', { markDirty: false });
    } else {
      syncDrawControls();
      applyAllInteractionStates();
    }
  }

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
  laserStates.delete(tabId);
  lassoStates.delete(tabId);

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
    if (isCanvasTab(tabId)) {
      commitLassoSelection(tabId, { markDirty: false });
    }
    const dom = getTabDom(tabId);
    if (dom.chalkboard) {
      tabData.content = dom.chalkboard.innerHTML;
    }
    if (dom.objectLayer) {
      syncCanvasItemsFromDom(tabId);
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
    dom.chalkboard.style.lineHeight = textFormatter.calculateLineHeight(tabData.formatState.fontSize);
  }

  restoreCanvasItems(tabId);
  renderDrawingData(tabId);
}

function applyTabBackground(tabId) {
  const tabData = tabs.get(tabId);
  const dom = getTabDom(tabId);
  if (!tabData || !dom.stage) {
    return;
  }

  dom.stage.classList.remove('background-plain', 'background-lined', 'background-grid', 'background-coordinate', 'canvas-whiteboard');
  if (tabData.kind === 'canvas') {
    dom.stage.classList.add('canvas-whiteboard');
    return;
  }
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
  const canvasAddImageBtn = toolbar.querySelector('.canvas-add-image-btn');
  const canvasAddTextBtn = toolbar.querySelector('.canvas-add-text-btn');
  const canvasClearBtn = toolbar.querySelector('.canvas-clear-btn');
  const canvasImageInput = toolbar.querySelector('.canvas-image-input');
  const canvasPaletteButtons = [...toolbar.querySelectorAll('.canvas-palette-btn')];

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
    setActiveTool(event.target.value);
  });

  canvasPaletteButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const tool = button.dataset.tool;
      if (!tool || appSettings.activeTool === tool) {
        return;
      }
      setActiveTool(tool);
    });
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

  canvasAddImageBtn?.addEventListener('click', () => {
    if (appSettings.editLocked) {
      return;
    }
    canvasImageInput?.click();
  });

  canvasImageInput?.addEventListener('change', (event) => {
    if (appSettings.editLocked) {
      return;
    }
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      addCanvasImageFromData(tabId, reader.result);
      event.target.value = '';
    };
    reader.readAsDataURL(file);
  });

  canvasAddTextBtn?.addEventListener('click', () => {
    if (appSettings.editLocked) {
      return;
    }
    addCanvasTextBox(tabId);
  });

  const handleCanvasClear = () => {
    if (appSettings.editLocked) {
      return;
    }
    clearCanvasTabContent(tabId);
  };
  canvasClearBtn?.addEventListener('click', handleCanvasClear);

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
      if (appSettings.editLocked) {
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
    if (appSettings.editLocked) {
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
    if (appSettings.editLocked) {
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
    if (appSettings.editLocked) {
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
      if (isCanvasTab(tabId)) {
        addCanvasImageFromData(tabId, reader.result);
        return;
      }
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
    if (appSettings.editLocked) {
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
      if (isCanvasTab(tabId)) {
        addCanvasImageFromData(tabId, reader.result);
        return;
      }
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
    toolbar.querySelectorAll('.canvas-palette-btn').forEach((button) => {
      button.classList.toggle('active', button.dataset.tool === appSettings.activeTool);
    });
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
  if (!tabData || !dom.stage || !dom.canvas || !dom.laserCanvas || !dom.lassoCanvas) {
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
  ensureLaserState(tabId);
  ensureLassoState(tabId);
  tabData.resizeObserver = observer;
}

function getDefaultCanvasWorldWidth(viewportWidth) {
  return clamp(
    Math.max(CANVAS_WORLD_MIN_WIDTH, Math.floor(viewportWidth * CANVAS_WORLD_WIDTH_MULTIPLIER)),
    CANVAS_WORLD_MIN_WIDTH,
    CANVAS_WORLD_MAX_WIDTH
  );
}

function getDefaultCanvasWorldHeight(viewportHeight) {
  return clamp(
    Math.max(CANVAS_WORLD_MIN_HEIGHT, Math.floor(viewportHeight * CANVAS_WORLD_HEIGHT_MULTIPLIER)),
    CANVAS_WORLD_MIN_HEIGHT,
    CANVAS_WORLD_MAX_HEIGHT
  );
}

function ensureCanvasWorldSize(tabData, viewportWidth, viewportHeight) {
  const defaultWidth = getDefaultCanvasWorldWidth(viewportWidth);
  const defaultHeight = getDefaultCanvasWorldHeight(viewportHeight);

  const savedWidth = Number(tabData?.viewState?.worldWidth);
  const savedHeight = Number(tabData?.viewState?.worldHeight);
  const worldWidth = clamp(
    Number.isFinite(savedWidth) && savedWidth > 0 ? Math.round(savedWidth) : defaultWidth,
    CANVAS_WORLD_MIN_WIDTH,
    CANVAS_WORLD_MAX_WIDTH
  );
  const worldHeight = clamp(
    Number.isFinite(savedHeight) && savedHeight > 0 ? Math.round(savedHeight) : defaultHeight,
    CANVAS_WORLD_MIN_HEIGHT,
    CANVAS_WORLD_MAX_HEIGHT
  );

  if (tabData?.viewState) {
    tabData.viewState.worldWidth = worldWidth;
    tabData.viewState.worldHeight = worldHeight;
  }

  return { worldWidth, worldHeight };
}

function clampCanvasPanToBounds(tabId, viewportWidth = null, viewportHeight = null) {
  const tabData = tabs.get(tabId);
  const dom = getTabDom(tabId);
  if (!tabData || !dom.stage || !isCanvasTab(tabId)) {
    return;
  }

  const resolvedViewportWidth = viewportWidth ?? Math.max(1, Math.floor(dom.stage.clientWidth));
  const resolvedViewportHeight = viewportHeight ?? Math.max(1, Math.floor(dom.stage.clientHeight));
  if (resolvedViewportWidth <= 1 || resolvedViewportHeight <= 1) {
    return;
  }

  const { worldWidth, worldHeight } = ensureCanvasWorldSize(tabData, resolvedViewportWidth, resolvedViewportHeight);
  const scale = clamp(Number(tabData.viewState?.scale) || 1, 0.5, 3.2);
  tabData.viewState.scale = scale;

  const minPanX = Math.min(0, resolvedViewportWidth - (worldWidth * scale));
  const minPanY = Math.min(0, resolvedViewportHeight - (worldHeight * scale));
  tabData.viewState.panX = clamp(Number(tabData.viewState.panX) || 0, minPanX, 0);
  tabData.viewState.panY = clamp(Number(tabData.viewState.panY) || 0, minPanY, 0);
}

function maybeAutoExpandCanvasWorld(tabId) {
  const tabData = tabs.get(tabId);
  const dom = getTabDom(tabId);
  if (!tabData || !dom.stage || !isCanvasTab(tabId)) {
    return false;
  }

  const viewportWidth = Math.max(1, Math.floor(dom.stage.clientWidth));
  const viewportHeight = Math.max(1, Math.floor(dom.stage.clientHeight));
  if (viewportWidth <= 1 || viewportHeight <= 1) {
    return false;
  }

  const { worldWidth, worldHeight } = ensureCanvasWorldSize(tabData, viewportWidth, viewportHeight);
  const scale = clamp(Number(tabData.viewState?.scale) || 1, 0.5, 3.2);
  const panX = Number(tabData.viewState.panX) || 0;
  const panY = Number(tabData.viewState.panY) || 0;

  const visibleRight = (-panX + viewportWidth) / scale;
  const visibleBottom = (-panY + viewportHeight) / scale;

  let expanded = false;
  let nextWorldWidth = worldWidth;
  let nextWorldHeight = worldHeight;

  if (visibleRight >= (worldWidth - CANVAS_WORLD_AUTO_EXPAND_THRESHOLD) && worldWidth < CANVAS_WORLD_MAX_WIDTH) {
    nextWorldWidth = Math.min(CANVAS_WORLD_MAX_WIDTH, worldWidth + CANVAS_WORLD_EXPAND_STEP);
    expanded = nextWorldWidth !== worldWidth;
  }

  if (visibleBottom >= (worldHeight - CANVAS_WORLD_AUTO_EXPAND_THRESHOLD) && worldHeight < CANVAS_WORLD_MAX_HEIGHT) {
    nextWorldHeight = Math.min(CANVAS_WORLD_MAX_HEIGHT, worldHeight + CANVAS_WORLD_EXPAND_STEP);
    expanded = expanded || nextWorldHeight !== worldHeight;
  }

  if (!expanded) {
    return false;
  }

  tabData.viewState.worldWidth = nextWorldWidth;
  tabData.viewState.worldHeight = nextWorldHeight;
  resizeCanvas(tabId);
  return true;
}

function resizeCanvas(tabId) {
  const dom = getTabDom(tabId);
  const tabData = tabs.get(tabId);
  if (!dom.canvas || !dom.laserCanvas || !dom.lassoCanvas || !dom.stage || !tabData) {
    return;
  }

  const viewportWidth = Math.max(1, Math.floor(dom.stage.clientWidth));
  const viewportHeight = Math.max(1, Math.floor(dom.stage.clientHeight));
  if (viewportWidth === 1 || viewportHeight === 1) {
    return;
  }

  const isCanvas = tabData.kind === 'canvas';
  const worldSize = isCanvas
    ? ensureCanvasWorldSize(tabData, viewportWidth, viewportHeight)
    : { worldWidth: viewportWidth, worldHeight: viewportHeight };
  const width = worldSize.worldWidth;
  const height = worldSize.worldHeight;

  const devicePixelRatio = isCanvas ? 1 : (window.devicePixelRatio || 1);
  const laserPixelRatio = 1;
  const targetWidth = Math.floor(width * devicePixelRatio);
  const targetHeight = Math.floor(height * devicePixelRatio);
  const laserTargetWidth = Math.floor(viewportWidth * laserPixelRatio);
  const laserTargetHeight = Math.floor(viewportHeight * laserPixelRatio);
  const sizeUnchanged = (
    dom.canvas.width === targetWidth &&
    dom.canvas.height === targetHeight &&
    dom.laserCanvas.width === laserTargetWidth &&
    dom.laserCanvas.height === laserTargetHeight &&
    dom.lassoCanvas.width === targetWidth &&
    dom.lassoCanvas.height === targetHeight
  );

  if (!sizeUnchanged) {
    dom.canvas.width = targetWidth;
    dom.canvas.height = targetHeight;
    dom.laserCanvas.width = laserTargetWidth;
    dom.laserCanvas.height = laserTargetHeight;
    dom.lassoCanvas.width = targetWidth;
    dom.lassoCanvas.height = targetHeight;
  }

  dom.canvas.style.width = `${width}px`;
  dom.canvas.style.height = `${height}px`;
  dom.laserCanvas.style.width = `${viewportWidth}px`;
  dom.laserCanvas.style.height = `${viewportHeight}px`;
  dom.lassoCanvas.style.width = `${width}px`;
  dom.lassoCanvas.style.height = `${height}px`;
  if (dom.transform) {
    dom.transform.style.width = `${width}px`;
    dom.transform.style.height = `${height}px`;
  }
  if (dom.objectLayer) {
    dom.objectLayer.style.width = `${width}px`;
    dom.objectLayer.style.height = `${height}px`;
  }

  if (isCanvas) {
    clampCanvasPanToBounds(tabId, viewportWidth, viewportHeight);
  }

  if (sizeUnchanged) {
    applyViewTransform(tabId);
    return;
  }

  const ctx = dom.canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  renderDrawingData(tabId);
  renderLassoOverlay(tabId);
  renderLaserTrail(tabId);
  applyViewTransform(tabId);
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
    const dpr = getCanvasPixelRatio(tabId);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return;
  }

  const image = new Image();
  image.onload = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
    ctx.drawImage(image, 0, 0, dom.canvas.width, dom.canvas.height);
    const dpr = getCanvasPixelRatio(tabId);
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

  if (dom.canvas) {
    const canvasRect = dom.canvas.getBoundingClientRect();
    if (canvasRect.width > 0 && canvasRect.height > 0) {
      const cssWidth = parseFloat(dom.canvas.style.width) || canvasRect.width;
      const cssHeight = parseFloat(dom.canvas.style.height) || canvasRect.height;
      const rawX = (event.clientX - canvasRect.left) * (cssWidth / canvasRect.width);
      const rawY = (event.clientY - canvasRect.top) * (cssHeight / canvasRect.height);

      if (isCanvasTab(tabId)) {
        const worldWidth = Number(tabData.viewState?.worldWidth) || cssWidth;
        const worldHeight = Number(tabData.viewState?.worldHeight) || cssHeight;
        return {
          x: clamp(rawX, 0, worldWidth),
          y: clamp(rawY, 0, worldHeight)
        };
      }

      return { x: rawX, y: rawY };
    }
  }

  const rect = dom.stage.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  return {
    x: (localX - tabData.viewState.panX) / tabData.viewState.scale,
    y: (localY - tabData.viewState.panY) / tabData.viewState.scale
  };
}

function getPointerPointInStage(tabId, event) {
  const dom = getTabDom(tabId);
  if (!dom.stage) {
    return { x: 0, y: 0 };
  }
  const rect = dom.stage.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  return {
    x: clamp(x, 0, rect.width),
    y: clamp(y, 0, rect.height)
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
  const dx = toX - fromX;
  const dy = toY - fromY;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) {
    return;
  }

  const ux = dx / distance;
  const uy = dy / distance;
  const px = -uy;
  const py = ux;

  const headLength = Math.max(16, appSettings.drawSize * 3);
  const headWidth = Math.max(10, appSettings.drawSize * 2.4);
  const shaftEndX = toX - (ux * headLength);
  const shaftEndY = toY - (uy * headLength);

  const leftX = shaftEndX + (px * headWidth * 0.5);
  const leftY = shaftEndY + (py * headWidth * 0.5);
  const rightX = shaftEndX - (px * headWidth * 0.5);
  const rightY = shaftEndY - (py * headWidth * 0.5);

  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(shaftEndX, shaftEndY);
  ctx.stroke();

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = appSettings.drawColor;
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(leftX, leftY);
  ctx.lineTo(rightX, rightY);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
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

function ensureLaserState(tabId) {
  if (!laserStates.has(tabId)) {
    laserStates.set(tabId, {
      isDrawing: false,
      pointerId: null,
      lastPoint: null,
      rafId: null,
      lastFrameAt: 0,
      trailUntil: 0
    });
  }
  return laserStates.get(tabId);
}

function drawLaserSegment(tabId, from, to, color, size) {
  const dom = getTabDom(tabId);
  if (!dom.laserCanvas || !from || !to) {
    return;
  }

  const ctx = dom.laserCanvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const cssWidth = parseFloat(dom.laserCanvas.style.width) || dom.laserCanvas.clientWidth || 1;
  const dpr = dom.laserCanvas.width / Math.max(1, cssWidth);
  const strokeColor = color || '#ffffff';

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';

  ctx.shadowBlur = 10;
  ctx.shadowColor = colorToRgba(strokeColor, 0.42);
  ctx.strokeStyle = colorToRgba(strokeColor, 0.28);
  ctx.lineWidth = size * 1.65;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = colorToRgba(strokeColor, 0.94);
  ctx.lineWidth = Math.max(1.4, size * 0.66);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function getLaserPointerPoints(tabId, event) {
  const coalesced = typeof event.getCoalescedEvents === 'function'
    ? event.getCoalescedEvents()
    : null;

  if (!coalesced || coalesced.length === 0) {
    return [getPointerPointInStage(tabId, event)];
  }

  return coalesced.map((entry) => getPointerPointInStage(tabId, entry));
}

function scheduleLaserRender(tabId) {
  const state = ensureLaserState(tabId);
  if (state.rafId) {
    return;
  }
  state.rafId = requestAnimationFrame(() => renderLaserTrail(tabId));
}

function renderLaserTrail(tabId) {
  const dom = getTabDom(tabId);
  const state = laserStates.get(tabId);
  if (!dom.laserCanvas || !state) {
    return;
  }

  state.rafId = null;
  const ctx = dom.laserCanvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const now = performance.now();
  const lastFrameAt = state.lastFrameAt || now;
  state.lastFrameAt = now;
  const delta = clamp(now - lastFrameAt, 8, 48);
  const fadeStrength = clamp((delta / LASER_FADE_MS) * 3.2, 0.05, 0.28);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = `rgba(0, 0, 0, ${fadeStrength})`;
  ctx.fillRect(0, 0, dom.laserCanvas.width, dom.laserCanvas.height);
  ctx.globalCompositeOperation = 'source-over';

  if (!state.isDrawing && now >= state.trailUntil) {
    ctx.clearRect(0, 0, dom.laserCanvas.width, dom.laserCanvas.height);
    state.lastFrameAt = 0;
    return;
  }

  scheduleLaserRender(tabId);
}

function beginLaserTrail(tabId, pointerId, point) {
  const state = ensureLaserState(tabId);
  state.isDrawing = true;
  state.pointerId = pointerId;
  state.lastPoint = point;
  state.lastFrameAt = 0;
  state.trailUntil = performance.now() + LASER_TRAIL_GRACE_MS;
  scheduleLaserRender(tabId);
}

function appendLaserTrail(tabId, pointerId, points) {
  const state = ensureLaserState(tabId);
  if (!state.isDrawing || state.pointerId !== pointerId || !state.lastPoint || !Array.isArray(points) || points.length === 0) {
    return;
  }

  const strokeSize = Math.max(2, appSettings.drawSize + 2);
  const strokeColor = appSettings.drawColor;
  let anchor = state.lastPoint;

  points.forEach((targetPoint) => {
    const dx = targetPoint.x - anchor.x;
    const dy = targetPoint.y - anchor.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.45) {
      return;
    }

    const start = { x: anchor.x, y: anchor.y };
    const steps = Math.min(12, Math.max(1, Math.ceil(distance / 10)));
    let prev = start;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const next = {
        x: start.x + (dx * t),
        y: start.y + (dy * t)
      };
      drawLaserSegment(tabId, prev, next, strokeColor, strokeSize);
      prev = next;
    }
    anchor = targetPoint;
  });

  state.lastPoint = anchor;
  state.trailUntil = performance.now() + LASER_TRAIL_GRACE_MS;
  scheduleLaserRender(tabId);
}

function endLaserTrail(tabId, pointerId) {
  const state = ensureLaserState(tabId);
  if (state.pointerId !== pointerId) {
    return;
  }
  state.isDrawing = false;
  state.pointerId = null;
  state.lastPoint = null;
  state.trailUntil = performance.now() + LASER_TRAIL_GRACE_MS;
  scheduleLaserRender(tabId);
}

function ensureLassoState(tabId) {
  if (!lassoStates.has(tabId)) {
    lassoStates.set(tabId, {
      mode: 'idle',
      points: [],
      selectionCanvas: null,
      selectionX: 0,
      selectionY: 0,
      selectionWidth: 0,
      selectionHeight: 0,
      dragOffsetX: 0,
      dragOffsetY: 0
    });
  }
  return lassoStates.get(tabId);
}

function getCanvasPixelRatio(tabId) {
  const dom = getTabDom(tabId);
  if (!dom.canvas) {
    return window.devicePixelRatio || 1;
  }
  const cssWidth = parseFloat(dom.canvas.style.width) || dom.canvas.clientWidth || 1;
  return dom.canvas.width / Math.max(1, cssWidth);
}

function renderLassoOverlay(tabId) {
  const dom = getTabDom(tabId);
  const state = ensureLassoState(tabId);
  if (!dom.lassoCanvas) {
    return;
  }

  const ctx = dom.lassoCanvas.getContext('2d');
  if (!ctx) {
    return;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, dom.lassoCanvas.width, dom.lassoCanvas.height);

  const dpr = getCanvasPixelRatio(tabId);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (state.selectionCanvas) {
    ctx.drawImage(
      state.selectionCanvas,
      0,
      0,
      state.selectionCanvas.width,
      state.selectionCanvas.height,
      state.selectionX,
      state.selectionY,
      state.selectionWidth,
      state.selectionHeight
    );

    ctx.strokeStyle = 'rgba(59, 130, 246, 0.96)';
    ctx.lineWidth = 1.6;
    ctx.shadowBlur = 8;
    ctx.shadowColor = 'rgba(59, 130, 246, 0.45)';
    ctx.setLineDash([7, 4]);
    ctx.strokeRect(state.selectionX, state.selectionY, state.selectionWidth, state.selectionHeight);
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }

  if (state.mode === 'selecting' && state.points.length > 1) {
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.95)';
    ctx.fillStyle = 'rgba(59, 130, 246, 0.14)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([8, 5]);
    ctx.beginPath();
    state.points.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function commitLassoSelection(tabId, options = {}) {
  const dom = getTabDom(tabId);
  const state = ensureLassoState(tabId);
  if (!dom.canvas || !state.selectionCanvas) {
    state.mode = 'idle';
    state.points = [];
    renderLassoOverlay(tabId);
    return false;
  }

  const dpr = getCanvasPixelRatio(tabId);
  const ctx = dom.canvas.getContext('2d');
  if (!ctx) {
    return false;
  }

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(
    state.selectionCanvas,
    0,
    0,
    state.selectionCanvas.width,
    state.selectionCanvas.height,
    Math.round(state.selectionX * dpr),
    Math.round(state.selectionY * dpr),
    state.selectionCanvas.width,
    state.selectionCanvas.height
  );
  ctx.restore();

  state.mode = 'idle';
  state.points = [];
  state.selectionCanvas = null;
  state.selectionWidth = 0;
  state.selectionHeight = 0;
  renderLassoOverlay(tabId);

  persistDrawingForTab(tabId);
  if (options.markDirty !== false) {
    markDirty();
  }
  return true;
}

function finalizeLassoSelection(tabId, pointerPoint) {
  const dom = getTabDom(tabId);
  const state = ensureLassoState(tabId);
  if (!dom.canvas || state.points.length < 3) {
    state.mode = 'idle';
    state.points = [];
    renderLassoOverlay(tabId);
    return false;
  }

  const dpr = getCanvasPixelRatio(tabId);
  const minX = Math.max(0, Math.min(...state.points.map((p) => p.x)));
  const minY = Math.max(0, Math.min(...state.points.map((p) => p.y)));
  const maxX = Math.max(...state.points.map((p) => p.x));
  const maxY = Math.max(...state.points.map((p) => p.y));

  const pxX = Math.max(0, Math.floor(minX * dpr));
  const pxY = Math.max(0, Math.floor(minY * dpr));
  const pxW = Math.min(dom.canvas.width - pxX, Math.ceil((maxX - minX) * dpr));
  const pxH = Math.min(dom.canvas.height - pxY, Math.ceil((maxY - minY) * dpr));
  if (pxW < 2 || pxH < 2) {
    state.mode = 'idle';
    state.points = [];
    renderLassoOverlay(tabId);
    return false;
  }

  const sourceCtx = dom.canvas.getContext('2d');
  if (!sourceCtx) {
    return false;
  }

  const fragment = sourceCtx.getImageData(pxX, pxY, pxW, pxH);
  const selectionCanvas = document.createElement('canvas');
  selectionCanvas.width = pxW;
  selectionCanvas.height = pxH;
  const selectionCtx = selectionCanvas.getContext('2d');
  if (!selectionCtx) {
    return false;
  }

  selectionCtx.putImageData(fragment, 0, 0);
  selectionCtx.globalCompositeOperation = 'destination-in';
  selectionCtx.beginPath();
  state.points.forEach((point, index) => {
    const x = (point.x * dpr) - pxX;
    const y = (point.y * dpr) - pxY;
    if (index === 0) {
      selectionCtx.moveTo(x, y);
    } else {
      selectionCtx.lineTo(x, y);
    }
  });
  selectionCtx.closePath();
  selectionCtx.fill();

  sourceCtx.save();
  sourceCtx.setTransform(1, 0, 0, 1, 0, 0);
  sourceCtx.beginPath();
  state.points.forEach((point, index) => {
    const x = point.x * dpr;
    const y = point.y * dpr;
    if (index === 0) {
      sourceCtx.moveTo(x, y);
    } else {
      sourceCtx.lineTo(x, y);
    }
  });
  sourceCtx.closePath();
  sourceCtx.clip();
  sourceCtx.clearRect(pxX - 1, pxY - 1, pxW + 2, pxH + 2);
  sourceCtx.restore();

  state.mode = 'selected';
  state.selectionCanvas = selectionCanvas;
  state.selectionX = pxX / dpr;
  state.selectionY = pxY / dpr;
  state.selectionWidth = pxW / dpr;
  state.selectionHeight = pxH / dpr;
  state.dragOffsetX = 0;
  state.dragOffsetY = 0;
  state.points = [];
  renderLassoOverlay(tabId);
  markDirty(false);
  return true;
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
  if (!isCanvasTab(tabId)) {
    return false;
  }

  const isSecondarySplit = appSettings.splitMode && appSettings.splitTabId === tabId && activeTabId !== tabId;
  if (isSecondarySplit) {
    return false;
  }
  if (appSettings.editLocked) {
    return false;
  }
  if (appSettings.activeTool === 'text' || appSettings.activeTool === 'pan') {
    return false;
  }
  return true;
}

function shouldStartPan(event) {
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
  const lassoState = ensureLassoState(tabId);

  const isObjectControlTarget = (event) => {
    if (!(event.target instanceof Element)) {
      return false;
    }
    return Boolean(
      event.target.closest('.canvas-object-handle') ||
      event.target.closest('.canvas-object-remove') ||
      event.target.closest('.canvas-object-resize') ||
      event.target.closest('.canvas-text-content')
    );
  };

  const finishDrawing = (event) => {
    if (!drawingState.isDrawing || drawingState.pointerId !== event.pointerId) {
      return false;
    }

    if (appSettings.activeTool === 'laser') {
      endLaserTrail(tabId, event.pointerId);
      drawingState.isDrawing = false;
      drawingState.pointerId = null;
      drawingState.baseImage = null;
      return true;
    }

    if (appSettings.activeTool === 'lasso') {
      const point = getPointerPointInCanvas(tabId, event);
      if (lassoState.mode === 'selecting') {
        finalizeLassoSelection(tabId, point);
      } else if (lassoState.mode === 'moving') {
        lassoState.mode = 'selected';
        renderLassoOverlay(tabId);
        markDirty(false);
      } else {
        renderLassoOverlay(tabId);
      }
      drawingState.isDrawing = false;
      drawingState.pointerId = null;
      drawingState.baseImage = null;
      return true;
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
    persistDrawingForTab(tabId);
    markDirty();
    return true;
  };

  dom.stage.addEventListener('wheel', (event) => {
    const thicknessWheelTools = new Set(['pen', 'highlighter', 'eraser', 'line', 'arrow', 'rect', 'circle', 'laser']);
    if (isCanvasTab(tabId) && !event.ctrlKey && appSettings.activeTool !== 'pan' && thicknessWheelTools.has(appSettings.activeTool)) {
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      appSettings.drawSize = clamp((Number(appSettings.drawSize) || 6) + direction, 1, 36);
      syncDrawControls();
      markDirty(false);
      return;
    }

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

    maybeAutoExpandCanvasWorld(tabId);
    clampCanvasPanToBounds(tabId);
    applyViewTransform(tabId);
    markDirty(false);
  }, { passive: false });

  dom.stage.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'pen') {
      penPointers.add(event.pointerId);
    }

    if (event.pointerType === 'touch' && penPointers.size > 0) {
      return;
    }

    if (canDrawOnTab(tabId) && !shouldStartPan(event) && !isObjectControlTarget(event)) {
      const point = appSettings.activeTool === 'laser'
        ? getPointerPointInStage(tabId, event)
        : getPointerPointInCanvas(tabId, event);
      const ctx = dom.canvas.getContext('2d');
      configureDrawingContext(ctx, appSettings.activeTool);

      drawingState.isDrawing = true;
      drawingState.pointerId = event.pointerId;
      drawingState.startX = point.x;
      drawingState.startY = point.y;
      drawingState.baseImage = null;

      if (appSettings.activeTool === 'laser') {
        beginLaserTrail(tabId, event.pointerId, point);
      } else if (appSettings.activeTool === 'lasso') {
        const inSelection = Boolean(
          lassoState.selectionCanvas &&
          point.x >= lassoState.selectionX &&
          point.x <= (lassoState.selectionX + lassoState.selectionWidth) &&
          point.y >= lassoState.selectionY &&
          point.y <= (lassoState.selectionY + lassoState.selectionHeight)
        );

        if (inSelection) {
          lassoState.mode = 'moving';
          lassoState.dragOffsetX = point.x - lassoState.selectionX;
          lassoState.dragOffsetY = point.y - lassoState.selectionY;
        } else {
          if (lassoState.selectionCanvas) {
            commitLassoSelection(tabId, { markDirty: true });
          }
          lassoState.mode = 'selecting';
          lassoState.points = [point];
        }
        renderLassoOverlay(tabId);
      } else if (appSettings.activeTool === 'pen' || appSettings.activeTool === 'highlighter' || appSettings.activeTool === 'eraser') {
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
      } else {
        drawingState.baseImage = ctx.getImageData(0, 0, dom.canvas.width, dom.canvas.height);
      }

      dom.stage.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    if (event.target instanceof Element && event.target.closest('.canvas-object')) {
      return;
    }

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
    if (drawingState.isDrawing && drawingState.pointerId === event.pointerId) {
      const point = appSettings.activeTool === 'laser'
        ? getPointerPointInStage(tabId, event)
        : getPointerPointInCanvas(tabId, event);
      const ctx = dom.canvas.getContext('2d');
      configureDrawingContext(ctx, appSettings.activeTool);

      if (appSettings.activeTool === 'laser') {
        const laserPoints = getLaserPointerPoints(tabId, event);
        appendLaserTrail(tabId, event.pointerId, laserPoints);
      } else if (appSettings.activeTool === 'lasso') {
        if (lassoState.mode === 'selecting') {
          const lastPoint = lassoState.points[lassoState.points.length - 1];
          if (!lastPoint || Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) >= LASSO_POINT_MIN_DISTANCE) {
            lassoState.points.push(point);
            renderLassoOverlay(tabId);
          }
        } else if (lassoState.mode === 'moving' && lassoState.selectionCanvas) {
          lassoState.selectionX = point.x - lassoState.dragOffsetX;
          lassoState.selectionY = point.y - lassoState.dragOffsetY;
          renderLassoOverlay(tabId);
        }
      } else if (appSettings.activeTool === 'pen' || appSettings.activeTool === 'highlighter' || appSettings.activeTool === 'eraser') {
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
      } else if (drawingState.baseImage) {
        ctx.putImageData(drawingState.baseImage, 0, 0);
        drawShape(ctx, appSettings.activeTool, drawingState.startX, drawingState.startY, point.x, point.y);
      }
      event.preventDefault();
      return;
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
      maybeAutoExpandCanvasWorld(tabId);
      clampCanvasPanToBounds(tabId);
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
    maybeAutoExpandCanvasWorld(tabId);
    clampCanvasPanToBounds(tabId);
    applyViewTransform(tabId);
    markDirty(false);
  });

  const endPan = (event) => {
    if (event.pointerType === 'pen') {
      penPointers.delete(event.pointerId);
    }

    if (finishDrawing(event)) {
      try {
        dom.stage.releasePointerCapture(event.pointerId);
      } catch (error) {
        // Ignore pointer capture release errors.
      }
      return;
    }

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
}

function applyViewTransform(tabId) {
  const tabData = tabs.get(tabId);
  const dom = getTabDom(tabId);
  if (!tabData || !dom.transform) {
    return;
  }
  if (isCanvasTab(tabId)) {
    clampCanvasPanToBounds(tabId);
  }
  dom.transform.style.transform = `translate(${tabData.viewState.panX}px, ${tabData.viewState.panY}px) scale(${tabData.viewState.scale})`;
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

  const opacity = clamp(appSettings.maskRevealPercent, 80, 100) / 100;
  dom.maskOverlay.classList.add('active');
  dom.maskOverlay.style.top = '0';
  dom.maskOverlay.style.height = '100%';
  dom.maskOverlay.style.opacity = String(opacity);
}

function updateAllOverlays() {
  tabs.forEach((_, tabId) => {
    updateMaskOverlay(tabId);
  });
}

function applyInteractionStateToTab(tabId) {
  const dom = getTabDom(tabId);
  const tabData = tabs.get(tabId);
  if (!dom.chalkboard || !dom.canvas || !tabData) {
    return;
  }

  const canvasTab = tabData.kind === 'canvas';
  const isSecondarySplit = appSettings.splitMode && appSettings.splitTabId === tabId && activeTabId !== tabId;
  const canEdit = !appSettings.editLocked && !isSecondarySplit;
  const canEditText = canEdit && !canvasTab;
  const canInteractCanvasObjects = canvasTab && canEdit;

  dom.chalkboard.contentEditable = canEditText ? 'true' : 'false';
  dom.chalkboard.classList.toggle('locked', !canEditText);
  dom.chalkboard.style.pointerEvents = canvasTab ? 'none' : 'auto';

  dom.canvas.style.pointerEvents = 'none';

  if (dom.objectLayer) {
    dom.objectLayer.classList.toggle('interactive', canInteractCanvasObjects);
    dom.objectLayer.querySelectorAll('.canvas-text-content').forEach((textbox) => {
      textbox.contentEditable = canEdit ? 'true' : 'false';
    });
  }

  dom.stage.classList.remove('stage-frozen');
  applyViewTransform(tabId);
  updateMaskOverlay(tabId);
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

  document.addEventListener('paste', (event) => {
    if (!activeTabId || appSettings.editLocked) {
      return;
    }
    if (!isCanvasTab(activeTabId)) {
      return;
    }

    const activeElement = document.activeElement;
    if (activeElement && activeElement.closest && activeElement.closest('.canvas-text-content')) {
      return;
    }

    if (handleCanvasClipboardPayload(activeTabId, event.clipboardData)) {
      event.preventDefault();
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
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.isContentEditable
    );
    const isInputControl = activeElement && (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'SELECT' ||
      activeElement.tagName === 'TEXTAREA'
    );
    const primaryModifier = event.ctrlKey || event.metaKey;

    if (event.key === ' ' && !isTypingField) {
      isSpacePressed = true;
    }

    if (primaryModifier && event.key.toLowerCase() === 'z' && !isInputControl) {
      event.preventDefault();
      if (event.shiftKey) {
        redoLastUndo();
      } else {
        undoLastChange();
      }
      return;
    }

    if (primaryModifier && event.key === 's') {
      event.preventDefault();
      const saveButton = document.getElementById('saveButton');
      handleManualSaveClick(saveButton);
      return;
    }

    if (primaryModifier && event.key === 'Tab') {
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

    if (primaryModifier && (event.key === '=' || event.key === '+')) {
      event.preventDefault();
      adjustActiveFontSize(1);
      return;
    }

    if (primaryModifier && event.key === '-') {
      event.preventDefault();
      adjustActiveFontSize(-1);
      return;
    }

    if (primaryModifier && event.shiftKey && (event.key === '>' || event.key === '.')) {
      event.preventDefault();
      adjustActiveFontSize(1);
      return;
    }

    if (primaryModifier && event.shiftKey && (event.key === '<' || event.key === ',')) {
      event.preventDefault();
      adjustActiveFontSize(-1);
      return;
    }

    if (!isTypingField && TOOL_KEYPAD_SHORTCUTS[event.code]) {
      if (!activeTabId || !isCanvasTab(activeTabId)) {
        return;
      }
      const tool = TOOL_KEYPAD_SHORTCUTS[event.code];
      setActiveTool(tool, { markDirty: false });
      event.preventDefault();
      return;
    }

    if (primaryModifier && !event.shiftKey && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      toggleSetting('editLocked');
      return;
    }

    if (primaryModifier && event.shiftKey && event.key.toLowerCase() === 'm') {
      event.preventDefault();
      toggleSetting('maskEnabled');
      return;
    }

    if (primaryModifier && event.shiftKey && event.key.toLowerCase() === 'v') {
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
  resetUndoHistory();
  pushUndoCheckpoint();

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
