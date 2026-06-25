/**
 * MMX Visual Editor — Table Editor
 *
 * Clean, standalone table editor module with full MMX table support.
 *
 * Features:
 * - Detects tables when clicking/placing cursor in MMX tables (`#table` ... `#endtable`) in the code editor
 * - Opens a visual popup with editable grid (`dialogTableEditor` in HTML)
 * - Allows editing cell content directly via input fields in each cell
 * - Supports structure operations: Add/remove rows/columns via toolbar buttons
 * - Handles table properties: Mode selector (v/h/b) and CSS classes input
 * - Optimizes large tables (6+ rows or 8+ columns) with virtualized rendering
 * - Only works in code editor - NOT in preview panel
 * - Saves changes back to MMX syntax in the editor textarea
 */

import { showDialog, hideDialog } from "./dialogs.js";
import { showToast } from "./utils.js";
import { getEditorContent, getCursorPosition, replaceEditorContent, getEditorElement, findAllTables } from "./editorUtils.js";

// ─── State ───────────────────────────────────────────────────────────────────

let currentTableBlock = null; // { start, end, content, mode, classes }
let tablePopupVisible = false;
let useOptimizedRenderer = false; // For large tables
let currentTableData = null; // Parsed table data structure
let isInitialized = false; // Track if event listeners are set up
// Track the last active table cell input for formatting actions
let lastActiveTableInput = null;

// ─── Table Detection & Initialization ───────────────────────────────────────

/**
 * Detect if cursor is inside a table block
 * @returns {Object|null} Table block info or null
 */
function detectTableAtCursor() {
  const editorContent = getEditorContent();
  const cursorPos = getCursorPosition();
  
  if (!cursorPos || editorContent.length === 0) {
    return null;
  }
  
  const textBeforeCursor = editorContent.substring(0, cursorPos.start);
  
  // Find the nearest #table block around cursor
  const tableRegex = /#table(?:\(([^)]+)\))?(?:\s+([^\n]+))?/g;
  const endTableRegex = /^#endtable\s*$/gm;
  
  let tableStart = -1;
  let tableEnd = -1;
  let tableMode = 'h';
  let tableClasses = '';
  
  // Search backwards for #table
    const tableMatches = [...textBeforeCursor.matchAll(tableRegex)];
    if (tableMatches.length > 0) {
      // Use the exact index of the last matched #table occurrence
      const lastTableMatch = tableMatches[tableMatches.length - 1];
      tableStart = lastTableMatch.index;
      
      // Parse mode and classes from the last match
    if (lastTableMatch[1]) tableMode = lastTableMatch[1]; // mode in parentheses
    if (lastTableMatch[2]) tableClasses = lastTableMatch[2].trim(); // classes after mode
    
    // Find matching #endtable
    const remainingText = editorContent.substring(tableStart);
    const endTableMatch = remainingText.match(endTableRegex);
    if (endTableMatch) {
      const endTableIndex = remainingText.indexOf(endTableMatch[0]);
      tableEnd = tableStart + endTableIndex + endTableMatch[0].length;
      
      // Verify cursor is inside table bounds
      if (cursorPos.start > tableStart && cursorPos.start < tableEnd) {
            // Ensure #table is at the beginning of a line (no preceding characters except newline)
            const lineStartIdx = editorContent.lastIndexOf('\\n', tableStart - 1) + 1;
            if (lineStartIdx !== tableStart) {
              // #table not at line start – ignore detection
              return null;
            }

            // If the line containing #table has backticks, treat it as inline code and ignore
            const lineEndIdx = editorContent.indexOf('\\n', tableStart);
            const lineText = editorContent.substring(lineStartIdx, lineEndIdx === -1 ? editorContent.length : lineEndIdx);
            if (lineText.includes('`')) {
              return null;
            }

            // Also ignore if cursor is inside inline code delimited by backticks (`)
            const backticksUpToCursor = (editorContent.substring(0, cursorPos.start).match(/`/g) || []).length;
            if (backticksUpToCursor % 2 === 1) {
              return null;
            }

            // Also ignore if #table is inside a fenced code block (``` ... ```)
            const fencedBefore = (editorContent.substring(0, tableStart).match(/```/g) || []).length;
            if (fencedBefore % 2 === 1) {
              return null;
            }

            // Also ignore if #table is inside a custom :::code block
            const codeBlockOpens = (editorContent.substring(0, tableStart).match(/:::code/g) || []).length;
            const codeBlockCloses = (editorContent.substring(0, tableStart).match(/:::/g) || []).length;
            // If there are more opens than closes, we are inside a :::code block
            if (codeBlockOpens > codeBlockCloses) {
              return null;
            }

            const tableContent = editorContent.substring(tableStart, tableEnd);
            // Ensure the block actually contains table rows (at least one line with two pipes)
            const lines = tableContent.split('\n');
            const hasTableRow = lines.some(line => /\|.*\|/.test(line));
            if (!hasTableRow) {
              // No valid table rows – likely not a real table, ignore detection
              return null;
            }
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
 * Initialize table editing functionality with enhanced detection
 */
function initTableEditor() {
  if (isInitialized) return;
  isInitialized = true;
  
  // Add click listener to editor for table detection
  const editorElement = getEditorElement();
  if (editorElement) {
    editorElement.addEventListener('click', handleEditorClick);
    editorElement.addEventListener('keyup', handleEditorKeyUp);
  }
  
  // Listen for table edit events from toolbar
  window.addEventListener('edit-table', (e) => {
    openTableEditor(e.detail);
  });
  
  // Add event listener for Edit Table button
  const editTableBtn = document.getElementById('editTableBtn');
  if (editTableBtn) {
    editTableBtn.addEventListener('click', () => {
      const table = detectTableAtCursor();
      if (table) {
        openTableEditor(table);
      } else {
        showToast('No table found at cursor position', 'warning');
      }
    });
  }
  
  // Listen for dialog show event to initialize table editor
  const tableEditorDialog = document.getElementById('dialogTableEditor');
  if (tableEditorDialog) {
    tableEditorDialog.addEventListener('show', () => {
      if (currentTableBlock) {
        initializeTableEditor(currentTableBlock);
      }
    });
    
    // Listen for dialog hide to save changes and clean up
    tableEditorDialog.addEventListener('hide', () => {
      // Save changes before hiding if there's data to save
      if (currentTableBlock && currentTableData) {
        saveTableChanges();
      }
      tablePopupVisible = false;
      currentTableBlock = null;
      currentTableData = null;
      useOptimizedRenderer = false;
    });
  }
  
  // Set up toolbar button listeners
  setupToolbarListeners();
  
  // Set up save/cancel buttons
  setupDialogButtons();
  
  // Set up format toolbar
  setupFormatToolbar();
  
  // Set up mode/classes change listeners
  setupPropertyListeners();
  
  console.log('Table editor initialized with enhanced detection');
}

/**
 * Override the default initTableEditor with enhanced version
 * This function should replace the existing initTableEditor
 * when this file is loaded by the application
 */
export { initTableEditor, handleEditorClick, handleEditorKeyUp, openTableEditor };

/**
 * Set up toolbar button event listeners
 */
function setupToolbarListeners() {
  const addRowBtn = document.getElementById('tableEditorAddRow');
  const addColBtn = document.getElementById('tableEditorAddCol');
  const delRowBtn = document.getElementById('tableEditorDelRow');
  const delColBtn = document.getElementById('tableEditorDelCol');
  
  if (addRowBtn) addRowBtn.addEventListener('click', addRow);
  if (addColBtn) addColBtn.addEventListener('click', addColumn);
  if (delRowBtn) delRowBtn.addEventListener('click', deleteRow);
  if (delColBtn) delColBtn.addEventListener('click', deleteColumn);
}

/**
 * Set up format toolbar button event listeners
 */
function setupFormatToolbar() {
  document.querySelectorAll('.fmt-btn').forEach(btn => {
    // Capture active input on mousedown (before focus might be lost on click)
    // This is needed for ALL format buttons, not just the color button
    btn.addEventListener('mousedown', () => {
      const activeInput = document.querySelector('.table-cell-input:focus');
      if (activeInput) {
        window.lastActiveTableInput = activeInput;
      }
    });

    if (btn.id === 'teColorBtn') {
      btn.addEventListener('click', (e) => {
        if (typeof window.showColorPopup === 'function') {
          window.showColorPopup(btn);
        }
      });
      return;
    }

    btn.addEventListener('click', () => {
      const fmt = btn.dataset.fmt;
      // Use the focused input if available, otherwise fall back to the last active input
      let activeInput = document.querySelector('.table-cell-input:focus');
      if (!activeInput && typeof window.lastActiveTableInput !== 'undefined') {
        activeInput = window.lastActiveTableInput;
      }
      if (!activeInput) {
        showToast('Click on a cell first', 'warning');
        return;
      }
      applyFormatting(activeInput, fmt);
    });
  });
}

/**
 * Apply MMX formatting to an input field
 * @param {HTMLInputElement} input - The input element
 * @param {string} fmt - Format type (bold, italic, strike, underline)
 */
function applyFormatting(input, fmt) {
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const text = input.value;
  const selected = text.substring(start, end) || 'text';
  
  let formatted = '';
  switch (fmt) {
    case 'bold': formatted = `**${selected}**`; break;
    case 'italic': formatted = `*${selected}*`; break;
    case 'strike': formatted = `~~${selected}~~`; break;
    case 'underline': formatted = `__${selected}__`; break;
    default: return;
  }
  
  const newCursor = start + formatted.length;
  input.setRangeText(formatted, start, end, 'end');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
  input.setSelectionRange(newCursor, newCursor);
}



/**
 * Set up dialog button event listeners
 */
function setupDialogButtons() {
  const saveBtn = document.getElementById('tableEditorSaveBtn');
  const closeBtn = document.querySelector('#dialogTableEditor .dialog-close');
  const overlay = document.getElementById('dialogOverlay');
  
  if (saveBtn) saveBtn.addEventListener('click', () => {
    saveTableChanges();
    // Clear state before hiding so the hide event listener doesn't save again
    currentTableBlock = null;
    currentTableData = null;
    hideDialog('dialogTableEditor');
  });
  
  // Maximize toggle
  const maximizeBtn = document.getElementById('tableEditorMaximize');
  if (maximizeBtn) {
    maximizeBtn.addEventListener('click', () => {
      const dialog = document.getElementById('dialogTableEditor');
      dialog.classList.toggle('te-maximized');
      // Re-render on maximize to fill space
      setTimeout(() => {
        if (currentTableData) {
          if (useOptimizedRenderer) {
            renderTableOptimized(currentTableData);
          } else {
            renderTableStandard(currentTableData);
          }
        }
      }, 50);
    });
  }
  
  if (closeBtn) closeBtn.addEventListener('click', () => {
    hideDialog('dialogTableEditor');
  });
  
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      // Only close if clicking overlay directly (not dialog content)
      if (e.target === overlay && tablePopupVisible) {
        hideDialog('dialogTableEditor');
      }
    });
  }
  
  // Escape key to close - handled globally in dialogs.js via hide event
}

/**
 * Set up mode and classes change listeners
 */
function setupPropertyListeners() {
  const modeSelect = document.getElementById('tableEditorMode');
  const classesInput = document.getElementById('tableEditorClasses');
  
  if (modeSelect) {
    modeSelect.addEventListener('change', () => {
      if (currentTableData) {
        currentTableData.mode = modeSelect.value;
        // Re-render the grid to reflect the new mode
        if (useOptimizedRenderer) {
          renderTableOptimized(currentTableData);
        } else {
          renderTableStandard(currentTableData);
        }
        showToast('Table mode updated', 'success');
      }
    });
  }
  
  if (classesInput) {
    classesInput.addEventListener('input', () => {
      if (currentTableData) {
        currentTableData.classes = classesInput.value.trim();
        showToast('Table classes updated', 'success');
      }
    });
  }
}

/**
 * Handle click in editor to detect tables (but not open editor automatically)
 * The editor opens when user clicks the "Edit Table" toolbar button
 */
function handleEditorClick(e) {
  if (tablePopupVisible) return; // Don't interfere with existing popups
  
  // Small delay to ensure cursor is positioned
  setTimeout(() => {
    detectTableAtCursor(); // Just detect, don't open
  }, 50);
}

/**
 * Handle keyup to detect table navigation (but not open editor automatically)
 */
function handleEditorKeyUp(e) {
  if (tablePopupVisible) return;
  
  // Check if we're moving around in the editor
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
    setTimeout(() => {
      detectTableAtCursor(); // Just detect, don't open
    }, 100);
  }
}

/**
 * Open table editor popup
 * @param {Object} table - Table block info
 */
function openTableEditor(table) {
  if (tablePopupVisible) return;
  
  currentTableBlock = table;
  
  // Analyze table size for optimization decision
  analyzeTableSize(table);
  
  // Show table editor dialog
  showDialog('dialogTableEditor');
  tablePopupVisible = true;
  
  // Initialize table editor content (will also be triggered by dialog 'show' event)
  initializeTableEditor(table);
  
  // Focus on first editable cell
  setTimeout(() => {
    const firstCell = document.querySelector('.table-cell-editor input');
    if (firstCell) firstCell.focus();
  }, 100);
}

/**
 * Analyze table size and decide on rendering strategy
 * @param {Object} table - Table block info
 */
function analyzeTableSize(table) {
  // Parse table content to get row/col count
  const content = table.content;
  const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#table') && !l.startsWith('#endtable'));
  
  const rows = lines.filter(l => l.includes('|')).length;
  const cols = Math.max(...lines.filter(l => l.includes('|')).map(l => l.split('|').length - 2), 0);
  
  // Use optimized renderer for large tables (30+ rows or 20+ columns)
  useOptimizedRenderer = rows >= 30 || cols >= 20;
  
  console.log(`Table analysis: ${rows}x${cols}, using ${useOptimizedRenderer ? 'optimized' : 'standard'} renderer`);
}

/**
 * Initialize table editor with current table data
 * @param {Object} table - Table block info
 */
function initializeTableEditor(table) {
  try {
    // Parse table content into structured data
    currentTableData = parseTableContent(table.content, table.mode);
    
    // Check if table editor grid exists
    const tableEditorGrid = document.getElementById('tableEditorGrid');
    if (!tableEditorGrid) {
      console.error('tableEditorGrid element not found');
      return;
    }
    
    // Update UI property inputs
    const modeSelect = document.getElementById('tableEditorMode');
    const classesInput = document.getElementById('tableEditorClasses');
    
    if (modeSelect) modeSelect.value = table.mode;
    if (classesInput) classesInput.value = table.classes || '';
    
    // Render table based on size
    if (useOptimizedRenderer) {
      renderTableOptimized(currentTableData);
    } else {
      renderTableStandard(currentTableData);
    }
    
    console.log('Table editor initialized successfully');
  } catch (error) {
    console.error('Error initializing table editor:', error);
    // Reset state on error
    tablePopupVisible = false;
    currentTableBlock = null;
    currentTableData = null;
    hideDialog('dialogTableEditor');
  }
}

/**
 * Parse table content into structured data
 * @param {string} content - Table content (without #table/#endtable)
 * @param {string} mode - Table mode (v, h, b)
 * @returns {Object} Parsed table data
 */
function parseTableContent(content, mode) {
  const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#table') && !l.startsWith('#endtable'));
  
  // Clean and split by pipes
  const cleanLines = lines.map(line => {
    if (mode === 'b' && !line.startsWith('|') && line.match(/^\s+/)) {
      line = '|' + line.replace(/^\s+/, '');
    }
    return line.split('|').map(cell => cell.trim());
  });
  
  // For 'b' mode, ensure the first row has the same number of cells as other rows
  // If the first row has one fewer cell (no leading pipe for the corner), prepend an empty cell
  if (mode === 'b' && cleanLines.length > 1) {
    const maxLen = Math.max(...cleanLines.map(r => r.length));
    if (cleanLines[0].length < maxLen) {
      cleanLines[0].unshift('');
    }
  }
  
  // Remove empty rows
  const rows = cleanLines.filter(row => row.length > 1);
  
  return {
    rows,
    cols: rows.length > 0 ? rows[0].length : 0,
    mode,
    data: rows.map(row => row.map(cell => cell.replace(/^\n+/, '').replace(/\n+$/, ''))),
  };
}

/**
 * Render table in standard mode (simple grid)
 * @param {Object} tableData - Parsed table data
 */
function renderTableStandard(tableData) {
  const container = document.getElementById('tableEditorGrid');
  if (!container) {
    console.error('tableEditorGrid element not found in renderTableStandard');
    return;
  }
  
  // Clear existing content
  container.innerHTML = '<table class="table-editor-grid"><tbody></tbody></table>';
  const tbody = container.querySelector('tbody');
  
  tableData.data.forEach((row, rowIndex) => {
    const tr = document.createElement('tr');
    tr.dataset.row = rowIndex;
    
    row.forEach((cell, colIndex) => {
      const td = document.createElement('td');
      td.dataset.col = colIndex;
      // Detect header cells for visual highlighting
      if (detectHeaderCell(rowIndex, colIndex, tableData.mode)) {
        td.classList.add('table-header-cell');
      }
      // For 'b' mode, the first cell of the first row is the corner (always empty, non-editable)
      if (tableData.mode === 'b' && rowIndex === 0 && colIndex === 0) {
        td.className = 'table-corner-cell';
        td.appendChild(createCornerCell());
      } else {
        td.appendChild(createTableCell(cell, rowIndex, colIndex, tableData.mode));
      }
      tr.appendChild(td);
    });
    
    tbody.appendChild(tr);
  });
}

/**
 * Render table in optimized mode (virtualized for large tables)
 * @param {Object} tableData - Parsed table data
 */
function renderTableOptimized(tableData) {
  const container = document.getElementById('tableEditorGrid');
  if (!container) {
    console.error('tableEditorGrid element not found in renderTableOptimized');
    return;
  }
  
  // Clear existing content
  container.innerHTML = '<table class="table-editor-grid table-editor-grid-optimized"><tbody></tbody></table>';
  const tbody = container.querySelector('tbody');
  
  const maxCells = 50; // Show at most 50 cells
  const totalCells = tableData.data.length * tableData.cols;
  const startRow = Math.max(0, Math.floor((totalCells - maxCells) / tableData.cols));
  
  for (let i = 0; i < tableData.data.length; i++) {
    const row = tableData.data[i];
    const tr = document.createElement('tr');
    tr.dataset.row = i;
    
    for (let j = 0; j < row.length; j++) {
      if (i >= startRow && ((i - startRow) * row.length + j) < maxCells) {
        const td = document.createElement('td');
        td.dataset.col = j;
        // For 'b' mode, the first cell of the first row is the corner
        if (tableData.mode === 'b' && i === 0 && j === 0) {
          td.className = 'table-corner-cell';
          td.appendChild(createCornerCell());
        } else {
          // Detect header cells for visual highlighting
          if (detectHeaderCell(i, j, tableData.mode)) {
            td.classList.add('table-header-cell');
          }
          td.appendChild(createTableCell(row[j], i, j, tableData.mode, true));
        }
        tr.appendChild(td);
      }
    }
    
    tbody.appendChild(tr);
  }
  
  // Add scroll indicator if needed
  if (totalCells > maxCells) {
    const indicatorRow = document.createElement('tr');
    indicatorRow.className = 'table-indicator-row';
    const indicatorCell = document.createElement('td');
    indicatorCell.colSpan = tableData.cols;
    indicatorCell.textContent = `Showing ${maxCells} of ${totalCells} cells (scroll to view more)`;
    indicatorCell.style.textAlign = 'center';
    indicatorCell.style.fontSize = '12px';
    indicatorCell.style.padding = '8px';
    indicatorCell.style.background = '#f0f0f0';
    indicatorRow.appendChild(indicatorCell);
    tbody.appendChild(indicatorRow);
  }
}

/**
 * Create a single table cell editor
 * @param {string} value - Cell content
 * @param {number} rowIndex - Row index
 * @param {number} colIndex - Column index
 * @param {string} mode - Table mode
 * @param {boolean} optimized - Whether this is in optimized mode
 * @returns {HTMLElement} Cell element
 */
function createTableCell(value, rowIndex, colIndex, mode, optimized = false) {
  const cellWrapper = document.createElement('div');
  cellWrapper.className = 'table-cell-editor';
  
  cellWrapper.innerHTML = `
    <input type="text" value="${value}" placeholder="Enter content..." 
           data-row="${rowIndex}" data-col="${colIndex}" 
           class="table-cell-input" ${optimized ? 'size="8"' : 'size="20"'} />
  `;
  
  const input = cellWrapper.querySelector('input');
  
  // Add event listeners for real-time updates (only update internal state, don't save to editor)
  input.addEventListener('input', (e) => {
    updateTableDataFromEditor(e.target);
  });

  // Track focus to know which input was last active for formatting/color actions
  input.addEventListener('focus', () => {
    lastActiveTableInput = input;
    // Expose globally for toolbar color handling
    window.lastActiveTableInput = input;
  });

  // Ensure clicking the cell wrapper focuses the input for proper color/format handling
  cellWrapper.addEventListener('click', () => {
    input.focus();
  });
  
  return cellWrapper;
}

/**
 * Create a corner cell for 'b' mode tables (non-editable, always empty)
 * @returns {HTMLElement} Corner cell element
 */
function createCornerCell() {
  const cellWrapper = document.createElement('div');
  cellWrapper.className = 'table-cell-editor';
  // No input — this cell is always empty and not editable
  return cellWrapper;
}

/**
 * Detect if a cell at (rowIndex, colIndex) is a header cell for the given mode
 * @param {number} rowIndex - Row index
 * @param {number} colIndex - Column index
 * @param {string} mode - Table mode (v, h, b)
 * @returns {boolean} True if the cell is a header
 */
function detectHeaderCell(rowIndex, colIndex, mode) {
  if (mode === 'h') return rowIndex === 0;
  if (mode === 'v') return colIndex === 0;
  if (mode === 'b') return (rowIndex === 0) !== (colIndex === 0); // XOR: skip corner (0,0)
  return false;
}

/**
 * Update table data from cell editor input (only updates internal state, does NOT save to editor)
 * @param {HTMLInputElement} input - The input element
 */
function updateTableDataFromEditor(input) {
  const row = parseInt(input.dataset.row);
  const col = parseInt(input.dataset.col);
  const value = input.value;
  
  if (currentTableData && currentTableData.data[row] && currentTableData.data[row][col] !== undefined) {
    currentTableData.data[row][col] = value;
  }
}

/**
 * Save table changes to editor
 * Now uses content-based table detection to avoid position drift
 */
function saveTableChanges() {
  if (!currentTableBlock || !currentTableData) return;
  
  // Generate new table MMX syntax
  const newTableContent = generateTableMMX(currentTableData);
  
  // Use content-based replacement strategy: find the old table content by searching for it
  const editorContent = getEditorContent();
  
  // Try position-based replacement first (faster)
  let newContent;
  if (currentTableBlock.start >= 0 && currentTableBlock.end <= editorContent.length) {
    newContent = editorContent.substring(0, currentTableBlock.start) + 
                 newTableContent + 
                 editorContent.substring(currentTableBlock.end);
    
    // Verify position-based replacement preserves length consistency
    // If positions seem wrong, fall back to searching
    const expectedLen = editorContent.length - (currentTableBlock.end - currentTableBlock.start) + newTableContent.length;
    if (newContent.length !== expectedLen) {
      // Position-based replacement might be invalid, use content search
      const oldContent = currentTableBlock.content || currentTableBlock.oldContent;
      if (oldContent && editorContent.includes(oldContent)) {
        newContent = editorContent.replace(oldContent, newTableContent);
        // Update positions for future saves
        const newStart = editorContent.indexOf(oldContent);
        currentTableBlock.start = newStart;
        currentTableBlock.end = newStart + oldContent.length;
      }
    }
  } else {
    // Position out of range, search for old content
    const oldContent = currentTableBlock.content || currentTableBlock.oldContent;
    if (oldContent && editorContent.includes(oldContent)) {
      newContent = editorContent.replace(oldContent, newTableContent);
      const newStart = editorContent.indexOf(oldContent);
      currentTableBlock.start = newStart;
      currentTableBlock.end = newStart + oldContent.length;
    } else {
      showToast('Could not find table in editor', 'error');
      return;
    }
  }
  
  replaceEditorContent(newContent);
  
  // Update current table block with new positions
  const newStart = newContent.indexOf(newTableContent);
  currentTableBlock.start = newStart >= 0 ? newStart : 0;
  currentTableBlock.end = currentTableBlock.start + newTableContent.length;
  currentTableBlock.content = newTableContent;
  
  showToast('Table updated', 'success');
}

/**
 * Generate MMX table syntax from table data
 * @param {Object} tableData - Parsed table data
 * @returns {string} MMX table syntax
 */
function generateTableMMX(tableData) {
  let mmx = `#table`;
  
  if (tableData.mode !== 'h') {
    mmx += `(${tableData.mode})`;
  }
  
  if (tableData.classes) {
    mmx += ` ${tableData.classes}`;
  }
  mmx += "\n";
  
  // Add rows - join cells with | without leading/trailing pipes
  for (let i = 0; i < tableData.data.length; i++) {
    const row = tableData.data[i];
    // For 'b' mode, the first row has a leading empty corner cell in data
    // but we omit it in the MMX output (no leading pipe before Header 1)
    if (tableData.mode === 'b' && i === 0) {
      const rowStr = row.slice(1).join('|');
      // Leading spaces visually indicate the empty corner cell
      mmx += `     ${rowStr}\n`;
    } else {
      const rowStr = row.join('|');
      mmx += `${rowStr}\n`;
    }
  }
  
  mmx += "#endtable";
  return mmx;
}

/**
 * Add a new row to the table
 */
function addRow() {
  if (!currentTableData) return;
  
  const newRow = new Array(currentTableData.cols).fill('');
  currentTableData.data.push(newRow);
  
  // Re-render
  if (useOptimizedRenderer) {
    renderTableOptimized(currentTableData);
  } else {
    renderTableStandard(currentTableData);
  }
  
  showToast('Row added', 'success');
}

/**
 * Add a new column to the table
 */
function addColumn() {
  if (!currentTableData) return;
  
  currentTableData.data.forEach(row => {
    row.push('');
  });
  currentTableData.cols = currentTableData.data[0].length;
  
  // Re-analyze size
  analyzeTableSize(currentTableBlock);
  
  // Re-render
  if (useOptimizedRenderer) {
    renderTableOptimized(currentTableData);
  } else {
    renderTableStandard(currentTableData);
  }
  
  showToast('Column added', 'success');
}

/**
 * Delete a row from the table (deletes the last row by default)
 */
function deleteRow() {
  if (!currentTableData || currentTableData.data.length <= 1) {
    showToast('Cannot delete the last row', 'error');
    return;
  }
  
  // Delete the last row
  currentTableData.data.pop();
  
  // Re-render
  if (useOptimizedRenderer) {
    renderTableOptimized(currentTableData);
  } else {
    renderTableStandard(currentTableData);
  }
  
  showToast('Last row deleted', 'success');
}

/**
 * Delete a column from the table (deletes the last column by default)
 */
function deleteColumn() {
  if (!currentTableData || currentTableData.cols <= 1) {
    showToast('Cannot delete the last column', 'error');
    return;
  }
  
  // Delete the last column from each row
  currentTableData.data.forEach(row => {
    row.pop();
  });
  currentTableData.cols = currentTableData.data[0].length;
  
  // Re-analyze size
  analyzeTableSize(currentTableBlock);
  
  // Re-render
  if (useOptimizedRenderer) {
    renderTableOptimized(currentTableData);
  } else {
    renderTableStandard(currentTableData);
  }
  
  showToast('Last column deleted', 'success');
}

/**
 * Update table mode and classes from UI
 * @param {string} mode - Table mode
 * @param {string} classes - Table classes
 */
function updateTableProperties(mode, classes) {
  if (!currentTableData) return;
  
  currentTableData.mode = mode;
  currentTableData.classes = classes;
  
  // Re-analyze size for optimization decision
  analyzeTableSize(currentTableBlock);
  
  showToast('Table properties updated', 'success');
}

/**
 * Export table data for large tables (not fully implemented but stubbed)
 */
function exportTableData() {
  if (!currentTableData) return;
  
  const dataStr = JSON.stringify(currentTableData, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = 'table-data.json';
  a.click();
  
  URL.revokeObjectURL(url);
  showToast('Table data exported', 'success');
}

/**
 * Update table data from UI properties
 * This should be called when mode or classes change in the UI
 */
function syncTablePropertiesToData() {
  const modeSelect = document.getElementById('tableEditorMode');
  const classesInput = document.getElementById('tableEditorClasses');
  
  if (modeSelect && currentTableData) {
    currentTableData.mode = modeSelect.value;
  }
  
  if (classesInput && currentTableData) {
    currentTableData.classes = classesInput.value.trim();
  }
  
  // Re-analyze size
  if (currentTableBlock) {
    analyzeTableSize(currentTableBlock);
  }
  
  // Re-render
  if (currentTableData) {
    if (useOptimizedRenderer) {
      renderTableOptimized(currentTableData);
    } else {
      renderTableStandard(currentTableData);
    }
  }
}



/**
 * Close table editor popup
 */
function closeTableEditor() {
  // Reset state
  tablePopupVisible = false;
  currentTableBlock = null;
  currentTableData = null;
  useOptimizedRenderer = false;
}

/**
 * Cancel table editor popup (alias for closeTableEditor)
 */
function cancelTableEditor() {
  closeTableEditor();
}

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═════════════════════════════════════════════════════════════════════════════

export {
  closeTableEditor,
  saveTableChanges,
  addRow,
  addColumn,
  deleteRow,
  deleteColumn,
  updateTableProperties,
  exportTableData,
  cancelTableEditor,
};