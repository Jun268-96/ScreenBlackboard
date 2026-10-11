/**
 * Chalkboard text formatter.
 * Selection changes wrap once after clearing the same property on descendants.
 * Caret-only changes affect future typing, not the whole board.
 * IME composition never mutates the DOM until compositionend.
 */

class SimpleTextFormatter {
  constructor() {
    this.currentFormat = {
      fontSize: 72,
      color: '#ffffff',
      fontWeight: 'normal',
      fontStyle: 'normal',
      textDecoration: 'none'
    };
    this.isComposing = false;
    this.compositionData = '';
  }

  applyFormat(chalkboard, format) {
    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const selectionInBoard = range ? this.isRangeInsideChalkboard(chalkboard, range) : false;

    if (range && selectionInBoard && !range.collapsed) {
      const applied = this.formatSelection(range, format);
      if (!applied) {
        this.setTypingFormat(chalkboard, format);
      }
    } else {
      this.setTypingFormat(chalkboard, format);
      if (range && selectionInBoard && range.collapsed && !this.isComposing) {
        this.ensureTypingSpan(chalkboard, format);
      }
    }

    Object.assign(this.currentFormat, format);
    chalkboard.dataset.currentFormat = JSON.stringify(this.currentFormat);
    chalkboard.focus({ preventScroll: true });
  }

  setTypingFormat(chalkboard, format) {
    const formatData = { ...this.currentFormat, ...format };
    chalkboard.dataset.currentFormat = JSON.stringify(formatData);
    Object.assign(this.currentFormat, format);

    if (format.fontSize) {
      chalkboard.style.setProperty('--typing-font-size', `${format.fontSize}px`);
      chalkboard.style.lineHeight = this.calculateLineHeight(format.fontSize);
      if (!chalkboard.textContent.trim()) {
        chalkboard.style.fontSize = `${format.fontSize}px`;
      }
    }
    if (format.color) {
      chalkboard.style.setProperty('--typing-color', format.color);
      if (!chalkboard.textContent.trim()) {
        chalkboard.style.color = format.color;
      }
    }
  }

  formatSelection(range, format) {
    try {
      const contents = range.extractContents();
      if (!contents || !contents.hasChildNodes()) {
        return false;
      }

      this.clearFormatProperties(contents, format);

      const wrapper = document.createElement('span');
      this.applyStylesToElement(wrapper, format);
      wrapper.appendChild(contents);
      this.unwrapRedundantSpans(wrapper);

      range.insertNode(wrapper);
      const chalkboard = wrapper.closest('.chalkboard');
      if (chalkboard) {
        this.cleanupFormatting(chalkboard);
      }

      const selection = window.getSelection();
      const newRange = document.createRange();
      newRange.selectNodeContents(wrapper);
      selection.removeAllRanges();
      selection.addRange(newRange);
      return true;
    } catch (error) {
      console.error('Error formatting selection:', error);
      return false;
    }
  }

  clearFormatProperties(root, format) {
    const keys = Object.keys(format || {});
    const walk = (node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        keys.forEach((key) => {
          const cssKey = this.formatKeyToCss(key);
          if (cssKey) {
            node.style.removeProperty(cssKey);
          }
          if (key === 'fontSize') {
            node.style.removeProperty('line-height');
          }
        });
        if (node.getAttribute && node.getAttribute('style') === '') {
          node.removeAttribute('style');
        }
        if (node.tagName === 'FONT') {
          if (format.fontSize) {
            node.removeAttribute('size');
          }
          if (format.color) {
            node.removeAttribute('color');
          }
        }
      }
      node.childNodes.forEach((child) => walk(child));
    };
    walk(root);
  }

  formatKeyToCss(key) {
    switch (key) {
      case 'fontSize':
        return 'font-size';
      case 'fontWeight':
        return 'font-weight';
      case 'fontStyle':
        return 'font-style';
      case 'textDecoration':
        return 'text-decoration';
      case 'color':
        return 'color';
      default:
        return null;
    }
  }

  unwrapRedundantSpans(wrapper) {
    const children = [...wrapper.childNodes];
    children.forEach((child) => {
      if (child.nodeType !== Node.ELEMENT_NODE || child.tagName !== 'SPAN') {
        return;
      }
      if (!child.getAttribute('style') && child.childNodes.length) {
        while (child.firstChild) {
          wrapper.insertBefore(child.firstChild, child);
        }
        child.remove();
      }
    });
  }

  isRangeInsideChalkboard(chalkboard, range) {
    if (!chalkboard || !range) {
      return false;
    }
    const container = range.commonAncestorContainer;
    return container === chalkboard || chalkboard.contains(container);
  }

  applyStylesToElement(element, format) {
    if (format.fontSize) {
      element.style.fontSize = `${format.fontSize}px`;
      element.style.lineHeight = this.calculateLineHeight(format.fontSize);
    }
    if (format.color) {
      element.style.color = format.color;
    }
    if (format.fontWeight) {
      element.style.fontWeight = format.fontWeight;
    }
    if (format.fontStyle) {
      element.style.fontStyle = format.fontStyle;
    }
    if (format.textDecoration) {
      element.style.textDecoration = format.textDecoration;
    }
  }

  calculateLineHeight(fontSize) {
    const size = parseInt(fontSize, 10);
    if (size <= 18) return '1.6';
    if (size <= 24) return '1.5';
    if (size <= 36) return '1.4';
    if (size <= 48) return '1.35';
    if (size <= 72) return '1.3';
    if (size <= 96) return '1.25';
    return '1.2';
  }

  getStoredFormat(chalkboard) {
    const raw = chalkboard?.dataset?.currentFormat;
    if (!raw) {
      return { ...this.currentFormat };
    }
    try {
      return { ...this.currentFormat, ...JSON.parse(raw) };
    } catch (error) {
      return { ...this.currentFormat };
    }
  }

  elementMatchesFormat(element, format, chalkboard) {
    if (!element || element === chalkboard) {
      return false;
    }
    const computed = window.getComputedStyle(element);
    if (format.fontSize && parseInt(computed.fontSize, 10) !== Number(format.fontSize)) {
      return false;
    }
    if (format.color && this.rgbToHex(computed.color) !== this.normalizeHex(format.color)) {
      return false;
    }
    if (format.fontWeight && this.normalizeFontWeight(computed.fontWeight) !== this.normalizeFontWeight(format.fontWeight)) {
      return false;
    }
    if (format.fontStyle && (computed.fontStyle === 'italic' || computed.fontStyle === 'oblique') !== (format.fontStyle === 'italic')) {
      return false;
    }
    if (format.textDecoration && this.normalizeTextDecoration(computed.textDecorationLine || computed.textDecoration) !== this.normalizeTextDecoration(format.textDecoration)) {
      return false;
    }
    return true;
  }

  ensureTypingSpan(chalkboard, extraFormat = {}) {
    if (this.isComposing) {
      return false;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return false;
    }

    const range = selection.getRangeAt(0);
    if (!range.collapsed || !this.isRangeInsideChalkboard(chalkboard, range)) {
      return false;
    }

    const format = { ...this.getStoredFormat(chalkboard), ...extraFormat };
    let host = range.startContainer;
    if (host.nodeType === Node.TEXT_NODE) {
      host = host.parentElement;
    }

    if (host && host !== chalkboard && this.elementMatchesFormat(host, format, chalkboard)) {
      const atEnd = range.startContainer.nodeType === Node.TEXT_NODE
        && range.startOffset === range.startContainer.textContent.length;
      const atStart = range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset === 0;
      if (!atStart || atEnd || range.startContainer.textContent.length > 0) {
        return true;
      }
    }

    const span = document.createElement('span');
    this.applyStylesToElement(span, format);
    span.appendChild(document.createTextNode('\u200B'));
    range.insertNode(span);

    const nextRange = document.createRange();
    nextRange.setStart(span.firstChild, 1);
    nextRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(nextRange);
    return true;
  }

  wrapRecentPlainText(chalkboard, text, format) {
    if (!text || this.isComposing) {
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) {
      return;
    }

    const parent = node.parentElement;
    if (parent && parent !== chalkboard && this.elementMatchesFormat(parent, format, chalkboard)) {
      return;
    }

    const end = range.startOffset;
    const start = end - text.length;
    if (start < 0 || node.textContent.slice(start, end) !== text) {
      return;
    }

    try {
      const wrapRange = document.createRange();
      wrapRange.setStart(node, start);
      wrapRange.setEnd(node, end);
      const contents = wrapRange.extractContents();
      const span = document.createElement('span');
      this.applyStylesToElement(span, format);
      span.appendChild(contents);
      wrapRange.insertNode(span);

      const nextRange = document.createRange();
      const focusNode = span.lastChild && span.lastChild.nodeType === Node.TEXT_NODE ? span.lastChild : span;
      const offset = focusNode.nodeType === Node.TEXT_NODE ? focusNode.textContent.length : span.childNodes.length;
      nextRange.setStart(focusNode, offset);
      nextRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(nextRange);
    } catch (error) {
      console.warn('Could not wrap recent input:', error);
    }
  }

  handleInput(event) {
    const chalkboard = event.target;
    if (this.isComposing || event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') {
      return;
    }
    if (event.inputType && event.inputType !== 'insertText' && event.inputType !== 'insertCompositionText') {
      return;
    }

    const format = this.getStoredFormat(chalkboard);
    const inserted = event.data;
    if (!inserted) {
      return;
    }
    this.wrapRecentPlainText(chalkboard, inserted, format);
  }

  handleCompositionStart(event) {
    this.isComposing = true;
    this.compositionData = '';
  }

  handleCompositionUpdate(event) {
    this.compositionData = event.data || '';
  }

  handleCompositionEnd(event) {
    this.isComposing = false;
    const chalkboard = event.target;
    const composed = event.data || this.compositionData || '';
    this.compositionData = '';
    if (!composed) {
      return;
    }
    const format = this.getStoredFormat(chalkboard);
    this.wrapRecentPlainText(chalkboard, composed, format);
  }

  getCurrentFormat(chalkboard) {
    const selection = window.getSelection();
    const fallback = this.getStoredFormat(chalkboard);

    if (!selection || selection.rangeCount === 0) {
      return fallback;
    }

    const range = selection.getRangeAt(0);
    if (!this.isRangeInsideChalkboard(chalkboard, range)) {
      return fallback;
    }

    let element = range.startContainer;
    if (element.nodeType === Node.TEXT_NODE) {
      element = element.parentElement;
    }
    if (!element || element === chalkboard) {
      return fallback;
    }

    const computedStyle = window.getComputedStyle(element);
    return {
      fontSize: parseInt(computedStyle.fontSize, 10) || fallback.fontSize,
      color: this.rgbToHex(computedStyle.color) || fallback.color,
      fontWeight: this.normalizeFontWeight(computedStyle.fontWeight),
      fontStyle: computedStyle.fontStyle === 'italic' || computedStyle.fontStyle === 'oblique' ? 'italic' : 'normal',
      textDecoration: this.normalizeTextDecoration(computedStyle.textDecorationLine || computedStyle.textDecoration)
    };
  }

  normalizeFontWeight(value) {
    const numeric = parseInt(value, 10);
    if (Number.isFinite(numeric)) {
      return numeric >= 600 ? 'bold' : 'normal';
    }
    const token = String(value || '').toLowerCase();
    if (token === 'bold' || token === 'bolder') {
      return 'bold';
    }
    return 'normal';
  }

  normalizeTextDecoration(value) {
    return String(value || '').includes('underline') ? 'underline' : 'none';
  }

  normalizeHex(color) {
    if (!color) {
      return '#ffffff';
    }
    const value = String(color).trim();
    if (value.startsWith('#') && value.length === 4) {
      return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toLowerCase();
    }
    if (value.startsWith('#') && value.length >= 7) {
      return value.slice(0, 7).toLowerCase();
    }
    return this.rgbToHex(value);
  }

  rgbToHex(rgb) {
    if (!rgb || rgb === 'rgba(0, 0, 0, 0)' || rgb === 'transparent') {
      return '#ffffff';
    }
    if (rgb.startsWith('#')) {
      return this.normalizeHex(rgb);
    }

    const result = rgb.match(/\d+/g);
    if (!result || result.length < 3) {
      return '#ffffff';
    }

    const r = parseInt(result[0], 10);
    const g = parseInt(result[1], 10);
    const b = parseInt(result[2], 10);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

  toggleFormat(chalkboard, property) {
    const currentFormat = this.getCurrentFormat(chalkboard);
    let newValue;

    switch (property) {
      case 'fontWeight':
        newValue = currentFormat.fontWeight === 'bold' ? 'normal' : 'bold';
        break;
      case 'fontStyle':
        newValue = currentFormat.fontStyle === 'italic' ? 'normal' : 'italic';
        break;
      case 'textDecoration':
        newValue = currentFormat.textDecoration === 'underline' ? 'none' : 'underline';
        break;
      default:
        return;
    }

    this.applyFormat(chalkboard, { [property]: newValue });
  }

  setFontSize(chalkboard, fontSize) {
    const clampedSize = Math.max(8, Math.min(200, fontSize));
    this.applyFormat(chalkboard, { fontSize: clampedSize });
  }

  setColor(chalkboard, color) {
    this.applyFormat(chalkboard, { color });
  }

  cleanupFormatting(chalkboard) {
    if (!chalkboard) {
      return;
    }

    chalkboard.querySelectorAll('span').forEach((span) => {
      if (span.textContent === '' && !span.querySelector('br,img')) {
        span.remove();
      }
    });

    const spans = [...chalkboard.querySelectorAll('span')];
    spans.forEach((span) => {
      const nextSibling = span.nextSibling;
      if (nextSibling && nextSibling.nodeType === Node.ELEMENT_NODE && nextSibling.tagName === 'SPAN') {
        if (this.haveSameFormatting(span, nextSibling)) {
          while (nextSibling.firstChild) {
            span.appendChild(nextSibling.firstChild);
          }
          nextSibling.remove();
        }
      }
    });
  }

  haveSameFormatting(elem1, elem2) {
    const style1 = elem1.style;
    const style2 = elem2.style;
    return style1.fontSize === style2.fontSize &&
      style1.color === style2.color &&
      style1.fontWeight === style2.fontWeight &&
      style1.fontStyle === style2.fontStyle &&
      style1.textDecoration === style2.textDecoration;
  }
}
