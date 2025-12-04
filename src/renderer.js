// Simplified Chalkboard Renderer with Standard Text Formatting

// Global variables
let tabs = new Map();
let activeTabId = 'tab-1';
let tabCounter = 1;
let textFormatter = new SimpleTextFormatter();
let storedSelection = null; // Store text selection before toolbar interactions

// Selection preservation functions
function saveSelection() {
  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    storedSelection = {
      startContainer: range.startContainer,
      startOffset: range.startOffset,
      endContainer: range.endContainer,
      endOffset: range.endOffset,
      collapsed: range.collapsed
    };
    console.log('?뮶 Selection saved:', storedSelection);
  }
}

function restoreSelection() {
  if (storedSelection && storedSelection.startContainer) {
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(storedSelection.startContainer, storedSelection.startOffset);
      range.setEnd(storedSelection.endContainer, storedSelection.endOffset);
      
      selection.removeAllRanges();
      selection.addRange(range);
      
      console.log('?봽 Selection restored:', {
        selectedText: selection.toString(),
        collapsed: range.collapsed
      });
      
      return true;
    } catch (error) {
      console.error('??Failed to restore selection:', error);
      storedSelection = null;
      return false;
    }
  }
  return false;
}

// Tab Data Structure
class TabData {
  constructor(id, title) {
    this.id = id;
    this.title = title;
    this.content = '';
    this.formatState = {
      fontSize: 72,
      color: '#ffffff',
      fontWeight: 'normal',
      fontStyle: 'normal',
      textDecoration: 'none'
    };
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  console.log('?뱥 移좏뙋 ???쒖옉');

  // Load saved data first; if none exists, create the initial tab
  loadAllTabsData().then((loaded) => {
    if (!loaded) {
      createTab('\uCE60\uD310 1');
    }
  });

  // Setup window controls
  setupWindowControls();

  // Setup sidebar
  setupSidebar();

  // Setup save before quit listener
  if (window.electronAPI && window.electronAPI.onSaveBeforeQuit) {
    window.electronAPI.onSaveBeforeQuit(() => {
      console.log('Save-before-quit request received');

      if (activeTabId) {
        saveTabContent(activeTabId);
      }

      saveAllTabsData();
      saveTimetable();

      console.log('Save-before-quit flow completed');
    });
  }

  console.log('??移좏뙋 ??珥덇린???꾨즺');
});

// Window Controls
function setupWindowControls() {
  const alwaysOnTopButton = document.getElementById('alwaysOnTopButton');
  const minimizeButton = document.getElementById('minimizeButton');
  const maximizeButton = document.getElementById('maximizeButton');
  const closeButton = document.getElementById('closeButton');
  const addTabButton = document.getElementById('addTabButton');
  const saveButton = document.getElementById('saveButton');

  // Always on top toggle
  let isAlwaysOnTop = false;
  
  if (alwaysOnTopButton) {
    alwaysOnTopButton.addEventListener('click', () => {
      if (window.electronAPI) {
        isAlwaysOnTop = !isAlwaysOnTop;
        window.electronAPI.setAlwaysOnTop(isAlwaysOnTop);
        
        // Update button appearance
        alwaysOnTopButton.classList.toggle('active', isAlwaysOnTop);
        alwaysOnTopButton.title = isAlwaysOnTop ? '??긽 ?꾩뿉 (?쒖꽦)' : '??긽 ?꾩뿉';
        
        console.log('Always on top:', isAlwaysOnTop);
      }
    });
  }

  if (minimizeButton) {
    minimizeButton.addEventListener('click', () => {
      if (window.electronAPI) {
        window.electronAPI.minimizeWindow();
      }
    });
  }

  if (maximizeButton) {
    maximizeButton.addEventListener('click', () => {
      if (window.electronAPI) {
        window.electronAPI.maximizeWindow();
      }
    });
  }

  if (closeButton) {
    closeButton.addEventListener('click', () => {
      if (window.electronAPI) {
        window.electronAPI.closeWindow();
      }
    });
  }

  if (addTabButton) {
    addTabButton.addEventListener('click', () => {
      createTab(`칠판 ${tabCounter + 1}`);
    });
  }

  if (saveButton) {
    saveButton.addEventListener('click', async () => {
      await handleManualSaveClick(saveButton);
    });
  }
}
// Manual Save Handling
function captureAllTabContents() {
  const chalkboards = document.querySelectorAll('.chalkboard');

  chalkboards.forEach(chalkboard => {
    const tabId = chalkboard.dataset.tabId;
    if (!tabId) {
      return;
    }

    const tabData = tabs.get(tabId);
    if (tabData) {
      tabData.content = chalkboard.innerHTML;
    }
  });
}

async function performManualSave() {
  captureAllTabContents();
  await saveAllTabsData();
  await saveTimetable();
  console.log('수동 저장 완료');
}

async function handleManualSaveClick(buttonElement) {
  if (!buttonElement || buttonElement.dataset.state === 'saving') {
    return;
  }

  if (!buttonElement.dataset.defaultHtml) {
    buttonElement.dataset.defaultHtml = buttonElement.innerHTML;
  }

  const defaultHtml = buttonElement.dataset.defaultHtml;
  const savingLabel = '저장중...';
  const successLabel = '저장 완료';
  const errorLabel = '저장 실패';

  buttonElement.blur();
  buttonElement.disabled = true;
  buttonElement.dataset.state = 'saving';
  buttonElement.textContent = savingLabel;

  let resultState = 'success';

  try {
    await performManualSave();
  } catch (error) {
    resultState = 'error';
    console.error('수동 저장 실패:', error);
  }

  if (resultState === 'success') {
    buttonElement.dataset.state = 'success';
    buttonElement.textContent = successLabel;
  } else {
    buttonElement.dataset.state = 'error';
    buttonElement.textContent = errorLabel;
  }

  const revertDelay = resultState === 'error' ? 2000 : 1200;

  setTimeout(() => {
    buttonElement.dataset.state = '';
    buttonElement.innerHTML = defaultHtml;
    buttonElement.disabled = false;
  }, revertDelay);
}
// Tab Management
function createTab(title) {
  tabCounter++;
  const tabId = `tab-${tabCounter}`;
  const tabData = new TabData(tabId, title);
  
  tabs.set(tabId, tabData);
  
  // Create tab element
  createTabElement(tabId, title);
  
  // Create tab content
  createTabContent(tabId);
  
  // Switch to new tab
  switchToTab(tabId);
  
  // Save data
  saveAllTabsData();
  
  return tabId;
}

function createTabElement(tabId, title) {
  const tabsWrapper = document.querySelector('.tabs-wrapper');
  
  const tabElement = document.createElement('div');
  tabElement.className = 'tab';
  tabElement.dataset.tabId = tabId;
  
  tabElement.innerHTML = `
    <span class="tab-title">${title}</span>
    <button class="tab-close" onclick="closeTab('${tabId}')">&times;</button>
  `;
  
  tabElement.addEventListener('click', (e) => {
    if (!e.target.classList.contains('tab-close')) {
      switchToTab(tabId);
    }
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
        <button id="boldBtn" class="format-btn" title="援듦쾶 (Ctrl+B)">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"></path>
            <path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"></path>
          </svg>
        </button>
        <button id="italicBtn" class="format-btn" title="湲곗슱??(Ctrl+I)">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="19" y1="4" x2="10" y2="4"></line>
            <line x1="14" y1="20" x2="5" y2="20"></line>
            <line x1="15" y1="4" x2="9" y2="20"></line>
          </svg>
        </button>
        <button id="underlineBtn" class="format-btn" title="諛묒쨪 (Ctrl+U)">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"></path>
            <line x1="4" y1="21" x2="20" y2="21"></line>
          </svg>
        </button>
      </div>
      <div class="divider"></div>
      <div class="color-picker-container">
        <button id="colorButton" class="color-button" title="湲???됱긽">
          <div class="color-preview" style="background-color: #ffffff;"></div>
        </button>
        <div class="predefined-colors">
          <div class="color-swatch" style="background-color: #ffffff;" data-color="#ffffff" title="?섏???></div>
          <div class="color-swatch" style="background-color: #f87171;" data-color="#f87171" title="鍮④컙??></div>
          <div class="color-swatch" style="background-color: #fbbf24;" data-color="#fbbf24" title="?몃???></div>
          <div class="color-swatch" style="background-color: #34d399;" data-color="#34d399" title="珥덈줉??></div>
          <div class="color-swatch" style="background-color: #60a5fa;" data-color="#60a5fa" title="?뚮???></div>
          <div class="color-swatch" style="background-color: #a78bfa;" data-color="#a78bfa" title="蹂대씪??></div>
          <div class="color-swatch" style="background-color: #f472b6;" data-color="#f472b6" title="遺꾪솉??></div>
          <div class="color-more" title="??留롮? ?됱긽">
            <input type="color" id="colorPicker" value="#ffffff" style="opacity: 0; position: absolute; width: 1px; height: 1px; left: -1000px;">
            ?붾낫湲?          </div>
        </div>
      </div>
      <div class="divider"></div>
      <div class="font-size-control">
        <label for="fontSizeInput" class="font-size-label">?ш린:</label>
        <div class="font-size-input-group">
          <input type="number" id="fontSizeInput" class="font-size-input" 
                 value="72" min="8" max="200" title="湲???ш린">
          <div class="font-size-stepper">
            <button id="fontSizeDown" class="font-size-step-btn" title="?ш린 媛먯냼">-</button>
            <button id="fontSizeUp" class="font-size-step-btn" title="?ш린 利앷?">+</button>
          </div>
        </div>
        <select id="fontSizeSelect" class="font-size-select" title="誘몃━ ?뺤쓽???ш린">
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
          <option value="96">96px</option>
          <option value="120">120px</option>
          <option value="144">144px</option>
        </select>
      </div>
    </div>
    <div class="chalkboard" contenteditable="true" data-tab-id="${tabId}">
    </div>
  `;
  
  tabContents.appendChild(contentElement);
  
  // Setup event listeners for this tab
  setupTabEventListeners(tabId);
}

function setupTabEventListeners(tabId) {
  const toolbar = document.querySelector(`.toolbar[data-tab-id="${tabId}"]`);
  const chalkboard = document.querySelector(`.chalkboard[data-tab-id="${tabId}"]`);
  
  if (!toolbar || !chalkboard) return;
  
  // Format buttons
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
  const colorSwatches = toolbar.querySelectorAll('.color-swatch');
  const colorMore = toolbar.querySelector('.color-more');
  
  // Bold button - preserve selection
  boldBtn.addEventListener('mouseenter', () => {
    saveSelection();
  });
  
  boldBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    restoreSelection();
    textFormatter.toggleFormat(chalkboard, 'fontWeight');
    updateToolbarState(tabId);
  });
  
  // Italic button - preserve selection  
  italicBtn.addEventListener('mouseenter', () => {
    saveSelection();
  });
  
  italicBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    restoreSelection();
    textFormatter.toggleFormat(chalkboard, 'fontStyle');
    updateToolbarState(tabId);
  });
  
  // Underline button - preserve selection
  underlineBtn.addEventListener('mouseenter', () => {
    saveSelection();
  });
  
  underlineBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    restoreSelection();
    textFormatter.toggleFormat(chalkboard, 'textDecoration');
    updateToolbarState(tabId);
  });
  
  // Color button - toggle predefined colors
  colorButton.addEventListener('click', () => {
    const predefinedColors = toolbar.querySelector('.predefined-colors');
    predefinedColors.classList.toggle('show');
  });
  
  // Color swatches - save selection before click, restore after
  colorSwatches.forEach(swatch => {
    // Save selection on mouse enter (when hovering over swatch)
    swatch.addEventListener('mouseenter', () => {
      saveSelection();
    });
    
    swatch.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Prevent losing selection
      
      const color = swatch.dataset.color;
      
      // Debug logging
      const selection = window.getSelection();
      console.log('?렓 Color swatch mousedown:', color);
      console.log('?렞 Current selection info:', {
        rangeCount: selection.rangeCount,
        isCollapsed: selection.rangeCount > 0 ? selection.getRangeAt(0).collapsed : 'no range',
        selectedText: selection.toString(),
        anchorNode: selection.anchorNode,
        focusNode: selection.focusNode
      });
      
      // Restore the saved selection before applying color
      const restored = restoreSelection();
      console.log('??Selection restoration result:', restored);
      
      colorPicker.value = color;
      colorPreview.style.backgroundColor = color;
      textFormatter.setColor(chalkboard, color);
      updateToolbarState(tabId);
      // Hide the predefined colors popup after selection
      const predefinedColors = toolbar.querySelector('.predefined-colors');
      predefinedColors.classList.remove('show');
    });
  });

  // More colors option
  colorMore.addEventListener('click', () => {
    colorPicker.click(); // Trigger the hidden color picker
  });

  // Hidden color picker for custom colors
  colorPicker.addEventListener('input', (e) => {
    const color = e.target.value;
    
    // Debug logging
    const selection = window.getSelection();
    console.log('?렓 Custom color picker changed:', color);
    console.log('?렞 Current selection info:', {
      rangeCount: selection.rangeCount,
      isCollapsed: selection.rangeCount > 0 ? selection.getRangeAt(0).collapsed : 'no range',
      selectedText: selection.toString(),
      anchorNode: selection.anchorNode,
      focusNode: selection.focusNode
    });
    
    // Restore the saved selection before applying color
    const restored = restoreSelection();
    console.log('??Selection restoration result:', restored);
    
    colorPreview.style.backgroundColor = color;
    textFormatter.setColor(chalkboard, color);
    updateToolbarState(tabId);
    // Hide the predefined colors popup after selection
    const predefinedColors = toolbar.querySelector('.predefined-colors');
    predefinedColors.classList.remove('show');
  });
  
  // Font size input
  fontSizeInput.addEventListener('input', (e) => {
    const fontSize = parseInt(e.target.value);
    if (fontSize >= 8 && fontSize <= 200) {
      textFormatter.setFontSize(chalkboard, fontSize);
      fontSizeSelect.value = fontSizeSelect.querySelector(`option[value="${fontSize}"]`) ? fontSize : '';
      updateToolbarState(tabId);
    }
  });
  
  // Font size select
  fontSizeSelect.addEventListener('change', (e) => {
    const fontSize = parseInt(e.target.value);
    fontSizeInput.value = fontSize;
    textFormatter.setFontSize(chalkboard, fontSize);
    updateToolbarState(tabId);
  });
  
  // Font size buttons - preserve selection like color swatches
  fontSizeUp.addEventListener('mouseenter', () => {
    saveSelection();
  });
  
  fontSizeUp.addEventListener('mousedown', (e) => {
    e.preventDefault();
    restoreSelection();
    
    const currentSize = parseInt(fontSizeInput.value) || 72;
    const newSize = Math.min(currentSize + 2, 200);
    fontSizeInput.value = newSize;
    textFormatter.setFontSize(chalkboard, newSize);
    updateToolbarState(tabId);
  });
  
  fontSizeDown.addEventListener('mouseenter', () => {
    saveSelection();
  });
  
  fontSizeDown.addEventListener('mousedown', (e) => {
    e.preventDefault();
    restoreSelection();
    
    const currentSize = parseInt(fontSizeInput.value) || 72;
    const newSize = Math.max(currentSize - 2, 8);
    fontSizeInput.value = newSize;
    textFormatter.setFontSize(chalkboard, newSize);
    updateToolbarState(tabId);
  });
  
  // Chalkboard events
  chalkboard.addEventListener('input', (e) => {
    textFormatter.handleInput(e);
    saveTabContent(tabId);
  });
  
  // Korean IME composition events
  chalkboard.addEventListener('compositionstart', (e) => {
    textFormatter.handleCompositionStart(e);
  });
  
  chalkboard.addEventListener('compositionupdate', (e) => {
    textFormatter.handleCompositionUpdate(e);
  });
  
  chalkboard.addEventListener('compositionend', (e) => {
    textFormatter.handleCompositionEnd(e);
    saveTabContent(tabId);
  });
  
  chalkboard.addEventListener('keyup', () => {
    updateToolbarState(tabId);
  });
  
  chalkboard.addEventListener('mouseup', () => {
    updateToolbarState(tabId);
  });
  
  // Keyboard shortcuts
  chalkboard.addEventListener('keydown', (e) => {
    if (e.ctrlKey) {
      switch (e.key) {
        case 'b':
          e.preventDefault();
          textFormatter.toggleFormat(chalkboard, 'fontWeight');
          updateToolbarState(tabId);
          break;
        case 'i':
          e.preventDefault();
          textFormatter.toggleFormat(chalkboard, 'fontStyle');
          updateToolbarState(tabId);
          break;
        case 'u':
          e.preventDefault();
          textFormatter.toggleFormat(chalkboard, 'textDecoration');
          updateToolbarState(tabId);
          break;
      }
    }
  });
  
  // Close color picker when clicking outside
  const colorPickerContainer = toolbar.querySelector('.color-picker-container');
  document.addEventListener('click', (e) => {
    if (!colorPickerContainer.contains(e.target)) {
      const predefinedColors = toolbar.querySelector('.predefined-colors');
      predefinedColors.classList.remove('show');
    }
  });

  // Debug: Add selection change listener
  document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      console.log('?뱧 Selection changed:', {
        selectedText: selection.toString(),
        rangeCount: selection.rangeCount,
        collapsed: range.collapsed,
        startContainer: range.startContainer,
        endContainer: range.endContainer
      });
    }
  });
}

function updateToolbarState(tabId) {
  const toolbar = document.querySelector(`.toolbar[data-tab-id="${tabId}"]`);
  const chalkboard = document.querySelector(`.chalkboard[data-tab-id="${tabId}"]`);
  
  if (!toolbar || !chalkboard) return;
  
  // Get current format at cursor position
  const currentFormat = textFormatter.getCurrentFormat(chalkboard);
  
  // Update buttons
  const boldBtn = toolbar.querySelector('#boldBtn');
  const italicBtn = toolbar.querySelector('#italicBtn');
  const underlineBtn = toolbar.querySelector('#underlineBtn');
  const colorPicker = toolbar.querySelector('#colorPicker');
  const colorPreview = toolbar.querySelector('.color-preview');
  const fontSizeInput = toolbar.querySelector('#fontSizeInput');
  const fontSizeSelect = toolbar.querySelector('#fontSizeSelect');
  
  // Update button states
  boldBtn.classList.toggle('active', currentFormat.fontWeight === 'bold');
  italicBtn.classList.toggle('active', currentFormat.fontStyle === 'italic');
  underlineBtn.classList.toggle('active', currentFormat.textDecoration === 'underline');
  
  // Update color picker and preview
  colorPicker.value = currentFormat.color;
  if (colorPreview) {
    colorPreview.style.backgroundColor = currentFormat.color;
  }
  
  // Update font size controls
  fontSizeInput.value = currentFormat.fontSize;
  const sizeOption = fontSizeSelect.querySelector(`option[value="${currentFormat.fontSize}"]`);
  fontSizeSelect.value = sizeOption ? currentFormat.fontSize : '';
  
  // Update tab format state
  const tabData = tabs.get(tabId);
  if (tabData) {
    Object.assign(tabData.formatState, currentFormat);
  }
}

function switchToTab(tabId) {
  // Update active tab ID
  activeTabId = tabId;
  
  // Update tab visual states
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tabId === tabId);
  });
  
  // Update content visibility
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.dataset.tabId === tabId);
  });
  
  // Focus on chalkboard
  const chalkboard = document.querySelector(`.chalkboard[data-tab-id="${tabId}"]`);
  if (chalkboard) {
    setTimeout(() => chalkboard.focus(), 100);
  }
  
  // Update toolbar state
  updateToolbarState(tabId);
}

function closeTab(tabId) {
  if (tabs.size <= 1) return; // Don't close last tab
  
  // Remove tab data
  tabs.delete(tabId);
  
  // Remove DOM elements
  document.querySelector(`.tab[data-tab-id="${tabId}"]`).remove();
  document.querySelector(`.tab-content[data-tab-id="${tabId}"]`).remove();
  
  // Switch to another tab if this was active
  if (activeTabId === tabId) {
    const remainingTabId = tabs.keys().next().value;
    switchToTab(remainingTabId);
  }
  
  // Save data
  saveAllTabsData();
}

// Content Management
function saveTabContent(tabId) {
  const chalkboard = document.querySelector(`.chalkboard[data-tab-id="${tabId}"]`);
  const tabData = tabs.get(tabId);
  
  if (chalkboard && tabData) {
    tabData.content = chalkboard.innerHTML;
    saveAllTabsData();
  }
}

function loadTabContent(tabId) {
  const chalkboard = document.querySelector(`.chalkboard[data-tab-id="${tabId}"]`);
  const tabData = tabs.get(tabId);
  
  if (chalkboard && tabData) {
    chalkboard.innerHTML = tabData.content;
    
    // Apply tab format state to chalkboard
    if (tabData.formatState) {
      chalkboard.style.fontSize = `${tabData.formatState.fontSize}px`;
      chalkboard.style.color = tabData.formatState.color;
      
      // Update text formatter current format
      Object.assign(textFormatter.currentFormat, tabData.formatState);
      chalkboard.dataset.currentFormat = JSON.stringify(tabData.formatState);
    }
  }
}

// Data Persistence
async function saveAllTabsData() {
  const tabsData = {};
  tabs.forEach((tabData, tabId) => {
    tabsData[tabId] = {
      id: tabData.id,
      title: tabData.title,
      content: tabData.content,
      formatState: tabData.formatState
    };
  });
  
  const dataToSave = {
    tabs: tabsData,
    activeTabId: activeTabId,
    tabCounter: tabCounter
  };
  
  console.log('?봽 ??ν븷 ?곗씠??', { tabCount: Object.keys(tabsData).length, activeTabId, tabCounter });
  
  try {
    // Electron ?섍꼍?먯꽌 ?뚯씪 湲곕컲 ????ъ슜, ?쇰컲 釉뚮씪?곗??먯꽌??localStorage ?ъ슜
    if (window.storageAPI) {
      const success = await window.storageAPI.setItem('chalkboard-data', JSON.stringify(dataToSave));
      if (success) {
        console.log('??移좏뙋 ?곗씠??????깃났 (?뚯씪 ?쒖뒪??');
      } else {
        console.error('??移좏뙋 ?곗씠??????ㅽ뙣');
        // Fallback to localStorage if file system fails
        localStorage.setItem('chalkboard-data', JSON.stringify(dataToSave));
        console.log('?봽 localStorage濡?fallback ????꾨즺');
      }
    } else {
      localStorage.setItem('chalkboard-data', JSON.stringify(dataToSave));
      console.log('??移좏뙋 ?곗씠??????깃났 (localStorage)');
    }
  } catch (error) {
    console.error('??移좏뙋 ?곗씠??????ㅻ쪟:', error);
    // Emergency fallback to localStorage
    try {
      localStorage.setItem('chalkboard-data', JSON.stringify(dataToSave));
      console.log('?넊 湲닿툒 localStorage ????꾨즺');
    } catch (fallbackError) {
      console.error('??湲닿툒 ??λ룄 ?ㅽ뙣:', fallbackError);
    }
  }
}

async function loadAllTabsData() {
  try {
    let savedData = null;
    
    // Prefer file storage via Electron; fall back to localStorage in browsers
    if (window.storageAPI) {
      savedData = await window.storageAPI.getItem('chalkboard-data');
      console.log('Chalkboard load attempt (file storage)');
    } else {
      savedData = localStorage.getItem('chalkboard-data');
      console.log('Chalkboard load attempt (localStorage)');
    }
    
    if (!savedData) {
      console.log('No saved chalkboard data found');
      return false;
    }
    
    const data = JSON.parse(savedData);
    console.log('Loaded chalkboard data', data);
    
    if (data.tabs && Object.keys(data.tabs).length > 0) {
      // Clear existing tabs
      tabs.clear();
      document.querySelector('.tabs-wrapper').innerHTML = '';
      document.getElementById('tabContents').innerHTML = '';
      
      // Load tabs
      tabCounter = data.tabCounter || 1;
      
      Object.values(data.tabs).forEach(tabObj => {
        const tabData = new TabData(tabObj.id, tabObj.title);
        tabData.content = tabObj.content || '';
        tabData.formatState = tabObj.formatState || {
          fontSize: 72,
          color: '#ffffff',
          fontWeight: 'normal',
          fontStyle: 'normal',
          textDecoration: 'none'
        };
        
        tabs.set(tabObj.id, tabData);
        createTabElement(tabObj.id, tabObj.title);
        createTabContent(tabObj.id);
        loadTabContent(tabObj.id);
      });
      
      // Switch to active tab
      const targetTabId = data.activeTabId || Object.keys(data.tabs)[0];
      switchToTab(targetTabId);
      console.log('Chalkboard data load success');
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Chalkboard data load error:', error);
    return false;
  }
}

// Sidebar Management
function setupSidebar() {
  loadTimetable();
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('open');
}

function addTimetableItem() {
  const timetableList = document.getElementById('timetableList');
  const itemNumber = timetableList.children.length + 1;
  
  const itemDiv = document.createElement('div');
  itemDiv.className = 'timetable-item';
  itemDiv.innerHTML = `
    <div class="timetable-number">${itemNumber}</div>
    <input type="text" class="timetable-subject" placeholder="怨쇰ぉ紐낆쓣 ?낅젰?섏꽭??>
    <input type="checkbox" class="timetable-checkbox">
  `;
  
  timetableList.appendChild(itemDiv);
  saveTimetable();
  
  // Focus on the new input
  const newInput = itemDiv.querySelector('.timetable-subject');
  newInput.focus();
}

function clearChecked() {
  const timetableList = document.getElementById('timetableList');
  const items = [...timetableList.children];
  
  items.forEach(item => {
    const checkbox = item.querySelector('.timetable-checkbox');
    if (checkbox.checked) {
      item.remove();
    }
  });
  
  // Renumber remaining items
  [...timetableList.children].forEach((item, index) => {
    const numberElement = item.querySelector('.timetable-number');
    numberElement.textContent = index + 1;
  });
  
  saveTimetable();
}

async function saveTimetable() {
  const timetableList = document.getElementById('timetableList');
  const items = [...timetableList.children].map(item => {
    return {
      subject: item.querySelector('.timetable-subject').value,
      checked: item.querySelector('.timetable-checkbox').checked
    };
  });
  
  try {
    // Electron ?섍꼍?먯꽌 ?뚯씪 湲곕컲 ????ъ슜, ?쇰컲 釉뚮씪?곗??먯꽌??localStorage ?ъ슜
    if (window.storageAPI) {
      const success = await window.storageAPI.setItem('timetable-data', JSON.stringify(items));
      if (success) {
        console.log('???쒓컙???곗씠??????깃났 (?뚯씪 ?쒖뒪??');
      } else {
        console.error('???쒓컙???곗씠??????ㅽ뙣');
      }
    } else {
      localStorage.setItem('timetable-data', JSON.stringify(items));
      console.log('???쒓컙???곗씠??????깃났 (localStorage)');
    }
  } catch (error) {
    console.error('???쒓컙???곗씠??????ㅻ쪟:', error);
  }
}

async function loadTimetable() {
  try {
    let savedData = null;
    
    // Electron ?섍꼍?먯꽌 ?뚯씪 湲곕컲 濡쒕뱶 ?ъ슜, ?쇰컲 釉뚮씪?곗??먯꽌??localStorage ?ъ슜
    if (window.storageAPI) {
      savedData = await window.storageAPI.getItem('timetable-data');
      console.log('?봽 ?쒓컙???곗씠??濡쒕뱶 ?쒕룄 (?뚯씪 ?쒖뒪??');
    } else {
      savedData = localStorage.getItem('timetable-data');
      console.log('?봽 ?쒓컙???곗씠??濡쒕뱶 ?쒕룄 (localStorage)');
    }
    
    if (!savedData) {
      console.log('?뮶 ??λ맂 ?쒓컙???곗씠???놁쓬');
      return;
    }
    
    const items = JSON.parse(savedData);
    const timetableList = document.getElementById('timetableList');
    
    items.forEach((item, index) => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'timetable-item';
      itemDiv.innerHTML = `
        <div class="timetable-number">${index + 1}</div>
        <input type="text" class="timetable-subject" value="${item.subject}" placeholder="怨쇰ぉ紐낆쓣 ?낅젰?섏꽭??>
        <input type="checkbox" class="timetable-checkbox" ${item.checked ? 'checked' : ''}>
      `;
      
      // Add event listeners
      const subjectInput = itemDiv.querySelector('.timetable-subject');
      const checkbox = itemDiv.querySelector('.timetable-checkbox');
      
      subjectInput.addEventListener('input', saveTimetable);
      checkbox.addEventListener('change', saveTimetable);
      
      timetableList.appendChild(itemDiv);
    });
    console.log('???쒓컙???곗씠??濡쒕뱶 ?깃났');
  } catch (error) {
    console.error('???쒓컙???곗씠??濡쒕뱶 ?ㅻ쪟:', error);
  }
}
