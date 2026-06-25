/**
 * MMX Visual Editor — Editor Utilities
 *
 * Utility functions for the editor
 */

import * as codeEditor from "./codeEditor.js";

/**
 * Get current editor content
 * @returns {string} Current editor content
 */
export function getEditorContent() {
  return codeEditor.getEditorContent?.() || "";
}

/**
 * Get current cursor position
 * @returns {{start: number, end: number}} Cursor position
 */
export function getCursorPosition() {
  const range = codeEditor.getSelectionRange?.();
  return range || { start: 0, end: 0 };
}

/**
 * Replace editor content
 * @param {string} content - New content
 */
export function replaceEditorContent(content) {
  codeEditor.setEditorContent?.(content, undefined, true);
}

/**
 * Get editor element reference
 * @returns {HTMLTextAreaElement} Editor element
 */
export function getEditorElement() {
  return codeEditor.getEditorElement?.();
}

/**
 * Check if text is inside a table block
 * @param {string} text - Text to check
 * @param {number} position - Position in text
 * @returns {boolean} True if inside table block
 */
export function isInsideTableBlock(text, position) {
  if (!text || position < 0) return false;
  
  // Find nearest #table block around position
  const beforeText = text.substring(0, position);
  const tableRegex = /#table(?:\(([^)]+)\))?(?:\s+([^\n]+))?/g;
  
  let tableStart = -1;
  let tableEnd = -1;
  
  // Search for #table before position
  let match;
  while ((match = tableRegex.exec(beforeText)) !== null) {
    tableStart = match.index;
    
    // Find matching #endtable
    const remainingText = text.substring(tableStart);
    const endTableMatch = remainingText.match(/^#endtable\s*$/gm);
    
    if (endTableMatch) {
      const endTableIndex = remainingText.indexOf(endTableMatch[0]);
      tableEnd = tableStart + endTableIndex + endTableMatch[0].length;
      
      // Check if position is inside this table
      if (position > tableStart && position < tableEnd) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Get table block info at position
 * @param {string} text - Text to search
 * @param {number} position - Position to search around
 * @returns {Object|null} Table block info or null
 */
export function getTableBlockInfo(text, position) {
  if (!text || position < 0) return null;
  
  const beforeText = text.substring(0, position);
  const tableRegex = /#table(?:\(([^)]+)\))?(?:\s+([^\n]+))?/g;
  
  let tableStart = -1;
  let tableEnd = -1;
  let tableMode = 'v';
  let tableClasses = '';
  
  // Search for #table before position
  let match;
  while ((match = tableRegex.exec(beforeText)) !== null) {
    tableStart = match.index;
    
    if (match[1]) tableMode = match[1]; // mode in parentheses
    if (match[2]) tableClasses = match[2]; // classes after mode
    
    // Find matching #endtable
    const remainingText = text.substring(tableStart);
    const endTableMatch = remainingText.match(/^#endtable\s*$/gm);
    
    if (endTableMatch) {
      const endTableIndex = remainingText.indexOf(endTableMatch[0]);
      tableEnd = tableStart + endTableIndex + endTableMatch[0].length;
      
      // Check if position is inside this table
      if (position > tableStart && position < tableEnd) {
        const tableContent = text.substring(tableStart, tableEnd);
        return {
          start: tableStart,
          end: tableEnd,
          content: tableContent,
          mode: tableMode,
          classes: tableClasses,
        };
      }
    }
  }
  
  return null;
}

/**
 * Check if an element is at the beginning of a line (no preceding characters except newline)
 * @param {string} editorContent - Full editor content
 * @param {number} elementStart - Position of element
 * @returns {boolean} True if element is at line start
 */
function isElementAtLineStart(editorContent, elementStart) {
  if (elementStart === 0) return true; // At beginning of content
  const charBefore = editorContent[elementStart - 1];
  return charBefore === '\n';
}

/**
 * Check if position is inside a :::code block
 * @param {string} editorContent - Full editor content
 * @param {number} position - Position to check
 * @returns {boolean} True if inside :::code block
 */
function isInsideCodeBlock(editorContent, position) {
  const textBefore = editorContent.substring(0, position);
  const lines = textBefore.split('\n');
  let insideCode = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === ':::code') {
      insideCode = true;
    } else if (trimmed === ':::') {
      insideCode = false;
    }
  }
  return insideCode;
}

/**
 * Check if #table is at the beginning of a line (no preceding characters except newline)
 * @param {string} editorContent - Full editor content
 * @param {number} tableStart - Position of #table
 * @returns {boolean} True if #table is at line start
 */
function isTableAtLineStart(editorContent, tableStart) {
  return isElementAtLineStart(editorContent, tableStart);
}

/**
 * Find all tables in the editor content and return their positions
 * @param {string} editorContent - Full editor content
 * @returns {Array} Array of table objects with start/end positions and line numbers
 */
export function findAllTables(editorContent) {
  if (!editorContent) return [];
  
  const tableRegex = /#table(?:\(([^)]+)\))?(?:\s+([^\n]+))?/g;
  const endTableRegex = /^#endtable\s*$/gm;
  
  let match;
  const tables = [];
  
  while ((match = tableRegex.exec(editorContent)) !== null) {
    const currentTableStart = match.index;
    
    // Check if #table is at the beginning of a line
    if (!isTableAtLineStart(editorContent, currentTableStart)) {
      continue; // Skip tables not at line start
    }
    // Check if #table is inside a :::code block
    if (isInsideCodeBlock(editorContent, currentTableStart)) {
      continue; // Skip tables inside code blocks
    }
    
    // Find matching #endtable
    const remainingText = editorContent.substring(currentTableStart);
    const endTableMatch = remainingText.match(endTableRegex);
    
    if (endTableMatch) {
      const endTableIndex = remainingText.indexOf(endTableMatch[0]);
      const currentTableEnd = currentTableStart + endTableIndex + endTableMatch[0].length;
      
      // Calculate line number (1-based)
      const textBeforeTable = editorContent.substring(0, currentTableStart);
      const startLineNumber = textBeforeTable.split('\n').length;
      
      // Calculate end line number
      const textBeforeEnd = editorContent.substring(0, currentTableEnd);
      const endLineNumber = textBeforeEnd.split('\n').length;
      
      // Store table info
      tables.push({
        start: currentTableStart,
        end: currentTableEnd,
        startLine: startLineNumber,
        endLine: endLineNumber,
        mode: match[1] || 'h',
        classes: ((match[2] || '').includes('|') ? '' : (match[2] || '').trim()),
        fullMatch: match[0]
      });
    }
  }
  
  // Sort tables by start position
  tables.sort((a, b) => a.start - b.start);
  
  return tables;
}

/**
 * Find all MMX elements in the editor content and return their positions
 * @param {string} editorContent - Full editor content
 * @returns {Array} Array of element objects with start/end positions and line numbers
 */
export function findAllElements(editorContent) {
  if (!editorContent) return [];
  
  const elements = [];
  
  // Find all tables (multi-line blocks with #table ... #endtable)
  const tableRegex = /#table(?:\(([^)]+)\))?(?:\s+([^\n]+))?/g;
  const endTableRegex = /^#endtable\s*$/gm;
  
  let match;
  while ((match = tableRegex.exec(editorContent)) !== null) {
    const currentTableStart = match.index;
    
    // Check if #table is at the beginning of a line
    if (!isTableAtLineStart(editorContent, currentTableStart)) {
      continue; // Skip tables not at line start
    }
    // Check if #table is inside a :::code block
    if (isInsideCodeBlock(editorContent, currentTableStart)) {
      continue; // Skip tables inside code blocks
    }
    
    // Find matching #endtable
    const remainingText = editorContent.substring(currentTableStart);
    const endTableMatch = remainingText.match(endTableRegex);
    
    if (endTableMatch) {
      const endTableIndex = remainingText.indexOf(endTableMatch[0]);
      const currentTableEnd = currentTableStart + endTableIndex + endTableMatch[0].length;
      
      // Calculate line number (1-based)
      const textBeforeTable = editorContent.substring(0, currentTableStart);
      const startLineNumber = textBeforeTable.split('\n').length;
      
      // Calculate end line number
      const textBeforeEnd = editorContent.substring(0, currentTableEnd);
      const endLineNumber = textBeforeEnd.split('\n').length;
      
      // Store table info
      elements.push({
        start: currentTableStart,
        end: currentTableEnd,
        startLine: startLineNumber,
        endLine: endLineNumber,
        mode: match[1] || 'h',
        classes: ((match[2] || '').includes('|') ? '' : (match[2] || '').trim()),
        fullMatch: match[0],
        type: 'table'
      });
    }
  }
  
  // Find single-line elements (images, videos, audios, links) using separate regex for each type
  
  // Images: ![alt](path) [classes] (classes must be valid CSS class names)
  // Only capture classes when followed by end-of-line or another MMX element
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)(?:\s+([a-zA-Z_][a-zA-Z0-9_-]*)(?=\s*(?:$|!!!\(|!!\(|!\[|\[)))?/g;
  let imageMatch;
  while ((imageMatch = imageRegex.exec(editorContent)) !== null) {
    if (isInsideTableBlock(editorContent, imageMatch.index)) continue;
    // Check if image is at the beginning of a line
    if (!isElementAtLineStart(editorContent, imageMatch.index)) continue;
    // Check if image is inside a :::code block
    if (isInsideCodeBlock(editorContent, imageMatch.index)) continue;
    
    const textBeforeMatch = editorContent.substring(0, imageMatch.index);
    const lineNumber = textBeforeMatch.split('\n').length;
    
    elements.push({
      start: imageMatch.index,
      end: imageMatch.index + imageMatch[0].length,
      startLine: lineNumber,
      endLine: lineNumber,
      content: imageMatch[0],
      type: 'image',
      alt: imageMatch[1],
      path: imageMatch[2],
      classes: (imageMatch[3] || '').trim(),
      fullMatch: imageMatch[0]
    });
  }
  
  // Videos: !!(path) [classes] (negative lookbehind to avoid matching !!!; classes must be valid CSS class names)
  // Only capture classes when followed by end-of-line or another MMX element
  const videoRegex = /(?<!!)!!\(([^)]+)\)(?:\s+([a-zA-Z_][a-zA-Z0-9_-]*)(?=\s*(?:$|!!!\(|!!\(|!\[|\[)))?/g;
  let videoMatch;
  while ((videoMatch = videoRegex.exec(editorContent)) !== null) {
    if (isInsideTableBlock(editorContent, videoMatch.index)) continue;
    // Check if video is at the beginning of a line
    if (!isElementAtLineStart(editorContent, videoMatch.index)) continue;
    // Check if video is inside a :::code block
    if (isInsideCodeBlock(editorContent, videoMatch.index)) continue;
    
    const textBeforeMatch = editorContent.substring(0, videoMatch.index);
    const lineNumber = textBeforeMatch.split('\n').length;
    
    elements.push({
      start: videoMatch.index,
      end: videoMatch.index + videoMatch[0].length,
      startLine: lineNumber,
      endLine: lineNumber,
      content: videoMatch[0],
      type: 'video',
      path: videoMatch[1],
      classes: (videoMatch[2] || '').trim(),
      fullMatch: videoMatch[0]
    });
  }
  
  // Audios: !!!(path) [classes] (classes must be valid CSS class names)
  // Only capture classes when followed by end-of-line or another MMX element
  const audioRegex = /!!!\(([^)]+)\)(?:\s+([a-zA-Z_][a-zA-Z0-9_-]*)(?=\s*(?:$|!!!\(|!!\(|!\[|\[)))?/g;
  let audioMatch;
  while ((audioMatch = audioRegex.exec(editorContent)) !== null) {
    if (isInsideTableBlock(editorContent, audioMatch.index)) continue;
    // Check if audio is at the beginning of a line
    if (!isElementAtLineStart(editorContent, audioMatch.index)) continue;
    // Check if audio is inside a :::code block
    if (isInsideCodeBlock(editorContent, audioMatch.index)) continue;
    
    const textBeforeMatch = editorContent.substring(0, audioMatch.index);
    const lineNumber = textBeforeMatch.split('\n').length;
    
    elements.push({
      start: audioMatch.index,
      end: audioMatch.index + audioMatch[0].length,
      startLine: lineNumber,
      endLine: lineNumber,
      content: audioMatch[0],
      type: 'audio',
      path: audioMatch[1],
      classes: (audioMatch[2] || '').trim(),
      fullMatch: audioMatch[0]
    });
  }
  
  // Code file includes: #code(path) [flags]
  const codeRegex = /^#code\((.+?)\)(?:[ \t]+([^\n]+))?\s*$/gm;
  let codeMatch;
  while ((codeMatch = codeRegex.exec(editorContent)) !== null) {
    if (isInsideTableBlock(editorContent, codeMatch.index)) continue;
    // Check if #code is inside a :::code block
    if (isInsideCodeBlock(editorContent, codeMatch.index)) continue;
    
    const textBeforeMatch = editorContent.substring(0, codeMatch.index);
    const lineNumber = textBeforeMatch.split('\n').length;
    
    const flags = (codeMatch[2] || '').trim();
    
    elements.push({
      start: codeMatch.index,
      end: codeMatch.index + codeMatch[0].length,
      startLine: lineNumber,
      endLine: lineNumber,
      content: codeMatch[0],
      type: 'code',
      path: codeMatch[1],
      flags: flags,
      fullMatch: codeMatch[0]
    });
  }

  // Links: [text](url) [classes] (classes must be valid CSS class names; avoid matching image syntax \![alt](path))
  // Only capture classes when followed by end-of-line or another MMX element
  const linkRegex = /(?<!!)\[([^\]]+)\]\(([^)]+)\)(?:\s+([a-zA-Z_][a-zA-Z0-9_-]*)(?=\s*(?:$|!!!\(|!!\(|!\[|\[)))?/g;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(editorContent)) !== null) {
    if (isInsideTableBlock(editorContent, linkMatch.index)) continue;
    // Check if link is inside a :::code block
    if (isInsideCodeBlock(editorContent, linkMatch.index)) continue;
    
    const textBeforeMatch = editorContent.substring(0, linkMatch.index);
    const lineNumber = textBeforeMatch.split('\n').length;
    
    elements.push({
      start: linkMatch.index,
      end: linkMatch.index + linkMatch[0].length,
      startLine: lineNumber,
      endLine: lineNumber,
      content: linkMatch[0],
      type: 'link',
      text: linkMatch[1],
      url: linkMatch[2],
      classes: (linkMatch[3] || '').trim(),
      fullMatch: linkMatch[0]
    });
  }

  // Inline images: <-path-> (can appear anywhere in text, not just at line start)
  const inlineImageRegex = /<-([^>]+)->/g;
  let inlineImgMatch;
  while ((inlineImgMatch = inlineImageRegex.exec(editorContent)) !== null) {
    if (isInsideTableBlock(editorContent, inlineImgMatch.index)) continue;
    // Check if inline image is inside a :::code block
    if (isInsideCodeBlock(editorContent, inlineImgMatch.index)) continue;
    
    const textBeforeMatch = editorContent.substring(0, inlineImgMatch.index);
    const lineNumber = textBeforeMatch.split('\n').length;
    
    elements.push({
      start: inlineImgMatch.index,
      end: inlineImgMatch.index + inlineImgMatch[0].length,
      startLine: lineNumber,
      endLine: lineNumber,
      content: inlineImgMatch[0],
      type: 'inlineimage',
      path: inlineImgMatch[1],
      fullMatch: inlineImgMatch[0]
    });
  }
  
  // Sort by start position
  elements.sort((a, b) => a.start - b.start);
  
  return elements;
}

/**
 * Find all tables including incomplete ones (missing #endtable)
 * @param {string} editorContent - Full editor content
 * @returns {Array} Array of table objects with start/end positions, line numbers, and isComplete flag
 */
export function findAllTablesWithCompletion(editorContent) {
  if (!editorContent) return [];
  
  const tableRegex = /#table(?:\(([^)]+)\))?(?:\s+([^\n]+))?/g;
  const endTableRegex = /^#endtable\s*$/gm;
  
  let match;
  const tables = [];
  const allTableStarts = [];
  
  // First, find all #table starts
  while ((match = tableRegex.exec(editorContent)) !== null) {
    const currentTableStart = match.index;
    
    // Check if #table is at the beginning of a line
    if (!isTableAtLineStart(editorContent, currentTableStart)) {
      continue; // Skip tables not at line start
    }
    
    // Check if #table is inside a :::code block
    if (isInsideCodeBlock(editorContent, currentTableStart)) {
      continue; // Skip tables inside code blocks
    }
    
    allTableStarts.push({
      start: currentTableStart,
      mode: match[1] || 'h',
      classes: (match[2] || '').trim(),
      fullMatch: match[0]
    });
  }
  
  // For each table start, find matching #endtable
  for (const tableStart of allTableStarts) {
    const remainingText = editorContent.substring(tableStart.start);
    const endTableMatch = remainingText.match(endTableRegex);
    
    if (endTableMatch) {
      const endTableIndex = remainingText.indexOf(endTableMatch[0]);
      const currentTableEnd = tableStart.start + endTableIndex + endTableMatch[0].length;
      
      // Calculate line number (1-based)
      const textBeforeTable = editorContent.substring(0, tableStart.start);
      const startLineNumber = textBeforeTable.split('\n').length;
      
      // Calculate end line number
      const textBeforeEnd = editorContent.substring(0, currentTableEnd);
      const endLineNumber = textBeforeEnd.split('\n').length;
      
      tables.push({
        start: tableStart.start,
        end: currentTableEnd,
        startLine: startLineNumber,
        endLine: endLineNumber,
        mode: tableStart.mode,
        classes: tableStart.classes,
        fullMatch: tableStart.fullMatch,
        isComplete: true
      });
    } else {
      // Incomplete table - no #endtable found
      const textBeforeTable = editorContent.substring(0, tableStart.start);
      const startLineNumber = textBeforeTable.split('\n').length;
      
      tables.push({
        start: tableStart.start,
        end: tableStart.start + tableStart.fullMatch.length,
        startLine: startLineNumber,
        endLine: startLineNumber,
        mode: tableStart.mode,
        classes: tableStart.classes,
        fullMatch: tableStart.fullMatch,
        isComplete: false
      });
    }
  }
  
  // Sort tables by start position
  tables.sort((a, b) => a.start - b.start);
  
  return tables;
}

/**
 * Check if all tables in the content are complete (have #endtable)
 * @param {string} editorContent - Full editor content
 * @returns {Object} Object with isValid flag and incompleteTables array
 */
export function checkTableCompletion(editorContent) {
  const tables = findAllTablesWithCompletion(editorContent);
  const incompleteTables = tables.filter(t => !t.isComplete);
  
  return {
    isValid: incompleteTables.length === 0,
    incompleteTables,
    totalTables: tables.length,
    completeTables: tables.filter(t => t.isComplete).length
  };
}