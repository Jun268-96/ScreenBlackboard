/**
 * Simple Text Formatter for Chalkboard App
 * Based on standard whiteboard/drawing app patterns
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
    
    // IME composition tracking for Korean input
    this.isComposing = false;
    this.compositionData = '';
  }

  // Apply formatting to selected text or set formatting for new text
  applyFormat(chalkboard, format) {
    const selection = window.getSelection();
    const hasSelection = selection && selection.rangeCount > 0;
    const range = hasSelection ? selection.getRangeAt(0) : null;
    const selectionInBoard = range ? this.isRangeInsideChalkboard(chalkboard, range) : false;

    if (range && selectionInBoard && !range.collapsed) {
      // Text is selected - apply format to selection
      const applied = this.formatSelection(range, format);
      if (!applied) {
        this.setTypingFormat(chalkboard, format);
      }
    } else {
      // No valid text selection - set format for future typing
      this.setTypingFormat(chalkboard, format);
    }
    
    // Update current format state
    Object.assign(this.currentFormat, format);
    
    // Maintain focus on chalkboard
    chalkboard.focus();
  }

  // Set format for text that will be typed
  setTypingFormat(chalkboard, format) {
    // Store format in a data attribute on the chalkboard
    const formatData = { ...this.currentFormat, ...format };
    chalkboard.dataset.currentFormat = JSON.stringify(formatData);
    
    // Also apply to chalkboard style for immediate visual feedback
    if (format.fontSize) {
      chalkboard.style.fontSize = `${format.fontSize}px`;
      chalkboard.style.lineHeight = this.calculateLineHeight(format.fontSize);
    }
    if (format.color) {
      chalkboard.style.color = format.color;
    }
  }

  // Apply format to selected text
  formatSelection(range, format) {
    try {
      // Extract the selected content
      const contents = range.extractContents();
      if (!contents || !contents.hasChildNodes()) {
        return false;
      }
      
      // Create a wrapper span with the new formatting
      const wrapper = document.createElement('span');
      this.applyStylesToElement(wrapper, format);
      
      // Move the content into the wrapper
      wrapper.appendChild(contents);
      
      // Insert the formatted content back
      range.insertNode(wrapper);
      
      // Keep selection on newly formatted content so repeated adjustments are easy
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

  isRangeInsideChalkboard(chalkboard, range) {
    if (!chalkboard || !range) {
      return false;
    }
    const container = range.commonAncestorContainer;
    return container === chalkboard || chalkboard.contains(container);
  }

  // Apply styles to an element
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

  // Calculate optimal line height based on font size
  calculateLineHeight(fontSize) {
    const size = parseInt(fontSize);
    if (size <= 18) return '1.6';
    if (size <= 24) return '1.5';
    if (size <= 36) return '1.4';
    if (size <= 48) return '1.35';
    if (size <= 72) return '1.3';
    if (size <= 96) return '1.25';
    return '1.2';
  }

  // Handle typing with current format (Korean input compatible)
  handleInput(event) {
    const chalkboard = event.target;
    const formatData = chalkboard.dataset.currentFormat;
    
    // Skip formatting during Korean composition or deletion
    if (this.isComposing || event.inputType === 'deleteContentBackward') {
      return;
    }
    
    if (formatData) {
      try {
        const format = JSON.parse(formatData);
        
        // Apply formatting to newly typed content
        setTimeout(() => {
          this.formatRecentInput(chalkboard, format);
        }, 10);
      } catch (error) {
        console.error('Error parsing format data:', error);
      }
    }
  }

  // Handle composition start (Korean IME)
  handleCompositionStart(event) {
    this.isComposing = true;
    this.compositionData = '';
  }

  // Handle composition update (Korean IME)
  handleCompositionUpdate(event) {
    this.compositionData = event.data || '';
  }

  // Handle composition end (Korean IME)
  handleCompositionEnd(event) {
    this.isComposing = false;
    const chalkboard = event.target;
    const formatData = chalkboard.dataset.currentFormat;
    
    // Apply formatting to completed Korean text
    if (formatData && event.data) {
      try {
        const format = JSON.parse(formatData);
        setTimeout(() => {
          this.formatRecentInput(chalkboard, format);
        }, 20); // Slightly longer delay for Korean text
      } catch (error) {
        console.error('Error parsing format data:', error);
      }
    }
  }

  // Format recently typed text (Korean-safe)
  formatRecentInput(chalkboard, format) {
    // Skip if currently composing (safety check)
    if (this.isComposing) return;
    
    const selection = window.getSelection();
    if (selection.rangeCount === 0) return;

    // Find the text node at cursor position
    const range = selection.getRangeAt(0);
    const textNode = range.startContainer;
    
    if (textNode.nodeType === Node.TEXT_NODE && textNode.textContent.length > 0) {
      // Only format if this is a plain text node (not already in a formatted span)
      if (!textNode.parentElement || textNode.parentElement === chalkboard) {
        const text = textNode.textContent;
        
        // Skip empty or whitespace-only text
        if (!text.trim()) return;
        
        // Create formatted span
        const span = document.createElement('span');
        this.applyStylesToElement(span, format);
        span.textContent = text;
        
        // Replace text node with formatted span
        textNode.parentNode.replaceChild(span, textNode);
        
        // Restore cursor position safely
        try {
          if (span.firstChild) {
            range.setStart(span.firstChild, text.length);
            range.setEnd(span.firstChild, text.length);
            selection.removeAllRanges();
            selection.addRange(range);
          }
        } catch (error) {
          console.warn('Could not restore cursor position:', error);
          // Fallback: just focus the chalkboard
          chalkboard.focus();
        }
      }
    }
  }

  // Get the current format at cursor position
  getCurrentFormat(chalkboard) {
    const selection = window.getSelection();
    
    if (selection.rangeCount === 0) {
      return this.currentFormat;
    }

    const range = selection.getRangeAt(0);
    let element = range.startContainer;
    
    // If it's a text node, get its parent element
    if (element.nodeType === Node.TEXT_NODE) {
      element = element.parentElement;
    }

    // If we're directly in the chalkboard, use current format
    if (element === chalkboard) {
      return this.currentFormat;
    }

    // Extract format from the element
    const computedStyle = window.getComputedStyle(element);
    return {
      fontSize: parseInt(computedStyle.fontSize) || this.currentFormat.fontSize,
      color: this.rgbToHex(computedStyle.color) || this.currentFormat.color,
      fontWeight: computedStyle.fontWeight || this.currentFormat.fontWeight,
      fontStyle: computedStyle.fontStyle || this.currentFormat.fontStyle,
      textDecoration: computedStyle.textDecoration || this.currentFormat.textDecoration
    };
  }

  // Convert RGB color to hex
  rgbToHex(rgb) {
    if (!rgb || rgb === 'rgba(0, 0, 0, 0)') return '#ffffff';
    
    const result = rgb.match(/\d+/g);
    if (!result || result.length < 3) return '#ffffff';
    
    const r = parseInt(result[0]);
    const g = parseInt(result[1]);
    const b = parseInt(result[2]);
    
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  // Toggle formatting (for bold, italic, underline)
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

  // Set font size
  setFontSize(chalkboard, fontSize) {
    const clampedSize = Math.max(8, Math.min(200, fontSize));
    this.applyFormat(chalkboard, { fontSize: clampedSize });
  }

  // Set text color
  setColor(chalkboard, color) {
    this.applyFormat(chalkboard, { color });
  }

  // Clean up excessive formatting spans (optimization)
  cleanupFormatting(chalkboard) {
    const spans = chalkboard.querySelectorAll('span');
    
    spans.forEach(span => {
      // Remove empty spans
      if (!span.textContent.trim()) {
        span.remove();
        return;
      }
      
      // Merge adjacent spans with identical formatting
      const nextSibling = span.nextSibling;
      if (nextSibling && nextSibling.tagName === 'SPAN') {
        if (this.haveSameFormatting(span, nextSibling)) {
          span.textContent += nextSibling.textContent;
          nextSibling.remove();
        }
      }
    });
  }

  // Check if two elements have the same formatting
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
