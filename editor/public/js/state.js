/**
 * MMX Visual Editor — State Manager
 *
 * Simple global state with change listeners.
 */

class State {
  constructor() {
    this._data = {
      currentFile: null,      // { path, name, content }
      files: [],              // Flat list of all .mmx files
      fileTree: null,         // Tree structure
      pagesDir: "",           // Root pages directory
      dirty: false,           // Has unsaved changes
      saving: false,          // Currently saving
      previewVisible: true,   // Is preview panel visible
      lastPreview: "",        // Last generated preview HTML
      config: {},             // Project config
    };
    this._listeners = new Map();
  }

  /**
   * Get a state value
   * @param {string} key
   * @returns {*}
   */
  get(key) {
    return this._data[key];
  }

  /**
   * Set a state value and notify listeners
   * @param {string} key
   * @param {*} value
   */
  set(key, value) {
    const old = this._data[key];
    if (old === value) return;
    this._data[key] = value;
    this._notify(key, value, old);
  }

  /**
   * Update multiple state values at once
   * @param {object} updates - Key-value pairs to update
   */
  update(updates) {
    for (const [key, value] of Object.entries(updates)) {
      const old = this._data[key];
      if (old !== value) {
        this._data[key] = value;
        this._notify(key, value, old);
      }
    }
  }

  /**
   * Subscribe to changes on a specific key
   * @param {string} key
   * @param {Function} callback - Called with (newValue, oldValue)
   * @returns {Function} Unsubscribe function
   */
  subscribe(key, callback) {
    if (!this._listeners.has(key)) {
      this._listeners.set(key, new Set());
    }
    this._listeners.get(key).add(callback);
    // Immediately call with current value
    callback(this._data[key], undefined);
    return () => this._listeners.get(key)?.delete(callback);
  }

  /**
   * Notify listeners of a change
   * @param {string} key
   * @param {*} newVal
   * @param {*} oldVal
   */
  _notify(key, newVal, oldVal) {
    const listeners = this._listeners.get(key);
    if (listeners) {
      for (const cb of listeners) {
        try {
          cb(newVal, oldVal);
        } catch (e) {
          console.error(`State listener error for "${key}":`, e);
        }
      }
    }
  }
}

// Singleton instance
export const state = new State();
