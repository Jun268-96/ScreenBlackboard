// 탭 관리 변수
let tabs = new Map(); // 탭 ID와 탭 데이터를 저장
let activeTabId = 'tab-1';
let tabCounter = 1;

// 탭 데이터 구조 - 개선된 포맷 상태 추가
class TabData {
  constructor(id, title) {
    this.id = id;
    this.title = title;
    this.content = '';
    this.formatState = {
      bold: false,
      italic: false,
      underline: false,
      fontSize: 72,
      color: '#ffffff'
    };
  }
}

// 텍스트 스타일 관리자 클래스 - 새로운 시스템
class TextStyleManager {
  constructor() {
    this.defaultStyles = {
      fontSize: 72,
      lineHeight: 1.3,
      color: '#ffffff'
    };
  }

  // 글자 크기에 따른 최적의 줄 간격 계산
  calculateOptimalLineHeight(fontSize) {
    const size = parseInt(fontSize);
    if (size <= 16) return 1.6;
    if (size <= 24) return 1.5;
    if (size <= 36) return 1.4;
    if (size <= 48) return 1.35;
    if (size <= 72) return 1.3;
    if (size <= 96) return 1.25;
    return 1.2;
  }

  // 통합 스타일 적용 함수
  applyStyles(element, styles) {
    Object.entries(styles).forEach(([property, value]) => {
      switch (property) {
        case 'fontSize':
          const size = Math.max(parseInt(value), 12);
          element.style.fontSize = `${size}px`;
          element.style.lineHeight = this.calculateOptimalLineHeight(size);
          break;
        case 'color':
          element.style.color = value;
          break;
        case 'fontWeight':
          element.style.fontWeight = value;
          break;
        case 'fontStyle':
          element.style.fontStyle = value;
          break;
        case 'textDecoration':
          element.style.textDecoration = value;
          break;
      }
    });
  }

  // 선택 영역에 스타일 적용
  applyToSelection(styles) {
    const selection = window.getSelection();
    const chalkboard = getActiveChalkboard();
    
    if (!chalkboard || !selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    
    if (range.collapsed) {
      // 커서 위치에 스타일 적용 (새로 입력할 텍스트용)
      this.setInputStyle(chalkboard, styles);
    } else {
      // 선택된 텍스트에 스타일 적용
      this.applyToRange(range, styles);
    }
    
    this.saveCurrentState();
  }

  // 커서 위치의 입력 스타일 설정
  setInputStyle(chalkboard, styles) {
    const span = document.createElement('span');
    span.classList.add('style-marker');
    this.applyStyles(span, styles);
    
    const selection = window.getSelection();
    const range = selection.getRangeAt(0);
    
    // 빈 span을 삽입하여 스타일 마커 생성
    range.insertNode(span);
    
    // 커서를 span 내부로 이동
    range.setStart(span, 0);
    range.setEnd(span, 0);
    selection.removeAllRanges();
    selection.addRange(range);
    
    chalkboard.focus();
  }

  // 범위에 스타일 적용 - 개선된 토글 시스템
  applyToRange(range, styles) {
    // fontSize가 있으면 절대값 적용 시스템 사용
    if (styles.fontSize) {
      this.applyAbsoluteFontSize(range, styles);
    } else {
      // 토글 가능한 스타일 처리
      if (this.isToggleStyle(styles)) {
        this.applyToggleToRange(range, styles);
      } else if (this.isColorStyle(styles)) {
        // 색깔 스타일 - 겹침 방지 처리
        this.applyColorToRange(range, styles);
      } else {
        // 일반 스타일 적용
        const contents = range.extractContents();
        const span = document.createElement('span');
        this.applyStyles(span, styles);
        span.appendChild(contents);
        range.insertNode(span);
      }
    }
    
    // 선택 해제
    window.getSelection().removeAllRanges();
  }

  // 토글 가능한 스타일인지 확인
  isToggleStyle(styles) {
    return (styles.fontWeight && (styles.fontWeight === 'toggle' || styles.fontWeight === 'bold' || styles.fontWeight === 'normal')) || 
           (styles.fontStyle && (styles.fontStyle === 'toggle' || styles.fontStyle === 'italic' || styles.fontStyle === 'normal')) || 
           (styles.textDecoration && (styles.textDecoration === 'toggle' || styles.textDecoration === 'underline' || styles.textDecoration === 'none'));
  }

  // 색깔 스타일인지 확인
  isColorStyle(styles) {
    return styles.hasOwnProperty('color');
  }

  // 메모장 방식 토글 스타일 적용
  applyToggleToRange(range, styles) {
    const currentStyles = this.getCurrentStyles();
    
    // 메모장 알고리즘: 일관성에 따른 동작 결정
    const action = this.determineMemopadAction(currentStyles, styles);
    
    if (action.type === 'unify') {
      // 섞인 상태 → 통일 적용
      this.unifyStyleInRange(range, action.targetStyle);
    } else if (action.type === 'toggle') {
      // 일관된 상태 → 토글
      this.toggleStyleInRange(range, action.targetStyle);
    } else if (action.type === 'apply') {
      // 일반 적용
      this.applyStyleInRange(range, action.targetStyle);
    }
  }

  // 메모장 방식 동작 결정 알고리즘
  determineMemopadAction(currentStyles, requestedStyles) {
    const result = { type: 'apply', targetStyle: {} };
    
    // Bold 처리
    if (requestedStyles.fontWeight === 'toggle') {
      if (currentStyles.fontWeight === 'mixed') {
        // 섞인 상태 → 모두 Bold로 통일
        result.type = 'unify';
        result.targetStyle.fontWeight = 'bold';
      } else if (currentStyles.fontWeight === 'bold' || currentStyles.fontWeight === '700') {
        // 모두 Bold → 모두 Normal로 변경
        result.type = 'toggle';
        result.targetStyle.fontWeight = 'normal';
      } else {
        // 모두 Normal → 모두 Bold로 변경
        result.type = 'toggle';
        result.targetStyle.fontWeight = 'bold';
      }
    }
    
    // Italic 처리
    if (requestedStyles.fontStyle === 'toggle') {
      if (currentStyles.fontStyle === 'mixed') {
        result.type = 'unify';
        result.targetStyle.fontStyle = 'italic';
      } else if (currentStyles.fontStyle === 'italic') {
        result.type = 'toggle';
        result.targetStyle.fontStyle = 'normal';
      } else {
        result.type = 'toggle';
        result.targetStyle.fontStyle = 'italic';
      }
    }
    
    // Underline 처리
    if (requestedStyles.textDecoration === 'toggle') {
      if (currentStyles.textDecoration === 'mixed') {
        result.type = 'unify';
        result.targetStyle.textDecoration = 'underline';
      } else if ((currentStyles.textDecoration || '').includes('underline')) {
        result.type = 'toggle';
        result.targetStyle.textDecoration = 'none';
      } else {
        result.type = 'toggle';
        result.targetStyle.textDecoration = 'underline';
      }
    }
    
    return result;
  }

  // 스타일 통일 적용
  unifyStyleInRange(range, targetStyle) {
    const contents = range.extractContents();
    
    // 모든 기존 스타일 제거하고 새로운 스타일로 통일
    const cleanContents = this.removeConflictingStyles(contents, targetStyle);
    
    const wrapper = document.createElement('span');
    this.applyStyles(wrapper, targetStyle);
    wrapper.appendChild(cleanContents);
    range.insertNode(wrapper);
  }

  // 스타일 토글 적용
  toggleStyleInRange(range, targetStyle) {
    const contents = range.extractContents();
    
    if (this.isRemovalStyle(targetStyle)) {
      // 스타일 제거
      const cleanContents = this.removeSpecificStyles(contents, targetStyle);
      range.insertNode(cleanContents);
    } else {
      // 스타일 적용
      const wrapper = document.createElement('span');
      this.applyStyles(wrapper, targetStyle);
      wrapper.appendChild(contents);
      range.insertNode(wrapper);
    }
  }

  // 일반 스타일 적용
  applyStyleInRange(range, targetStyle) {
    const contents = range.extractContents();
    const wrapper = document.createElement('span');
    this.applyStyles(wrapper, targetStyle);
    wrapper.appendChild(contents);
    range.insertNode(wrapper);
  }

  // 제거 스타일인지 확인
  isRemovalStyle(style) {
    return style.fontWeight === 'normal' || 
           style.fontStyle === 'normal' || 
           style.textDecoration === 'none';
  }

  // 충돌하는 스타일 제거
  removeConflictingStyles(fragment, targetStyle) {
    const cloned = fragment.cloneNode(true);
    
    this.walkAndCleanStyles(cloned, targetStyle);
    return cloned;
  }

  // 특정 스타일 제거
  removeSpecificStyles(fragment, targetStyle) {
    const cloned = fragment.cloneNode(true);
    
    this.walkAndRemoveStyles(cloned, targetStyle);
    return cloned;
  }

  // 스타일 정리 워커
  walkAndCleanStyles(node, targetStyle) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      // 충돌하는 스타일 속성 제거
      if (targetStyle.fontWeight && node.style) {
        node.style.removeProperty('font-weight');
      }
      if (targetStyle.fontStyle && node.style) {
        node.style.removeProperty('font-style');
      }
      if (targetStyle.textDecoration && node.style) {
        node.style.removeProperty('text-decoration');
      }
      
      // 자식 노드 처리
      Array.from(node.childNodes).forEach(child => {
        this.walkAndCleanStyles(child, targetStyle);
      });
    }
  }

  // 스타일 제거 워커
  walkAndRemoveStyles(node, targetStyle) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (targetStyle.fontWeight === 'normal') {
        node.style.removeProperty('font-weight');
        if (node.tagName === 'B' || node.tagName === 'STRONG') {
          // Bold 태그를 span으로 변경하거나 제거
          this.unwrapElement(node);
        }
      }
      if (targetStyle.fontStyle === 'normal') {
        node.style.removeProperty('font-style');
        if (node.tagName === 'I' || node.tagName === 'EM') {
          this.unwrapElement(node);
        }
      }
      if (targetStyle.textDecoration === 'none') {
        node.style.removeProperty('text-decoration');
        if (node.tagName === 'U') {
          this.unwrapElement(node);
        }
      }
      
      // 자식 노드 처리
      Array.from(node.childNodes).forEach(child => {
        this.walkAndRemoveStyles(child, targetStyle);
      });
    }
  }

  // 요소 unwrap (내용만 남기고 태그 제거)
  unwrapElement(element) {
    const parent = element.parentNode;
    while (element.firstChild) {
      parent.insertBefore(element.firstChild, element);
    }
    parent.removeChild(element);
  }

  // 메모장 방식 색깔 적용
  applyColorToRange(range, styles) {
    // 직접적인 색상 적용 - 토글 없이
    console.log('🎨 색상 적용:', styles.color);
    this.unifyColorInRange(range, styles.color);
  }

  // 색상 통일 적용
  unifyColorInRange(range, targetColor) {
    const contents = range.extractContents();
    
    // 기존 색깔 스타일 제거
    this.removeColorFromFragment(contents);
    
    // 새로운 색깔 적용 (기본 흰색이 아닌 경우에만)
    if (targetColor !== '#ffffff') {
      const wrapper = document.createElement('span');
      wrapper.style.color = targetColor;
      wrapper.appendChild(contents);
      range.insertNode(wrapper);
    } else {
      // 기본 색상으로 복원
      range.insertNode(contents);
    }
  }

  // 프래그먼트에서 기존 색깔 스타일 제거
  removeColorFromFragment(node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      // 인라인 스타일에서 color 제거
      if (node.style && node.style.color) {
        node.style.removeProperty('color');
      }
      
      // font 태그의 color 속성 제거
      if (node.tagName === 'FONT' && node.hasAttribute('color')) {
        node.removeAttribute('color');
      }
      
      // 자식 노드들 재귀적으로 처리
      Array.from(node.childNodes).forEach(child => {
        this.removeColorFromFragment(child);
      });
    }
  }

  // 메모장 방식 절대값 폰트 크기 적용
  applyAbsoluteFontSize(range, styles) {
    console.log('applyAbsoluteFontSize 호출됨:', styles.fontSize);
    const currentStyles = this.getCurrentStyles();
    console.log('현재 스타일:', currentStyles);
    
    // 메모장 방식: 폰트 크기 일관성 확인
    if (currentStyles.fontSize === 'mixed') {
      // 섞인 크기 → 새로운 크기로 통일
      console.log('섞인 크기 감지 → 통일 적용');
      this.unifyFontSizeInRange(range, styles.fontSize);
    } else {
      // 일관된 크기 → 새로운 크기 적용
      console.log('일관된 크기 → 새로운 크기로 통일');
      this.unifyFontSizeInRange(range, styles.fontSize);
    }
  }

  // 폰트 크기 통일 적용 - 선택 영역 유지 개선
  unifyFontSizeInRange(range, targetSize) {
    console.log('unifyFontSizeInRange 호출됨:', targetSize);
    
    // 1. 선택 영역 정보 저장
    const startContainer = range.startContainer;
    const startOffset = range.startOffset;
    const endContainer = range.endContainer;
    const endOffset = range.endOffset;
    
    // 2. 선택된 콘텐츠 추출
    const contents = range.extractContents();
    console.log('추출된 콘텐츠:', contents);
    
    // 3. 모든 텍스트 노드 추출 및 정리
    const cleanText = this.extractPlainTextWithPreservation(contents);
    console.log('정리된 텍스트:', cleanText);
    
    // 4. 새로운 wrapper 생성 - 강제 인라인 스타일 적용
    const wrapper = document.createElement('span');
    wrapper.className = 'unified-font-size';
    
    // 인라인 스타일로 강제 적용
    wrapper.style.setProperty('font-size', targetSize + 'px', 'important');
    wrapper.style.setProperty('line-height', this.calculateOptimalLineHeight(targetSize), 'important');
    wrapper.style.setProperty('font-family', 'inherit', 'important');
    wrapper.style.setProperty('display', 'inline', 'important');
    
    console.log('생성된 wrapper 스타일:', wrapper.style.fontSize, wrapper.style.lineHeight);
    
    // 5. 정리된 텍스트를 wrapper에 추가
    wrapper.appendChild(cleanText);
    
    // 6. 원래 위치에 삽입
    range.insertNode(wrapper);
    
    console.log('wrapper 삽입 완료');
    
    // 7. 선택 영역 복원 - wrapper 전체 선택
    const selection = window.getSelection();
    const newRange = document.createRange();
    newRange.selectNode(wrapper);
    selection.removeAllRanges();
    selection.addRange(newRange);
    
    console.log('✅ 선택 영역 복원 완료');
  }

  // 중첩된 DOM 구조에서 순수 텍스트 추출하면서 기본 서식 보존 - 개선된 버전
  extractPlainTextWithPreservation(fragment) {
    const result = document.createDocumentFragment();
    
    // TreeWalker로 모든 노드를 순서대로 처리
    const walker = document.createTreeWalker(
      fragment,
      NodeFilter.SHOW_ALL,
      null,
      false
    );

    let node;
    let lastWasBlock = false;
    
    while (node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        if (text && text.trim()) {
          // 의미있는 텍스트: 그대로 추가
          const textNode = document.createTextNode(text);
          result.appendChild(textNode);
          lastWasBlock = false;
        } else if (text && /\s/.test(text) && !lastWasBlock) {
          // 공백 문자: 블록 요소 후가 아닌 경우에만 추가
          const spaceNode = document.createTextNode(' ');
          result.appendChild(spaceNode);
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const tagName = node.tagName.toLowerCase();
        
        // BR 태그: 항상 보존
        if (tagName === 'br') {
          result.appendChild(document.createElement('br'));
          lastWasBlock = true;
        }
        // 블록 요소: 줄바꿈 처리
        else if (this.isBlockElement(tagName)) {
          if (!lastWasBlock && result.childNodes.length > 0) {
            result.appendChild(document.createElement('br'));
          }
          lastWasBlock = true;
        }
        // 인라인 서식 요소: 내용과 함께 보존
        else if (this.isPreservableInlineElement(tagName)) {
          const preservedElement = this.createPreservedElement(tagName, node.textContent);
          if (preservedElement) {
            result.appendChild(preservedElement);
            lastWasBlock = false;
          }
        }
      }
    }
    
    return result;
  }

  // 블록 요소 판별
  isBlockElement(tagName) {
    const blockElements = [
      'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'blockquote', 'pre', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
      'table', 'tr', 'td', 'th', 'section', 'article', 'header',
      'footer', 'main', 'aside', 'nav'
    ];
    return blockElements.includes(tagName);
  }

  // 보존 가능한 인라인 요소 판별
  isPreservableInlineElement(tagName) {
    const preservableElements = [
      'b', 'strong', 'i', 'em', 'u', 'mark', 'del', 'ins', 
      'sub', 'sup', 's', 'strike', 'code', 'kbd', 'var', 'samp'
    ];
    return preservableElements.includes(tagName);
  }

  // 보존된 요소 생성
  createPreservedElement(tagName, textContent) {
    if (!textContent || !textContent.trim()) {
      return null;
    }
    
    const element = document.createElement(tagName);
    element.textContent = textContent.trim();
    return element;
  }

  // 현재 상태 저장
  saveCurrentState() {
    const tabData = tabs.get(activeTabId);
    if (tabData) {
      const chalkboard = getActiveChalkboard();
      if (chalkboard) {
        tabData.content = chalkboard.innerHTML;
        saveAllTabsData();
      }
    }
  }

  // 전체 칠판 기본 스타일 설정 - 줄 간격 개선
  setChalkboardBaseStyle(chalkboard, fontSize) {
    const size = Math.max(parseInt(fontSize), 12);
    const lineHeight = this.calculateOptimalLineHeight(size);
    
    // 칠판 자체 스타일 강제 적용
    chalkboard.style.setProperty('font-size', `${size}px`, 'important');
    chalkboard.style.setProperty('line-height', lineHeight.toString(), 'important');
    
    // 기존 텍스트들의 줄 간격도 업데이트
    this.updateExistingTextLineHeight(chalkboard);
    
    // 기존 스타일 마커들 정리
    this.cleanupStyleMarkers(chalkboard);
    
    console.log(`✅ 칠판 기본 스타일 설정: ${size}px, line-height: ${lineHeight}`);
  }

  // 기존 텍스트들의 줄 간격 업데이트
  updateExistingTextLineHeight(chalkboard) {
    const walker = document.createTreeWalker(
      chalkboard,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: function(node) {
          // span 요소들만 처리
          if (node.tagName === 'SPAN' && node.style.fontSize) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    let node;
    while (node = walker.nextNode()) {
      const currentFontSize = parseFloat(node.style.fontSize);
      if (currentFontSize) {
        const newLineHeight = this.calculateOptimalLineHeight(currentFontSize);
        node.style.setProperty('line-height', newLineHeight, 'important');
      }
    }
  }

  // 스타일 마커 정리
  cleanupStyleMarkers(chalkboard) {
    const markers = chalkboard.querySelectorAll('.style-marker:empty');
    markers.forEach(marker => marker.remove());
  }

  // 메모장 스타일 - 선택 영역의 모든 텍스트 노드 스타일 분석
  getCurrentStyles() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return this.defaultStyles;

    const range = selection.getRangeAt(0);
    
    if (range.collapsed) {
      // 커서만 있는 경우 - 현재 위치의 스타일
      const container = range.commonAncestorContainer;
      const element = container.nodeType === 3 ? container.parentNode : container;
      const computedStyle = window.getComputedStyle(element);
      
      return {
        fontSize: parseInt(computedStyle.fontSize) || 72,
        color: this.rgbToHex(computedStyle.color) || '#ffffff',
        fontWeight: computedStyle.fontWeight || 'normal',
        fontStyle: computedStyle.fontStyle || 'normal',
        textDecoration: computedStyle.textDecoration || 'none'
      };
    }

    // 선택 영역의 모든 스타일 분석 - 메모장 방식
    return this.analyzeSelectionStyles(range);
  }

  // 메모장 방식 스타일 분석 - 선택 영역의 일관성 검사
  analyzeSelectionStyles(range) {
    const walker = document.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      }
    );

    const styles = [];
    let node;
    
    while (node = walker.nextNode()) {
      if (node.textContent.trim()) { // 빈 텍스트 노드 제외
        const element = node.parentElement;
        const computedStyle = window.getComputedStyle(element);
        
        styles.push({
          fontSize: parseInt(computedStyle.fontSize) || 72,
          color: this.rgbToHex(computedStyle.color) || '#ffffff',
          fontWeight: computedStyle.fontWeight || 'normal',
          fontStyle: computedStyle.fontStyle || 'normal',
          textDecoration: computedStyle.textDecoration || 'none'
        });
      }
    }

    if (styles.length === 0) {
      return this.defaultStyles;
    }

    // 메모장 방식: 다수결 + 일관성 검사
    return this.determineConsistentStyle(styles);
  }

  // 메모장 방식 일관성 결정 알고리즘
  determineConsistentStyle(styles) {
    const first = styles[0];
    const result = { ...first };

    // 각 스타일 속성별로 일관성 검사
    result.fontWeightConsistent = styles.every(s => s.fontWeight === first.fontWeight);
    result.fontStyleConsistent = styles.every(s => s.fontStyle === first.fontStyle);
    result.textDecorationConsistent = styles.every(s => s.textDecoration === first.textDecoration);
    result.colorConsistent = styles.every(s => s.color === first.color);
    result.fontSizeConsistent = styles.every(s => s.fontSize === first.fontSize);

    // 메모장 로직: 일관되지 않으면 "적용" 상태로 간주
    if (!result.fontWeightConsistent) {
      result.fontWeight = 'mixed'; // 섞인 상태
    }
    if (!result.fontStyleConsistent) {
      result.fontStyle = 'mixed';
    }
    if (!result.textDecorationConsistent) {
      result.textDecoration = 'mixed';
    }
    if (!result.colorConsistent) {
      result.color = 'mixed';
    }
    if (!result.fontSizeConsistent) {
      result.fontSize = 'mixed';
    }

    return result;
  }

  // RGB를 HEX로 변환
  rgbToHex(rgb) {
    if (!rgb || typeof rgb !== 'string') return '#ffffff';
    
    if (rgb.startsWith('#')) return rgb;
    
    if (rgb.startsWith('rgb')) {
      const parts = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
      if (!parts) return '#ffffff';
      
      const r = parseInt(parts[1]).toString(16).padStart(2, '0');
      const g = parseInt(parts[2]).toString(16).padStart(2, '0');
      const b = parseInt(parts[3]).toString(16).padStart(2, '0');
      
      return `#${r}${g}${b}`;
    }
    
    return '#ffffff';
  }

  // 폰트 크기와 관계없는 스타일만 보존 - 사용 중단 (새 함수로 대체됨)
  preserveNonFontStyles(element) {
    console.warn('preserveNonFontStyles는 더 이상 사용되지 않습니다. createPreservedElement를 사용하세요.');
    const tagName = element.tagName.toLowerCase();
    return this.isPreservableInlineElement(tagName) ? 
           this.createPreservedElement(tagName, element.textContent) : null;
  }

  // 기존 스타일 보존하면서 폰트 크기만 변경 - 사용 중단
  preserveStylesWithNewFontSize(fragment, newFontSize) {
    console.warn('preserveStylesWithNewFontSize는 더 이상 사용되지 않습니다. extractPlainTextWithPreservation을 사용하세요.');
    return this.extractPlainTextWithPreservation(fragment);
  }

  // 프래그먼트에서 폰트 크기 관련 스타일만 제거 - 더 강력한 버전
  removeFontSizeFromFragment(node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      // 1. 인라인 스타일에서 폰트 관련 속성 모두 제거
      if (node.style) {
        node.style.removeProperty('font-size');
        node.style.removeProperty('line-height');
        node.style.removeProperty('font');
      }
      
      // 2. 폰트 관련 태그들 제거
      const fontTags = ['font', 'big', 'small'];
      if (fontTags.includes(node.tagName.toLowerCase())) {
        this.unwrapElement(node);
        return; // unwrap 후에는 노드가 변경되므로 리턴
      }
      
      // 3. 폰트 크기 관련 클래스 제거
      if (node.classList) {
        const classesToRemove = [];
        node.classList.forEach(className => {
          if (className.includes('font-size') || 
              className.includes('text-size') ||
              className.match(/size-\d+/) ||
              className.includes('unified-font-size')) {
            classesToRemove.push(className);
          }
        });
        classesToRemove.forEach(className => node.classList.remove(className));
      }
      
      // 4. size 속성 제거
      if (node.hasAttribute('size')) {
        node.removeAttribute('size');
      }
      
      // 5. 자식 노드들 재귀적으로 처리
      Array.from(node.childNodes).forEach(child => {
        this.removeFontSizeFromFragment(child);
      });
    }
  }
}

// 전역 스타일 매니저 인스턴스
const styleManager = new TextStyleManager();

// 창 제어 기능
// 최소화 버튼 - 창 최소화
document.getElementById('minimizeButton').addEventListener('click', function() {
  window.electronAPI.minimizeWindow();
});

// 최대화 버튼 - 전체 화면으로 최대화/복원
document.getElementById('maximizeButton').addEventListener('click', function() {
  window.electronAPI.maximizeWindow();
});

// 닫기 버튼 - 앱 완전히 종료
document.getElementById('closeButton').addEventListener('click', function() {
  window.electronAPI.closeWindow();
});

// 탭 생성 버튼
document.getElementById('addTabButton').addEventListener('click', function() {
  createNewTab();
});

// 탭 관련 함수 추가
function createTabElement(tabId, tabTitle) {
  const tabElement = document.createElement('div');
  tabElement.className = 'tab';
  tabElement.dataset.tabId = tabId;
  
  const titleSpan = document.createElement('span');
  titleSpan.className = 'tab-title';
  titleSpan.textContent = tabTitle;

  // 더블클릭으로 탭 이름 편집 기능 추가
  titleSpan.addEventListener('dblclick', () => {
    titleSpan.contentEditable = true;
    titleSpan.focus();
    const originalTitle = titleSpan.textContent;

    const saveOrCancel = (event) => {
      if (event.type === 'blur' || (event.type === 'keydown' && event.key === 'Enter')) {
        titleSpan.contentEditable = false;
        const newTitle = titleSpan.textContent.trim();
        if (newTitle && newTitle !== originalTitle) {
          const tabData = tabs.get(tabId);
          if (tabData) {
            tabData.title = newTitle;
            saveAllTabsData(); // 변경된 탭 제목 저장
          }
        } else {
          titleSpan.textContent = originalTitle; // 변경 없거나 빈 제목이면 원복
        }
        titleSpan.removeEventListener('blur', saveOrCancel);
        titleSpan.removeEventListener('keydown', saveOrCancel);
      } else if (event.type === 'keydown' && event.key === 'Escape') {
        titleSpan.contentEditable = false;
        titleSpan.textContent = originalTitle;
        titleSpan.removeEventListener('blur', saveOrCancel);
        titleSpan.removeEventListener('keydown', saveOrCancel);
      }
    };

    titleSpan.addEventListener('blur', saveOrCancel);
    titleSpan.addEventListener('keydown', saveOrCancel);
  });
  
  const closeButton = document.createElement('button');
  closeButton.className = 'tab-close';
  closeButton.title = '탭 닫기';
  closeButton.textContent = '\u00d7';
  closeButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(tabId);
  });
  
  tabElement.appendChild(titleSpan);
  tabElement.appendChild(closeButton);
  
  tabElement.addEventListener('click', () => {
    switchToTab(tabId);
  });
  
  return tabElement;
}

function createTabContent(tabId) {
  const contentElement = document.createElement('div');
  contentElement.className = 'tab-content';
  contentElement.dataset.tabId = tabId;
  
  // 툴바 요소 생성
  const toolbarElement = document.createElement('div');
  toolbarElement.className = 'toolbar';
  toolbarElement.dataset.tabId = tabId;

  // 툴바 HTML 구조 정의
  const toolbarHTML = `
    <div class="toolbar-group">
      <button id="boldBtn" title="굵게">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"></path>
          <path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"></path>
        </svg>
      </button>
      <button id="italicBtn" title="기울임">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="4" x2="10" y2="4"></line>
          <line x1="14" y1="20" x2="5" y2="20"></line>
          <line x1="15" y1="4" x2="9" y2="20"></line>
        </svg>
      </button>
      <button id="underlineBtn" title="밑줄">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"></path>
          <line x1="4" y1="21" x2="20" y2="21"></line>
        </svg>
      </button>
    </div>
    <div class="divider"></div>
    <div class="color-picker-container">
      <input type="color" id="colorPicker" value="#ffffff" title="글자 색상">
      <div class="predefined-colors">
        <div class="color-swatch" style="background-color: #ffffff;" data-color="#ffffff" title="하얀색"></div>
        <div class="color-swatch" style="background-color: #f87171;" data-color="#f87171" title="빨간색"></div>
        <div class="color-swatch" style="background-color: #fbbf24;" data-color="#fbbf24" title="노란색"></div>
        <div class="color-swatch" style="background-color: #34d399;" data-color="#34d399" title="초록색"></div>
        <div class="color-swatch" style="background-color: #60a5fa;" data-color="#60a5fa" title="파란색"></div>
        <div class="color-swatch" style="background-color: #a78bfa;" data-color="#a78bfa" title="보라색"></div>
        <div class="color-swatch" style="background-color: #f472b6;" data-color="#f472b6" title="분홍색"></div>
      </div>
    </div>
    <div class="divider"></div>
    <div class="font-size-control">
      <label for="fontSizeSelect" class="font-size-label">크기:</label>
      <div class="font-size-input-group">
        <input type="number" id="fontSizeInput" class="font-size-input" 
               value="72" min="8" max="200" title="현재 글자 크기 (px)">
        <div class="font-size-stepper">
          <button id="fontSizeDown" class="font-size-step-btn" title="크기 1px 감소 (Ctrl+↓)">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
          <button id="fontSizeUp" class="font-size-step-btn" title="크기 1px 증가 (Ctrl+↑)">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
        </div>
      </div>
      <select id="fontSizeSelect" class="font-size-select" title="미리 정의된 크기 선택">
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
  `;
  toolbarElement.innerHTML = toolbarHTML;
  
  // 칠판 요소 생성
  const chalkboardElement = document.createElement('div');
  chalkboardElement.className = 'chalkboard';
  chalkboardElement.contentEditable = true;
  chalkboardElement.spellcheck = false;
  chalkboardElement.dataset.tabId = tabId;
  
  // 기본 글자 크기와 줄 간격 설정 - 새로운 시스템 사용
  styleManager.setChalkboardBaseStyle(chalkboardElement, 72);
  
  // 이벤트 리스너 등록
  setupTabContentEvents(tabId, toolbarElement, chalkboardElement);
  
  contentElement.appendChild(toolbarElement);
  contentElement.appendChild(chalkboardElement);
  
  return contentElement;
}

function setupTabContentEvents(tabId, toolbarElement, chalkboardElement) {
  // 탭 콘텐츠의 각 버튼에 이벤트 리스너 등록
  const boldBtn = toolbarElement.querySelector('#boldBtn');
  const italicBtn = toolbarElement.querySelector('#italicBtn');
  const underlineBtn = toolbarElement.querySelector('#underlineBtn');
  const colorPicker = toolbarElement.querySelector('#colorPicker');
  const fontSizeSelect = toolbarElement.querySelector('#fontSizeSelect');
  const fontSizeInput = toolbarElement.querySelector('#fontSizeInput');
  const fontSizeUp = toolbarElement.querySelector('#fontSizeUp');
  const fontSizeDown = toolbarElement.querySelector('#fontSizeDown');
  const colorSwatches = toolbarElement.querySelectorAll('.color-swatch');

  // 굵게 - 단순화된 토글
  boldBtn.addEventListener('click', () => {
    chalkboardElement.focus();
    styleManager.applyToSelection({ fontWeight: 'toggle' });
    updateToolbarState();
  });

  // 기울임 - 단순화된 토글
  italicBtn.addEventListener('click', () => {
    chalkboardElement.focus();
    styleManager.applyToSelection({ fontStyle: 'toggle' });
    updateToolbarState();
  });

  // 밑줄 - 단순화된 토글
  underlineBtn.addEventListener('click', () => {
    chalkboardElement.focus();
    styleManager.applyToSelection({ textDecoration: 'toggle' });
    updateToolbarState();
  });

  // 색상 선택 - 개선된 방식
  colorPicker.addEventListener('input', (e) => {
    console.log('🎨 색상 변경됨:', e.target.value);
    chalkboardElement.focus();
    styleManager.applyToSelection({ color: e.target.value });
    updateToolbarState();
  });

  // 미리 정의된 색상 선택 - 개선된 방식
  colorSwatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
      const color = swatch.dataset.color;
      colorPicker.value = color;
      chalkboardElement.focus();
      styleManager.applyToSelection({ color: color });
      updateToolbarState();
    });
  });

  // 글자 크기 변경 - 개선된 방식
  fontSizeSelect.addEventListener('change', (e) => {
    const fontSize = parseInt(e.target.value, 10);
    applyFontSizeChange(fontSize, chalkboardElement, tabId);
    updateToolbarState();
  });

  // 새로운 크기 입력 필드 이벤트
  fontSizeInput.addEventListener('input', (e) => {
    let fontSize = parseInt(e.target.value, 10);
    
    // 범위 제한
    if (fontSize < 8) fontSize = 8;
    if (fontSize > 200) fontSize = 200;
    
    if (!isNaN(fontSize)) {
      applyFontSizeChange(fontSize, chalkboardElement, tabId);
      // 드롭다운도 동기화
      if (fontSizeSelect.querySelector(`option[value="${fontSize}"]`)) {
        fontSizeSelect.value = fontSize;
      } else {
        fontSizeSelect.value = '';
      }
      updateToolbarState();
    }
  });

  // Enter 키로 적용
  fontSizeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      chalkboardElement.focus();
    }
  });

  // 크기 증가 버튼
  fontSizeUp.addEventListener('click', (e) => {
    e.preventDefault();
    console.log('🔺 크기 증가 버튼 클릭됨');
    const currentSize = parseInt(fontSizeInput.value, 10) || 72;
    const newSize = Math.min(currentSize + 1, 200);
    console.log('현재 크기:', currentSize, '→ 새 크기:', newSize);
    fontSizeInput.value = newSize;
    applyFontSizeChange(newSize, chalkboardElement, tabId);
    updateToolbarState();
    chalkboardElement.focus();
  });

  // 크기 감소 버튼
  fontSizeDown.addEventListener('click', (e) => {
    e.preventDefault();
    const currentSize = parseInt(fontSizeInput.value, 10) || 72;
    const newSize = Math.max(currentSize - 1, 8);
    fontSizeInput.value = newSize;
    applyFontSizeChange(newSize, chalkboardElement, tabId);
    updateToolbarState();
    chalkboardElement.focus();
  });

  // 연속 클릭 지원 (마우스 누르고 있기)
  let stepInterval;
  
  function startStepping(direction) {
    stepInterval = setInterval(() => {
      const currentSize = parseInt(fontSizeInput.value, 10) || 72;
      let newSize;
      
      if (direction === 'up') {
        newSize = Math.min(currentSize + 1, 200);
      } else {
        newSize = Math.max(currentSize - 1, 8);
      }
      
      if (newSize !== currentSize) {
        fontSizeInput.value = newSize;
        applyFontSizeChange(newSize, chalkboardElement, tabId);
        updateToolbarState();
      }
    }, 100); // 100ms마다 반복
  }
  
  function stopStepping() {
    if (stepInterval) {
      clearInterval(stepInterval);
      stepInterval = null;
    }
  }

  // 마우스 누르고 있기 이벤트
  fontSizeUp.addEventListener('mousedown', () => startStepping('up'));
  fontSizeDown.addEventListener('mousedown', () => startStepping('down'));
  
  // 마우스 떼기 이벤트
  document.addEventListener('mouseup', stopStepping);
  fontSizeUp.addEventListener('mouseleave', stopStepping);
  fontSizeDown.addEventListener('mouseleave', stopStepping);

  // 통합 글자 크기 변경 함수 - 간소화된 안정적 시스템
  function applyFontSizeChange(fontSize, chalkboard, tabId) {
    chalkboard.focus();
    const selection = window.getSelection();
    
    console.log('🎯 글자 크기 변경:', fontSize, 'px');
    
    if (selection.rangeCount > 0 && !selection.getRangeAt(0).collapsed) {
      // 선택된 텍스트가 있으면 선택 영역에만 적용
      console.log('📝 선택 영역에 폰트 크기 적용:', fontSize);
      styleManager.applyToSelection({ fontSize: fontSize });
    } else {
      // 선택된 텍스트가 없으면 전체 칠판 기본 스타일 변경
      console.log('🖼️ 전체 칠판에 폰트 크기 적용:', fontSize);
      styleManager.setChalkboardBaseStyle(chalkboard, fontSize);
      const tabData = tabs.get(tabId);
      if (tabData) {
        tabData.formatState.fontSize = fontSize;
        saveAllTabsData();
      }
    }
  }



  // 칠판 내용 변경 시 저장 (input 이벤트 사용)
  chalkboardElement.addEventListener('input', () => {
    saveCurrentTabData();
  });

  // 붙여넣기 이벤트 처리 (칠판 전용)
  chalkboardElement.addEventListener('paste', handleChalkboardPaste);
  
  // 드래그 앤 드롭 이벤트 처리
  chalkboardElement.addEventListener('dragover', handleDragOver);
  chalkboardElement.addEventListener('drop', handleDrop);
  chalkboardElement.addEventListener('dragleave', (e) => {
    e.target.classList.remove('drag-over');
  });
}

function createNewTab() {
  // 1번부터 시작해서 비어있는 번호 찾기
  let tabNumber = 1;
  while (tabs.has(`tab-${tabNumber}`)) {
    tabNumber++;
  }
  
  const tabId = `tab-${tabNumber}`;
  const tabTitle = `칠판 ${tabNumber}`;
  
  // tabCounter는 현재 가장 큰 번호로 업데이트 (선택사항)
  tabCounter = Math.max(tabCounter, tabNumber);
  
  // 탭 데이터 생성
  const tabData = new TabData(tabId, tabTitle);
  tabs.set(tabId, tabData);
  
  // 탭 UI 생성
  const tabElement = createTabElement(tabId, tabTitle);
  document.querySelector('.tabs-wrapper').appendChild(tabElement);
  
  // 탭 콘텐츠 생성
  const contentElement = createTabContent(tabId);
  document.getElementById('tabContents').appendChild(contentElement);
  
  // 새 탭으로 전환
  switchToTab(tabId);
  
  return tabId;
}

function switchToTab(tabId) {
  // 현재 탭 데이터 저장
  saveCurrentTabData();
  
  // 모든 탭과 콘텐츠에서 active 클래스 제거
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  
  // 선택된 탭과 콘텐츠에 active 클래스 추가
  document.querySelector(`.tab[data-tab-id="${tabId}"]`).classList.add('active');
  document.querySelector(`.tab-content[data-tab-id="${tabId}"]`).classList.add('active');
  
  // 현재 활성 탭 ID 업데이트
  activeTabId = tabId;
  
  // 탭 데이터 로드
  loadTabData(tabId);
}

function closeTab(tabId) {
  // 탭이 하나뻐이면 닫지 않음
  if (tabs.size === 1) {
    return;
  }
  
  // 탭 데이터 삭제
  tabs.delete(tabId);
  
  // DOM에서 탭과 콘텐츠 제거
  document.querySelector(`.tab[data-tab-id="${tabId}"]`).remove();
  document.querySelector(`.tab-content[data-tab-id="${tabId}"]`).remove();
  
  // 현재 탭이 닫힌 경우 다른 탭으로 전환
  if (activeTabId === tabId) {
    const remainingTabId = [...tabs.keys()][0];
    switchToTab(remainingTabId);
  }
  
  // 모든 탭 데이터 저장
  saveAllTabsData();
}

function saveCurrentTabData() {
  if (!activeTabId || !tabs.has(activeTabId)) return;

  const tabData = tabs.get(activeTabId);
  const activeChalkboard = getActiveChalkboard();
  const activeToolbar = document.querySelector(`.toolbar[data-tab-id="${activeTabId}"]`);

  if (activeChalkboard) {
    tabData.content = activeChalkboard.innerHTML;
  }

  if (activeToolbar) {
    const boldBtn = activeToolbar.querySelector('#boldBtn');
    const italicBtn = activeToolbar.querySelector('#italicBtn');
    const underlineBtn = activeToolbar.querySelector('#underlineBtn');
    const colorPicker = activeToolbar.querySelector('#colorPicker');
    const fontSizeSelect = activeToolbar.querySelector('#fontSizeSelect');

    tabData.formatState.bold = boldBtn.classList.contains('active');
    tabData.formatState.italic = italicBtn.classList.contains('active');
    tabData.formatState.underline = underlineBtn.classList.contains('active');
    tabData.formatState.color = colorPicker.value;
    tabData.formatState.fontSize = parseInt(fontSizeSelect.value, 10);
  }
  
  saveAllTabsData(); // 모든 탭 데이터를 로컬 스토리지에 저장
}

function loadTabData(tabId) {
  if (!tabs.has(tabId)) return;
  
  const tabData = tabs.get(tabId);
  const chalkboard = document.querySelector(`.chalkboard[data-tab-id="${tabId}"]`);
  const boldBtn = document.querySelector(`.toolbar[data-tab-id="${tabId}"] #boldBtn`);
  const italicBtn = document.querySelector(`.toolbar[data-tab-id="${tabId}"] #italicBtn`);
  const underlineBtn = document.querySelector(`.toolbar[data-tab-id="${tabId}"] #underlineBtn`);
  const colorPicker = document.querySelector(`.toolbar[data-tab-id="${tabId}"] #colorPicker`);
  const fontSizeSelect = document.querySelector(`.toolbar[data-tab-id="${tabId}"] #fontSizeSelect`);
  
  if (!chalkboard) return;
  
  // 콘텐츠 로드
  chalkboard.innerHTML = tabData.content || '';
  
  // 포맷 상태 로드
  if (tabData.formatState) {
    if (boldBtn) boldBtn.classList.toggle('active', tabData.formatState.bold);
    if (italicBtn) italicBtn.classList.toggle('active', tabData.formatState.italic);
    if (underlineBtn) underlineBtn.classList.toggle('active', tabData.formatState.underline);
    if (colorPicker) colorPicker.value = tabData.formatState.color;
    if (fontSizeSelect) fontSizeSelect.value = tabData.formatState.fontSize;
    
    // 글자 크기와 줄 간격 적용
    const fontSize = tabData.formatState.fontSize || 72;
    const lineHeight = fontSize <= 24 ? 1.5 : fontSize <= 48 ? 1.4 : fontSize <= 72 ? 1.3 : 1.2;
    chalkboard.style.fontSize = `${fontSize}px`;
    chalkboard.style.lineHeight = lineHeight.toString();
  }
}

function saveAllTabsData() {
  const tabsArray = Array.from(tabs.entries()).map(([id, data]) => ({ id, ...data }));
  localStorage.setItem('tabsData', JSON.stringify(tabsArray));
}

function loadAllTabsData() {
  const savedTabs = localStorage.getItem('tabsData');
  tabs.clear(); // 기존 탭 데이터 초기화
  let newActiveTabId = null;

  if (savedTabs) {
    try {
      const parsedTabs = JSON.parse(savedTabs);
      
      if (Array.isArray(parsedTabs) && parsedTabs.length > 0) {
        parsedTabs.forEach(tabObj => {
          // TabData 인스턴스로 재생성
          const tabDataInstance = new TabData(tabObj.id, tabObj.title);
          tabDataInstance.content = tabObj.content || '';
          // formatState도 객체이므로, 개별적으로 할당하거나 깊은 복사 필요
          if (tabObj.formatState) {
            tabDataInstance.formatState = {
              bold: tabObj.formatState.bold || false,
              italic: tabObj.formatState.italic || false,
              underline: tabObj.formatState.underline || false,
              fontSize: tabObj.formatState.fontSize || 72,
              color: tabObj.formatState.color || '#ffffff'
            };
          }
          tabs.set(tabObj.id, tabDataInstance);
          if (!newActiveTabId) newActiveTabId = tabObj.id; // 첫 번째 탭을 활성 탭으로 설정
          
          // 탭 컨테이너 비우기
          const tabsWrapper = document.querySelector('.tabs-wrapper');
          tabsWrapper.innerHTML = '';
          const tabContentsContainer = document.querySelector('#tabContents'); 
          tabContentsContainer.innerHTML = '';

          if (tabs.size === 0) {
            createNewTab('tab-1', '칠판 1'); // ID와 제목을 명시적으로 전달
            activeTabId = 'tab-1';
          } else {
            tabs.forEach((tabData, tabId) => {
              const tabElement = createTabElement(tabId, tabData.title);
              tabsWrapper.appendChild(tabElement);
              const contentElement = createTabContent(tabId);
              tabContentsContainer.appendChild(contentElement);
              loadTabData(tabId); // 각 탭의 내용과 포맷 상태 로드
            });
            
            activeTabId = newActiveTabId || Array.from(tabs.keys())[0]; 
          }

          if (activeTabId) {
            switchToTab(activeTabId);
          } else if (tabs.size > 0) {
            const firstTabId = Array.from(tabs.keys())[0];
            switchToTab(firstTabId);
          }
          
          attachChalkboardEventListeners(); // 모든 칠판에 이벤트 리스너 다시 연결
          updateToolbarState(); // 툴바 상태 업데이트
        });
      } else {
        
      }
    } catch (error) {
      
    }
  }
}

// 시간표 렌더링
function renderTimetable() {
  const container = document.getElementById('timetableList');
  container.innerHTML = '';
  
  timetableData.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'timetable-item';
    div.innerHTML = `
      <span class="timetable-number">${index + 1}</span>
      <input type="text" 
             class="timetable-subject" 
             value="${item.subject}" 
             onchange="updateSubject(${item.id}, this.value)"
             onpaste="handleTimetablePaste(event)"
             placeholder="과목 입력">
      <input type="checkbox" 
             class="timetable-checkbox" 
             ${item.checked ? 'checked' : ''} 
             onchange="updateChecked(${item.id}, this.checked)">
    `;
    container.appendChild(div);
  });
}

// 페이지 로드 시 시간표 데이터 로드
document.addEventListener('DOMContentLoaded', () => {
  loadTimetableData();
});

// 붙여넣기 처리 함수들

// 전역 붙여넣기 이벤트 처리
function handleGlobalPaste(e) {
  const target = e.target;
  
  // 탭 제목 편집 중인 경우
  if (target.classList.contains('tab-title') && target.contentEditable === 'true') {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    const cleanText = text
      .replace(/\r\n/g, ' ')
      .replace(/\n/g, ' ')
      .replace(/\t/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 50); // 탭 제목 최대 길이 제한
    
    document.execCommand('insertText', false, cleanText);
  }
}

// 칠판 전용 붙여넣기 처리
function handleChalkboardPaste(e) {
  e.preventDefault();
  
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  
  // 칠판에서는 줄바꿈을 유지하되, 탭은 공백으로 변환
  const cleanText = text
    .replace(/\t/g, '    ') // 탭을 4개 공백으로
    .replace(/\r\n/g, '\n') // Windows 줄바꿈을 Unix 스타일로
    .replace(/\r/g, '\n');  // Mac 줄바꿈을 Unix 스타일로
  
  // 현재 선택 영역에 텍스트 삽입
  const selection = window.getSelection();
  if (selection.rangeCount) {
    const range = selection.getRangeAt(0);
    range.deleteContents();
    
    // 줄바꿈을 <br>로 변환하여 삽입
    const lines = cleanText.split('\n');
    lines.forEach((line, index) => {
      if (index > 0) {
        range.insertNode(document.createElement('br'));
      }
      if (line) {
        range.insertNode(document.createTextNode(line));
      }
    });
    
    // 커서를 삽입된 텍스트 끝으로 이동
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  
  // 변경사항 저장
  const tabId = e.target.dataset.tabId;
  const tabData = tabs.get(tabId);
  if (tabData) {
    tabData.content = e.target.innerHTML;
    saveAllTabsData();
  }
}

// 시간표 전용 붙여넣기 처리
function handleTimetablePaste(e) {
  e.preventDefault();
  
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  
  // 시간표에서는 특수문자 제거하고 깔끔한 텍스트만 허용
  const cleanText = text
    .replace(/[^\w\s가-힣ㄱ-ㅎㅏ-ㅣ]/g, '') // 한글, 영문, 숫자, 공백만 허용
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 30); // 최대 30자 제한
  
  insertTextAtCursor(e.target, cleanText);
}

// 커서 위치에 텍스트 삽입하는 헬퍼 함수
function insertTextAtCursor(element, text) {
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const value = element.value;
    
    // 선택된 텍스트를 새 텍스트로 교체
    element.value = value.substring(0, start) + text + value.substring(end);
    
    // 커서 위치를 삽입된 텍스트 끝으로 이동
    element.selectionStart = element.selectionEnd = start + text.length;
    
    // change 이벤트 수동 트리거
    element.dispatchEvent(new Event('change', { bubbles: true }));
    
    // 시각적 피드백
    element.classList.add('paste-feedback');
    setTimeout(() => {
      element.classList.remove('paste-feedback');
    }, 300);
  }
}

// 드래그 앤 드롭 이벤트 처리
function handleDragOver(e) {
  const target = e.target;
  if (target.classList.contains('chalkboard') || 
      target.classList.contains('timetable-subject') ||
      (target.classList.contains('tab-title') && target.contentEditable === 'true')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    
    // 드래그 오버 시각적 피드백 추가
    target.classList.add('drag-over');
  }
}

function handleDrop(e) {
  const target = e.target;
  
  // 드래그 오버 클래스 제거
  target.classList.remove('drag-over');
  
  if (target.classList.contains('chalkboard')) {
    e.preventDefault();
    const text = e.dataTransfer.getData('text/plain');
    const cleanText = text
      .replace(/\t/g, '    ')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
    
    // 드롭 위치에 텍스트 삽입
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    
    // 텍스트 삽입
    document.execCommand('insertText', false, cleanText);
    
    // 변경사항 저장
    const tabId = e.target.dataset.tabId;
    const tabData = tabs.get(tabId);
    if (tabData) {
      tabData.content = e.target.innerHTML;
      saveAllTabsData();
    }
  } else if (target.classList.contains('timetable-subject')) {
    e.preventDefault();
    const text = e.dataTransfer.getData('text/plain');
    const cleanText = text
      .replace(/[^\w\s가-힣ㄱ-ㅎㅏ-ㅣ]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 30);
    
    target.value = cleanText;
    target.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

// 드래그 리브 이벤트 처리 (드래그가 요소를 벗어날 때)
document.addEventListener('dragleave', (e) => {
  if (e.target.classList) {
    e.target.classList.remove('drag-over');
  }
});

// 시간표 데이터 저장 키
const TIMETABLE_KEY = 'chalkboard-timetable';

// 시간표 데이터 초기화
let timetableData = [];

// 로컬 스토리지에서 시간표 데이터 로드
function loadTimetableData() {
  const saved = localStorage.getItem(TIMETABLE_KEY);
  if (saved) {
    timetableData = JSON.parse(saved);
  } else {
    
    timetableData = [
      { id: 1, subject: '수학', checked: false },
      { id: 2, subject: '영어', checked: false },
      { id: 3, subject: '국어', checked: false },
      { id: 4, subject: '과학', checked: false },
      { id: 5, subject: '사회', checked: false }
    ];
  }
  renderTimetable();
}

// 과목명 업데이트
function updateSubject(id, value) {
  const item = timetableData.find(t => t.id === id);
  if (item) {
    item.subject = value;
    saveTimetableData();
  }
}

// 체크 상태 업데이트
function updateChecked(id, checked) {
  const item = timetableData.find(t => t.id === id);
  if (item) {
    item.checked = checked;
    saveTimetableData();
  }
}

// 시간표 항목 추가
function addTimetableItem() {
  const newId = timetableData.length > 0 ? Math.max(...timetableData.map(t => t.id)) + 1 : 1;
  timetableData.push({
    id: newId,
    subject: '',
    checked: false
  });
  saveTimetableData();
  renderTimetable();
}

// 완료된 항목 삭제
function clearChecked() {
  timetableData = timetableData.filter(item => !item.checked);
  saveTimetableData();
  renderTimetable();
}

// 시간표 데이터 저장
function saveTimetableData() {
  localStorage.setItem(TIMETABLE_KEY, JSON.stringify(timetableData));
}

// 사이드바 토글
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('open');
}

// 페이지 로드 시 시간표 데이터 로드
document.addEventListener('DOMContentLoaded', () => {
  loadTimetableData();
});

// 사이드바가 열려있을 때 ESC 키로 닫기
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const sidebar = document.getElementById('sidebar');
    if (sidebar.classList.contains('open')) {
      sidebar.classList.remove('open');
    }
  }
});

// 글자 크기 조절 키보드 단축키
document.addEventListener('keydown', (e) => {
  // Ctrl + 화살표 키로 글자 크기 조절
  if (e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    
    const activeChalkboard = getActiveChalkboard();
    if (!activeChalkboard) return;
    
    const tabId = activeChalkboard.dataset.tabId;
    const toolbar = document.querySelector(`.toolbar[data-tab-id="${tabId}"]`);
    if (!toolbar) return;
    
    const fontSizeInput = toolbar.querySelector('#fontSizeInput');
    if (!fontSizeInput) return;
    
    const currentSize = parseInt(fontSizeInput.value, 10) || 72;
    let newSize;
    
    if (e.shiftKey) {
      // Ctrl + Shift + 화살표: 5px 단위로 조절
      if (e.key === 'ArrowUp') {
        newSize = Math.min(currentSize + 5, 200);
      } else {
        newSize = Math.max(currentSize - 5, 8);
      }
    } else {
      // Ctrl + 화살표: 1px 단위로 조절
      if (e.key === 'ArrowUp') {
        newSize = Math.min(currentSize + 1, 200);
      } else {
        newSize = Math.max(currentSize - 1, 8);
      }
    }
    
    // 크기 변경 적용
    fontSizeInput.value = newSize;
    
    // 드롭다운도 동기화
    const fontSizeSelect = toolbar.querySelector('#fontSizeSelect');
    if (fontSizeSelect && fontSizeSelect.querySelector(`option[value="${newSize}"]`)) {
      fontSizeSelect.value = newSize;
    } else if (fontSizeSelect) {
      fontSizeSelect.value = '';
    }
    
    // 스타일 적용
    const applyFontSizeChange = (fontSize, chalkboard, tabId) => {
      chalkboard.focus();
      const selection = window.getSelection();
      
      if (selection.rangeCount > 0 && !selection.getRangeAt(0).collapsed) {
        // 선택된 텍스트가 있으면 선택 영역에만 적용
        styleManager.applyToSelection({ fontSize: fontSize });
      } else {
        // 선택된 텍스트가 없으면 전체 칠판 기본 스타일 변경
        styleManager.setChalkboardBaseStyle(chalkboard, fontSize);
        const tabData = tabs.get(tabId);
        if (tabData) {
          tabData.formatState.fontSize = fontSize;
          saveAllTabsData();
        }
      }
    };
    
    applyFontSizeChange(newSize, activeChalkboard, tabId);
    updateToolbarState();
  }
});

// 툴바 상태 업데이트 - 정밀 감지 시스템
function updateToolbarState() {
  const selection = window.getSelection();
  const activeChalkboard = getActiveChalkboard();
  
  if (!activeChalkboard) return;
  
  // 현재 탭의 툴바 버튼들 가져오기
  const tabId = activeChalkboard.dataset.tabId;
  const toolbar = document.querySelector(`.toolbar[data-tab-id="${tabId}"]`);
  
  if (!toolbar) return;
  
  const boldBtn = toolbar.querySelector('#boldBtn');
  const italicBtn = toolbar.querySelector('#italicBtn');
  const underlineBtn = toolbar.querySelector('#underlineBtn');
  const colorPicker = toolbar.querySelector('#colorPicker');
  const fontSizeSelect = toolbar.querySelector('#fontSizeSelect');
  const fontSizeInput = toolbar.querySelector('#fontSizeInput');
  
  // 기존 스타일 매니저를 통한 스타일 감지
  const currentStyles = styleManager.getCurrentStyles();
  
  // 메모장 방식 버튼 상태 업데이트
  // Bold 버튼 - 섞인 상태면 반투명, 일관된 상태면 명확하게
  if (currentStyles.fontWeight === 'mixed') {
    boldBtn.classList.add('mixed');
    boldBtn.classList.remove('active');
  } else {
    boldBtn.classList.remove('mixed');
    boldBtn.classList.toggle('active', currentStyles.fontWeight === 'bold' || currentStyles.fontWeight === '700');
  }
  
  // Italic 버튼
  if (currentStyles.fontStyle === 'mixed') {
    italicBtn.classList.add('mixed');
    italicBtn.classList.remove('active');
  } else {
    italicBtn.classList.remove('mixed');
    italicBtn.classList.toggle('active', currentStyles.fontStyle === 'italic');
  }
  
  // Underline 버튼
  if (currentStyles.textDecoration === 'mixed') {
    underlineBtn.classList.add('mixed');
    underlineBtn.classList.remove('active');
  } else {
    underlineBtn.classList.remove('mixed');
    underlineBtn.classList.toggle('active', (currentStyles.textDecoration || '').includes('underline'));
  }
  
  // 색상 업데이트 - 섞인 색상은 그라데이션으로 표시
  if (currentStyles.color === 'mixed') {
    colorPicker.style.background = 'linear-gradient(45deg, #ff0000, #00ff00, #0000ff)';
    colorPicker.value = '#ffffff'; // 기본값
  } else {
    colorPicker.style.background = '';
    colorPicker.value = currentStyles.color;
  }
  
  // 글자 크기 업데이트 - 섞인 크기는 "혼합"으로 표시
  if (currentStyles.fontSize === 'mixed') {
    // 혼합 상태 표시
    if (fontSizeInput) {
      fontSizeInput.value = '';
      fontSizeInput.placeholder = '혼합';
      fontSizeInput.classList.add('mixed');
    }
    fontSizeSelect.style.fontStyle = 'italic';
    fontSizeSelect.style.color = '#999';
    fontSizeSelect.value = '72'; // 기본값 표시
  } else {
    // 일관된 크기 표시
    const size = currentStyles.fontSize || 72;
    
    if (fontSizeInput) {
      fontSizeInput.value = size;
      fontSizeInput.placeholder = '';
      fontSizeInput.classList.remove('mixed');
    }
    
    fontSizeSelect.style.fontStyle = '';
    fontSizeSelect.style.color = '';
    
    // select 옵션에서 정확히 일치하는 값 찾기
    if (fontSizeSelect.querySelector(`option[value="${size}"]`)) {
      fontSizeSelect.value = size;
    } else {
      fontSizeSelect.value = '';
    }
  }
}

// 새로운 정밀 글자 크기 적용 시스템
function applyPreciseFontSizeToSelection(selection, targetSize) {
  if (!selection.rangeCount) return;
  
  const range = selection.getRangeAt(0);
  const fragment = range.extractContents();
  
  // 모든 텍스트 노드와 요소에 절대적 크기 적용
  walkAndApplyAbsoluteFontSize(fragment, targetSize);
  
  // 정리된 fragment를 다시 삽입
  range.insertNode(fragment);
  
  // 선택 영역 복원
  selection.removeAllRanges();
  selection.addRange(range);
}

// DOM 트리를 순회하며 절대적 글자 크기 적용
function walkAndApplyAbsoluteFontSize(node, targetSize) {
  if (node.nodeType === Node.TEXT_NODE) {
    // 텍스트 노드는 span으로 감싸서 절대 크기 적용
    if (node.textContent.trim()) {
      const span = document.createElement('span');
      span.style.fontSize = targetSize + 'px';
      span.style.lineHeight = styleManager.calculateOptimalLineHeight(targetSize);
      span.textContent = node.textContent;
      node.parentNode.replaceChild(span, node);
    }
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    // 요소 노드는 기존 스타일을 완전히 오버라이드
    node.style.fontSize = targetSize + 'px';
    node.style.lineHeight = styleManager.calculateOptimalLineHeight(targetSize);
    
    // 중첩된 폰트 크기 스타일 제거
    removeFontSizeAttributes(node);
    
    // 자식 노드들도 재귀적으로 처리
    const children = Array.from(node.childNodes);
    children.forEach(child => walkAndApplyAbsoluteFontSize(child, targetSize));
  }
}

// 폰트 크기 관련 속성들을 완전히 제거
function removeFontSizeAttributes(element) {
  // 인라인 스타일에서 폰트 관련 속성 제거 (fontSize만 남기고)
  if (element.style) {
    const currentFontSize = element.style.fontSize;
    const currentLineHeight = element.style.lineHeight;
    
    // 폰트 관련 스타일들 제거
    element.style.removeProperty('font');
    element.style.removeProperty('font-family');
    element.style.removeProperty('font-variant');
    element.style.removeProperty('font-stretch');
    
    // 크기와 줄간격만 유지
    if (currentFontSize) element.style.fontSize = currentFontSize;
    if (currentLineHeight) element.style.lineHeight = currentLineHeight;
  }
  
  // 폐기된 HTML 속성들 제거
  element.removeAttribute('size');
  element.removeAttribute('face');
}

// 정밀 현재 스타일 감지 시스템
function getPreciseCurrentStyles(selection, chalkboard) {
  console.log('🔍 정밀 스타일 감지 시작');
  
  if (selection.rangeCount > 0 && !selection.getRangeAt(0).collapsed) {
    // 선택 영역이 있는 경우 - 정밀 분석
    return analyzePreciseSelectionStyles(selection.getRangeAt(0));
  } else {
    // 선택 영역이 없는 경우 - 커서 위치 또는 전체 칠판 스타일
    return analyzePreciseCursorStyles(selection, chalkboard);
  }
}

// 선택 영역의 정밀 스타일 분석
function analyzePreciseSelectionStyles(range) {
  const styles = {
    fontSize: null,
    fontWeight: null,
    fontStyle: null,
    textDecoration: null,
    color: null
  };
  
  const fontSizes = new Set();
  const fontWeights = new Set();
  const fontStyles = new Set();
  const textDecorations = new Set();
  const colors = new Set();
  
  // 선택 영역의 모든 노드를 순회하며 스타일 수집
  walkSelectionNodes(range, (node) => {
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
      const element = node.parentElement;
      const computedStyle = window.getComputedStyle(element);
      
      // 정확한 픽셀 값으로 변환
      const fontSize = parseFloat(computedStyle.fontSize);
      fontSizes.add(Math.round(fontSize));
      
      fontWeights.add(computedStyle.fontWeight);
      fontStyles.add(computedStyle.fontStyle);
      textDecorations.add(computedStyle.textDecoration);
      colors.add(rgbToHex(computedStyle.color));
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const computedStyle = window.getComputedStyle(node);
      
      const fontSize = parseFloat(computedStyle.fontSize);
      fontSizes.add(Math.round(fontSize));
      
      fontWeights.add(computedStyle.fontWeight);
      fontStyles.add(computedStyle.fontStyle);
      textDecorations.add(computedStyle.textDecoration);
      colors.add(rgbToHex(computedStyle.color));
    }
  });
  
  // 일관성 검사
  styles.fontSize = fontSizes.size === 1 ? Array.from(fontSizes)[0] : 'mixed';
  styles.fontWeight = fontWeights.size === 1 ? Array.from(fontWeights)[0] : 'mixed';
  styles.fontStyle = fontStyles.size === 1 ? Array.from(fontStyles)[0] : 'mixed';
  styles.textDecoration = textDecorations.size === 1 ? Array.from(textDecorations)[0] : 'mixed';
  styles.color = colors.size === 1 ? Array.from(colors)[0] : 'mixed';
  
  console.log('📊 선택 영역 스타일 분석 결과:', styles);
  return styles;
}

// 커서 위치의 정밀 스타일 분석
function analyzePreciseCursorStyles(selection, chalkboard) {
  let targetElement = chalkboard;
  
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    
    if (container.nodeType === Node.TEXT_NODE) {
      targetElement = container.parentElement;
    } else if (container.nodeType === Node.ELEMENT_NODE) {
      targetElement = container;
    }
  }
  
  const computedStyle = window.getComputedStyle(targetElement);
  const fontSize = Math.round(parseFloat(computedStyle.fontSize));
  
  const styles = {
    fontSize: fontSize,
    fontWeight: computedStyle.fontWeight,
    fontStyle: computedStyle.fontStyle,
    textDecoration: computedStyle.textDecoration,
    color: rgbToHex(computedStyle.color)
  };
  
  console.log('📍 커서 위치 스타일 분석 결과:', styles);
  return styles;
}

// 선택 영역의 모든 노드를 순회하는 헬퍼 함수
function walkSelectionNodes(range, callback) {
  const walker = document.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_ALL,
    {
      acceptNode: function(node) {
        if (range.intersectsNode(node)) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_REJECT;
      }
    }
  );
  
  let node;
  while (node = walker.nextNode()) {
    callback(node);
  }
}

// 모든 칠판에 이벤트 리스너 등록 - 중복 제거된 버전
function attachChalkboardEventListeners() {
  const chalkboards = document.querySelectorAll('.chalkboard');
  chalkboards.forEach(chalkboard => {
    // 입력 이벤트 리스너
    chalkboard.addEventListener('input', () => {
      const tabId = chalkboard.dataset.tabId;
      const tabData = tabs.get(tabId);
      if (tabData) {
        tabData.content = chalkboard.innerHTML;
        saveAllTabsData();
      }
    });

    // 포커스 이벤트 리스너
    chalkboard.addEventListener('focus', () => {
      updateToolbarState();
    });

    // 선택 변경 이벤트 리스너
    chalkboard.addEventListener('mouseup', () => {
      updateToolbarState();
    });

    chalkboard.addEventListener('keyup', () => {
      updateToolbarState();
    });
    
    // 칠판 전용 붙여넣기 이벤트 리스너 추가
    chalkboard.addEventListener('paste', handleChalkboardPaste);
  });
}

// 헬퍼 함수들
function getActiveChalkboard() {
  return document.querySelector(`.chalkboard[data-tab-id="${activeTabId}"]`);
}

function getActiveToolbarButton(id) {
  return document.querySelector(`.toolbar[data-tab-id="${activeTabId}"] #${id}`);
}

// RGB to Hex 변환 함수
function rgbToHex(rgb) {
  if (!rgb || typeof rgb !== 'string') return '#ffffff';
  
  // 이미 hex 형식인 경우
  if (rgb.startsWith('#')) return rgb;
  
  // rgb() 형식인 경우
  if (rgb.startsWith('rgb')) {
    const parts = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (!parts) return '#ffffff';
    
    const r = parseInt(parts[1]).toString(16).padStart(2, '0');
    const g = parseInt(parts[2]).toString(16).padStart(2, '0');
    const b = parseInt(parts[3]).toString(16).padStart(2, '0');
    
    return `#${r}${g}${b}`;
  }
  
  return '#ffffff';
}

// 현재 포맷 상태 추적
let formatState = {
  bold: false,
  italic: false,
  underline: false,
  fontSize: 72,
  color: '#ffffff'
};

// 로컬 스토리지 키
const STORAGE_KEY = 'chalkboardContent';
const SETTINGS_KEY = 'chalkboardSettings';

// 엔트리 포인트: 앱이 시작될 때 설정과 콘텐츠를 로드하고 모든 탭 데이터 로드
function initApp() {
  loadAllTabsData();
}

// 초기 로드 이벤트 리스너
document.addEventListener('DOMContentLoaded', () => {
  try {
    
    loadAllTabsData();
    
    if (tabs.size === 0) {
      createNewTab();
    }
    
    switchToTab(activeTabId);
    
    attachChalkboardEventListeners();
    
    document.addEventListener('paste', handleGlobalPaste);
    
    document.addEventListener('drop', handleDrop);
    document.addEventListener('dragover', handleDragOver);
  } catch (error) {
    
    if (tabs.size === 0) {
      createNewTab();
    }
  }
});

// 글자 크기 초기값 설정
function updateFontSizeSelect() {
  const fontSizeSelect = getActiveToolbarButton('fontSizeSelect');
  fontSizeSelect.value = formatState.fontSize.toString();
}

// 설정 로드 후 셀렉트 박스 업데이트
document.addEventListener('DOMContentLoaded', () => {
  updateFontSizeSelect();
});

// 개선된 절대값 글자 크기 적용 함수 - 상대적 크기 문제 해결
function applyFontSize(fontSize, targetChalkboard) {
  const chalkboard = targetChalkboard || getActiveChalkboard();
  if (!chalkboard) return;

  const selection = window.getSelection();
  
  if (selection.rangeCount > 0 && !selection.getRangeAt(0).collapsed) {
    // 선택된 텍스트가 있으면 절대값 폰트 크기 시스템 사용
    // 모든 선택된 텍스트를 통일된 크기로 변경
    styleManager.applyToSelection({ fontSize: parseInt(fontSize) });
  } else {
    // 전체 칠판 스타일 변경
    styleManager.setChalkboardBaseStyle(chalkboard, fontSize);
    const tabData = tabs.get(activeTabId);
    if (tabData) {
      tabData.formatState.fontSize = parseInt(fontSize);
      saveAllTabsData();
    }
  }
  
  updateToolbarState();
}

// 개선된 키보드 단축키 지원
document.addEventListener('keydown', (e) => {
  const activeChalkboard = getActiveChalkboard();
  if (!activeChalkboard || !activeChalkboard.contains(document.activeElement)) return;

  // Ctrl(Cmd) + B: 굵게
  if (e.key === 'b' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    const currentStyles = styleManager.getCurrentStyles();
    const newWeight = currentStyles.fontWeight === 'bold' || currentStyles.fontWeight === '700' ? 'normal' : 'bold';
    styleManager.applyToSelection({ fontWeight: newWeight });
    updateToolbarState();
  }
  // Ctrl(Cmd) + I: 기울임
  else if (e.key === 'i' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    const currentStyles = styleManager.getCurrentStyles();
    const newStyle = currentStyles.fontStyle === 'italic' ? 'normal' : 'italic';
    styleManager.applyToSelection({ fontStyle: newStyle });
    updateToolbarState();
  }
  // Ctrl(Cmd) + U: 밑줄
  else if (e.key === 'u' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    const currentStyles = styleManager.getCurrentStyles();
    const hasUnderline = currentStyles.textDecoration.includes('underline');
    const newDecoration = hasUnderline ? 'none' : 'underline';
    styleManager.applyToSelection({ textDecoration: newDecoration });
    updateToolbarState();
  }
  // Ctrl(Cmd) + Shift + >: 글자 크게 (개선된 증가 로직)
  else if (e.key === '>' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
    e.preventDefault();
    const currentStyles = styleManager.getCurrentStyles();
    const currentSize = currentStyles.fontSize;
    const fontSizes = [16, 18, 20, 24, 30, 36, 42, 48, 56, 64, 72, 96, 120, 144];
    
    // 현재 크기보다 큰 다음 크기 찾기
    const nextSize = fontSizes.find(size => size > currentSize) || fontSizes[fontSizes.length - 1];
    styleManager.applyToSelection({ fontSize: nextSize });
    updateToolbarState();
  }
  // Ctrl(Cmd) + Shift + <: 글자 작게 (개선된 감소 로직)
  else if (e.key === '<' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
    e.preventDefault();
    const currentStyles = styleManager.getCurrentStyles();
    const currentSize = currentStyles.fontSize;
    const fontSizes = [16, 18, 20, 24, 30, 36, 42, 48, 56, 64, 72, 96, 120, 144];
    
    // 현재 크기보다 작은 이전 크기 찾기
    const prevSize = fontSizes.reverse().find(size => size < currentSize) || fontSizes[fontSizes.length - 1];
    styleManager.applyToSelection({ fontSize: prevSize });
    updateToolbarState();
  }
});