/**
 * MMX Visual Editor — API Client
 *
 * Provides functions to communicate with the editor server.
 */

const BASE = "";

/**
 * Make an HTTP request to the server
 * @param {string} method - HTTP method
 * @param {string} path - URL path
 * @param {*} [body] - Request body (object, will be JSON.stringified)
 * @returns {Promise<*>} Parsed JSON response
 */
async function request(method, path, body) {
  const opts = {
    method,
    headers: {},
  };

  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  return data;
}

/**
 * Get project info (parsed config)
 * @returns {Promise<{config: object}>}
 */
export async function getProjectInfo() {
  return request("GET", "/api/project-info");
}

/**
 * Get project config
 * @returns {Promise<object>}
 */
export async function getConfig() {
  return request("GET", "/api/config");
}

/**
 * List all .mmx files in the project (returns both flat list and tree)
 * @returns {Promise<{files: Array, tree: object, pagesDir: string}>}
 */
export async function getFiles() {
  return request("GET", "/api/files");
}

/**
 * Read a file's content
 * @param {string} filePath - Absolute path to the file
 * @returns {Promise<{content: string, path: string}>}
 */
export async function readFile(filePath) {
  const data = await request("GET", `/api/file?path=${encodeURIComponent(filePath)}`);
  // Normalize line endings from CRLF to LF to prevent double lines in editor
  if (data.content) {
    data.content = data.content.replace(/\r\n/g, "\n");
  }
  return data;
}

/**
 * Save content to a file
 * @param {string} filePath - Absolute path to the file
 * @param {string} content - File content
 * @returns {Promise<{success: boolean, path: string}>}
 */
export async function saveFile(filePath, content) {
  return request("POST", "/api/file", { filePath, content });
}

/**
 * Convert MMX content to HTML
 * @param {string} content - MMX source text
 * @param {string} [filePath] - Optional file path for context
 * @returns {Promise<{html: string}>}
 */
export async function preview(content, filePath) {
  return request("POST", "/api/preview", { content, filePath });
}

/**
 * Create a new file
 * @param {string} filePath - Absolute path for the new file
 * @returns {Promise<{success: boolean, path: string}>}
 */
export async function createFile(filePath) {
  return request("POST", "/api/file/create", { filePath });
}

/**
 * Create a new folder
 * @param {string} folderPath - Absolute path for the new folder
 * @returns {Promise<{success: boolean, path: string}>}
 */
export async function createFolder(folderPath) {
  return request("POST", "/api/folder/create", { folderPath });
}

/**
 * Delete a file
 * @param {string} filePath - Absolute path to delete
 * @returns {Promise<{success: boolean}>}
 */
export async function deleteFile(filePath) {
  return request("DELETE", `/api/file?path=${encodeURIComponent(filePath)}`);
}

/**
 * Delete a folder
 * @param {string} folderPath - Absolute path to delete
 * @returns {Promise<{success: boolean}>}
 */
export async function deleteFolder(folderPath) {
  return request("DELETE", `/api/folder?path=${encodeURIComponent(folderPath)}`);
}

/**
 * List asset files in input/assets directory
 * @param {string} [subPath] - Optional subdirectory within assets
 * @returns {Promise<{files: Array, folders: Array, assetsDir: string}>}
 */
export async function listAssets(subPath = "") {
  const params = subPath ? `?sub=${encodeURIComponent(subPath)}` : "";
  return request("GET", `/api/assets/list${params}`);
}

/**
 * Read an asset file (code snippet, text file, etc.)
 * @param {string} assetPath
 * @returns {Promise<{content: string, path: string}>}
 */
export async function readAsset(assetPath) {
  return request("GET", `/api/assets?path=${encodeURIComponent(assetPath)}`);
}

/**
 * Upload a file to the assets directory
 * @param {string} filename - The file name
 * @param {string} base64 - Base64-encoded file content
 * @param {string} [subPath] - Optional subdirectory within assets
 * @returns {Promise<{success: boolean, path: string, size: number}>}
 */
export async function uploadAsset(filename, base64, subPath = "") {
  return request("POST", "/api/assets/upload", { filename, base64, subPath });
}

/**
 * Create a folder inside the assets directory
 * @param {string} name - Folder name
 * @param {string} [subPath] - Optional subdirectory within assets
 * @returns {Promise<{success: boolean, path: string}>}
 */
export async function createAssetFolder(name, subPath = "") {
  return request("POST", "/api/assets/folder/create", { name, subPath });
}

/**
 * Open an asset file in the default OS application
 * @param {string} assetPath - Path relative to assets directory
 * @returns {Promise<{success: boolean, path: string}>}
 */
export async function openAsset(assetPath) {
  return request("POST", "/api/assets/open", { assetPath });
}

/**
 * Reveal a file/folder in the system file explorer
 * @param {string} assetPath - Path relative to assets directory
 * @returns {Promise<{success: boolean, path: string}>}
 */
export async function revealAsset(assetPath) {
  return request("POST", "/api/assets/reveal", { assetPath });
}

/**
 * Run the full MMX documentation build
 * @returns {Promise<{success: boolean, outputPath: string, log: string}>}
 */
export async function buildProject() {
  return request("POST", "/api/build");
}

/**
 * Check if a built version of the documentation exists
 * @returns {Promise<{built: boolean, outputPath: string, outputUrl: string}>}
 */
export async function getBuildStatus() {
  return request("GET", "/api/build/status");
}

/**
 * Shutdown the editor server gracefully
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function shutdown() {
  return request("POST", "/api/shutdown");
}
