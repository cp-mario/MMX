/**
 * MMX Visual Editor — Undo/Redo Manager
 *
 * Maintains a stack of content snapshots for undo/redo operations.
 * Designed as a standalone ES module that can be imported anywhere.
 *
 * Usage:
 *   import { undoManager } from "./undoManager.js";
 *   undoManager.saveSnapshot(content, cursorStart, cursorEnd);
 *   const state = undoManager.undo();  // { content, cursorStart, cursorEnd } | null
 *   const state = undoManager.redo();  // { content, cursorStart, cursorEnd } | null
 *   undoManager.reset(content, cursorStart, cursorEnd);
 */

class UndoManager {
  constructor(maxSteps = 200) {
    /** @type {Array<{content: string, cursorStart: number, cursorEnd: number}>} */
    this.stack = [];
    /** @type {number} Current position in the stack (0-based index) */
    this.pointer = -1;
    /** @type {number} Maximum number of undo steps */
    this.maxSteps = maxSteps;
    /** @type {boolean} True while undo/redo is restoring a state (prevents re-capture) */
    this.isUndoing = false;
  }

  /**
   * Save a snapshot of the current editor state.
   * If we are at a past position (after undo), future states are discarded.
   * @param {string} content - The full editor content
   * @param {number} cursorStart - Selection start
   * @param {number} cursorEnd - Selection end
   */
  saveSnapshot(content, cursorStart, cursorEnd) {
    if (this.isUndoing) return; // Don't record during undo/redo

    // If we've undone and then make a new edit, discard future states
    if (this.pointer < this.stack.length - 1) {
      this.stack = this.stack.slice(0, this.pointer + 1);
    }

    this.stack.push({ content, cursorStart, cursorEnd });
    this.pointer = this.stack.length - 1;

    // Enforce max stack size
    if (this.stack.length > this.maxSteps) {
      this.stack.shift();
      this.pointer--;
    }
  }

  /**
   * Undo: go back one step.
   * @returns {{content: string, cursorStart: number, cursorEnd: number} | null}
   */
  undo() {
    if (this.pointer <= 0) return null;

    this.isUndoing = true;
    this.pointer--;
    const state = this.stack[this.pointer];
    // isUndoing will be reset by the caller after the editor content is updated
    return state;
  }

  /**
   * Redo: go forward one step.
   * @returns {{content: string, cursorStart: number, cursorEnd: number} | null}
   */
  redo() {
    if (this.pointer >= this.stack.length - 1) return null;

    this.isUndoing = true;
    this.pointer++;
    const state = this.stack[this.pointer];
    return state;
  }

  /**
   * Call after undo/redo has finished applying the state to the editor.
   */
  finishUndoRedo() {
    this.isUndoing = false;
  }

  /**
   * Reset the undo stack with an initial state.
   * @param {string} content
   * @param {number} cursorStart
   * @param {number} cursorEnd
   */
  reset(content, cursorStart = 0, cursorEnd = 0) {
    this.stack = [{ content, cursorStart, cursorEnd }];
    this.pointer = 0;
    this.isUndoing = false;
  }

  /**
   * Get the number of undo steps available.
   * @returns {number}
   */
  get undoCount() {
    return this.pointer;
  }

  /**
   * Get the number of redo steps available.
   * @returns {number}
   */
  get redoCount() {
    return this.stack.length - 1 - this.pointer;
  }

  /**
   * Clear the entire undo stack.
   */
  clear() {
    this.stack = [];
    this.pointer = -1;
    this.isUndoing = false;
  }
}

/** Singleton instance shared across modules */
export const undoManager = new UndoManager(200);
