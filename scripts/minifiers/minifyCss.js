/**
 * CSS Minifier
 * Minifies CSS code without external libraries
 * @param {string} cssCode - Original CSS code
 * @returns {string} Minified CSS code
 */
import fs from "fs";

export function minifyCss(cssCode) {
  let result = "";
  let i = 0;
  const len = cssCode.length;
  let inString = false;
  let stringChar = "";
  let lastWasSpace = false;
  
  while (i < len) {
    const char = cssCode[i];
    
    // Handle escape sequences
    if (char === "\\" && !inString) {
      result += char + cssCode[i + 1];
      i += 2;
      continue;
    }
    
    // Detect string start
    if ((char === '"' || char === "'") && !inString) {
      inString = true;
      stringChar = char;
      result += char;
      i++;
      continue;
    }
    
    // Detect string end
    if (char === stringChar && inString) {
      inString = false;
      result += char;
      i++;
      continue;
    }
    
    // Inside string - keep everything
    if (inString) {
      result += char;
      i++;
      continue;
    }
    
    // Handle comments /* */
    if (char === "/" && cssCode[i + 1] === "*") {
      // Skip the comment
      i += 2;
      while (i < len - 1) {
        if (cssCode[i] === "*" && cssCode[i + 1] === "/") {
          i += 2;
          break;
        }
        i++;
      }
      // Add a space after comment if needed
      if (result.length > 0 && !lastWasSpace) {
        result += " ";
        lastWasSpace = true;
      }
      continue;
    }
    
    // Handle newlines and tabs - convert to spaces or remove
    if (char === "\n" || char === "\r" || char === "\t") {
      if (!lastWasSpace && result.length > 0) {
        const lastChar = result[result.length - 1];
        // Keep whitespace after { and before }
        if (lastChar === "{" || char !== "\n") {
          result += " ";
          lastWasSpace = true;
        }
      }
      i++;
      continue;
    }
    
    // Handle spaces
    if (char === " ") {
      // Don't remove space after: , ( [ { : ;
      if (result.length > 0) {
        const lastChar = result[result.length - 1];
        if (",([{:;".includes(lastChar)) {
          result += " ";
          lastWasSpace = true;
        } else if (!lastWasSpace) {
          result += " ";
          lastWasSpace = true;
        }
      }
      i++;
      continue;
    }
    
    result += char;
    lastWasSpace = false;
    i++;
  }
  
  // Clean up multiple spaces and spaces around special chars
  result = result.replace(/\s+/g, " ");
  result = result.replace(/\s*([{},;:])\s*/g, "$1");
  result = result.replace(/\{\s*/g, "{");
  result = result.replace(/\s*}/g, "}");
  result = result.replace(/;\s*}/g, "}");
  result = result.replace(/\s*:\s*/g, ":");
  result = result.replace(/,\s*/g, ",");
  
  // Remove leading/trailing whitespace
  result = result.trim();
  
  return result;
}

/**
 * Minifies a CSS file and saves it
 * @param {string} inputPath - Path to input .css file
 * @param {string} outputPath - Path to output minified .css file
 */
export function minifyCssFile(inputPath, outputPath) {
  const original = fs.readFileSync(inputPath, "utf-8");
  const minified = minifyCss(original);
  fs.writeFileSync(outputPath, minified, "utf-8");
}