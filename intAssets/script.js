/**
 * DOCUMENTATION VIEWER - CLIENT-SIDE SCRIPT
 *
 * This script is loaded in every HTML page of the generated documentation.
 * It handles:
 * - Dynamic sidebar menu generation from index.json
 * - Icon loading (favicon detection and loading)
 * - Code block enhancements (syntax highlighting, copy buttons)
 * - Responsive hamburger menu for mobile devices
 * - Folder expand/collapse with session storage
 * - Media player initialization (video and audio)
 * - Image zoom functionality
 *
 * Dependencies:
 * - highlight.js (hljs) - Syntax highlighting for code blocks
 *
 * The sidebar full-text search lives in a separate module:
 *   intAssets/search/search.js
 * which is loaded as its own <script> tag by the HTML template.
 */



// ============================================================================
// SIDEBAR ICONS - SVG elements for folder expand/collapse
// ============================================================================

/**
 * Expand icon (plus sign inside a box)
 * Shows when a folder is collapsed and clickable to expand
 */
const iconExpand = `
<svg width="18" height="18" viewBox="0 0 32 32" fill="none">
  <rect x="2" y="2" width="28" height="28" rx="4" fill="#1E88E5"/>
  <rect x="6" y="6" width="20" height="20" rx="3" fill="none" stroke="#64B5F6" stroke-width="2"/>
  <line x1="16" y1="10" x2="16" y2="22" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="10" y1="16" x2="22" y2="16" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
</svg>`;

/**
 * Collapse icon (minus sign inside a box)
 * Shows when a folder is expanded and clickable to collapse
 */
const iconCollapse = `
<svg width="18" height="18" viewBox="0 0 32 32" fill="none">
  <rect x="2" y="2" width="28" height="28" rx="4" fill="#1E88E5"/>
  <rect x="6" y="6" width="20" height="20" rx="3" fill="none" stroke="#64B5F6" stroke-width="2"/>
  <line x1="10" y1="16" x2="22" y2="16" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
</svg>`;


const navigatorButton = `
<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="4" cy="6" r="1.3" fill="#000"/>
  <path d="M7 6h14" stroke="#000" stroke-width="2"/>
  <circle cx="4" cy="12" r="1.3" fill="#000"/>
  <path d="M7 12h14" stroke="#000" stroke-width="2"/>
  <circle cx="4" cy="18" r="1.3" fill="#000"/>
  <path d="M7 18h14" stroke="#000" stroke-width="2"/>
</svg>`;


const navigatorButtonClose = `
<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="m5 5 14 14m0-14L5 19" stroke="#000" stroke-width="2"/>
</svg>`;

/**
 * Global variable to store the project name
 * Loaded from config.json and used in the sidebar title
 */
let nombreProyecto;


const path = window.location.pathname;
// ============================================================================
// STEP 1: Load project configuration
// ============================================================================
/**
 * Fetch config.json to get project metadata
 * The config file contains project title, author, and other settings
 * This allows customization without modifying code
 */

// ============================================================================
// STEP 1B: Highlight target heading on page load (if URL has hash)
// ============================================================================
/**
 * When the page loads with a hash in the URL (e.g., page.html#section),
 * add the .resaltado class to trigger the animation
 */
function highlightOnLoad() {
  // Only highlight when the URL contains a hash that matches a header id.
  const hash = window.location.hash.slice(1);
  if (!hash) return;
  const target = document.getElementById(hash);
  if (target) {
    target.classList.add('resaltado');
    setTimeout(function () { target.classList.remove('resaltado'); }, 1500);
  }
}

// Run on page load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", highlightOnLoad);
} else {
  highlightOnLoad();
}

// Re-run when the hash changes (same-page anchor clicks from the sidebar
// search, content links, etc.) so the target heading gets the .resaltado
// animation even when the page itself does not reload.
window.addEventListener("hashchange", highlightOnLoad);

// ============================================================================
// STEP 2: Load favicon - Project icon detection and loading
// ============================================================================
/**
 * Attempts to load a favicon from the assets folder
 * Tries multiple image formats to maximize compatibility
 * Formats: svg, png, ico, webp, jpg, jpeg
 */
(async () => {
  const exts = ["svg", "png", "ico", "webp", "jpg", "jpeg"];
  
  // Try each extension in order
  for (const ext of exts) {
    const url = prefix + `assets/icon.${ext}`;
    
    // Check if the file exists using HEAD request (lightweight, no download)
    if ((await fetch(url, { method: "HEAD" })).ok) {
      // Insert the favicon link into the document head
      document.head.insertAdjacentHTML(
        "beforeend",
        `<link rel="icon" href="${url}">`
      );
      break; // Stop searching once found
    }
  }
})();

// ============================================================================
// STEP 3: Load code from external files (#code directive)
// ============================================================================
/**
 * Processes <pre class="fileCode"> elements that have a "path" attribute
 * Fetches the file content and injects it into the code block
 * Optionally applies syntax highlighting with hljs
 */
document.addEventListener('DOMContentLoaded', async () => {
  const fileCodeBlocks = document.querySelectorAll('pre.fileCode');
  
  // Process each file code block sequentially
  for (const pre of fileCodeBlocks) {
    const filePath = pre.getAttribute("path");

    try {
      // Fetch the file content
      const response = await fetch(filePath);
      if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
      const contenido = await response.text();

      // Create a code element and set its text content
      const code = document.createElement('code');
      code.textContent = contenido; // Text content prevents HTML parsing

      // Append the code to the pre element
      pre.appendChild(code);
      
      // If "auto" attribute is set, apply syntax highlighting
      if (pre.hasAttribute("auto")) {
        hljs.highlightElement(code); // Highlight with hljs
      }

      // Add a copy-to-clipboard button
      createCopyButton(pre);
    } catch (error) {
      console.error(`Error loading code from ${filePath}:`, error);
    }
  }
});

// ============================================================================
// STEP 4: Build dynamic navigation menu
// ============================================================================
/**
 * Builds navigation menu from index.json
 * Supports folder expand/collapse with session storage
 * The sidebar HTML is now pre-loaded in the document
 * Also initializes hamburger menu for mobile
 */
document.addEventListener('DOMContentLoaded', () => {
  // Initialize hamburger menu for mobile
  cargarMenuHamburguesa();

  // Load index.json and build menu
  fetch(prefix + "intAssets/index.json")
    .then(res => {
      if (!res.ok) throw new Error("Could not load index.json");
      return res.json();
    })
    .then(indexData => {
      const menu = document.querySelector("#sidebar-menu");
      if (!menu) return;

      /**
       * ORGANIZE MENU ITEMS
       * Sort with loose files (pages) first, then folders
       * Both groups are alphabetically sorted
       */
      const orphans = indexData.filter(n => n.type === "file"); // Loose pages
      const folders = indexData.filter(n => n.type === "folder"); // Folders

      orphans.sort((a, b) => a.name.localeCompare(b.name)); // Sort alphabetically
      folders.sort((a, b) => a.name.localeCompare(b.name)); // Sort alphabetically

      const ordered = [...orphans, ...folders]; // Combine: pages first, then folders

      // Set the sidebar title link to the home page (with prefix for subdirectories)
      document.getElementById("sidebar-title").href = prefix || "./";

      /**
       * Recursively render the menu tree structure
       * Handles both files (links) and folders (collapsible sections)
       * 
       * @param {Object} node - A menu node (file or folder)
       * @param {Element} container - The DOM element to render into
       */
      function renderNode(node, container) {
        if (node.type === "file") {
          // FILE: Create a simple anchor link
          const a = document.createElement("a");
          a.href = prefix + "pages/" + node.path;
          a.textContent = node.name;
          a.style.display = "block";
          container.appendChild(a);
          return;
        }

        if (node.type === "folder") {
          // FOLDER: Create a collapsible section
          const folderId = "folder_" + node.path; // Unique ID based on path

          // Create the folder header (clickable title)
          const header = document.createElement("div");
          header.classList.add("folder-header");

          // Mark both header and content with the folderId so the global
          // expand/collapse-all handlers can iterate folders without
          // depending on the in-scope variable from renderNode.
          header.dataset.folderId = folderId;

          // Folder icon (expand/collapse indicator)
          const icon = document.createElement("span");
          icon.classList.add("folder-icon");

          // Folder name/title
          const title = document.createElement("span");
          title.textContent = node.name;
          title.classList.add("folder-title");

          // Assemble the header
          header.appendChild(icon);
          header.appendChild(title);
          container.appendChild(header);

          // Create the content container (hidden by default)
          const sub = document.createElement("div");
          sub.classList.add("folder-content");
          sub.style.marginLeft = "15px"; // Indent for visual hierarchy
          container.appendChild(sub);

          // Recursively render children (subfolders and files)
          node.children.forEach(child => renderNode(child, sub));

          /**
           * RESTORE COLLAPSED/EXPANDED STATE
           * Uses sessionStorage to remember folder states across page visits
           * Default: folders start collapsed
           */
          const savedState = sessionStorage.getItem(folderId);
          const isCollapsed = savedState === "closed" || savedState === null;

          if (isCollapsed) {
            sub.classList.add("collapsed"); // Hide the folder contents
            icon.innerHTML = iconExpand; // Show expand icon
          } else {
            icon.innerHTML = iconCollapse; // Show collapse icon
          }

          /**
           * TOGGLE FOLDER EXPANDED/COLLAPSED
           * Click handler for the folder header
           */
          header.addEventListener("click", () => {
            const collapsed = sub.classList.toggle("collapsed");

            if (collapsed) {
              // Folder is now collapsed
              icon.innerHTML = iconExpand;
              sessionStorage.setItem(folderId, "closed");
            } else {
              // Folder is now expanded
              icon.innerHTML = iconCollapse;
              sessionStorage.setItem(folderId, "open");
            }
          });
        }
      }

      // Render all top-level nodes into the menu
      ordered.forEach(node => renderNode(node, menu));

      /**
       * EXPAND / COLLAPSE ALL FOLDERS
       * Wires up the two small SVG buttons in the search toolbar to flip
       * every folder in the rendered tree at once. Folder states continue
       * to be persisted in sessionStorage under their existing folderId
       * keys, so the user's choice survives across page navigations.
       */
      const setAllFolders = (open) => {
        document.querySelectorAll("#sidebar-menu .folder-header").forEach(header => {
          const folderId = header.dataset.folderId;
          if (!folderId) return;
          // The content container is the next sibling of the header.
          const sub = header.nextElementSibling;
          if (!sub || !sub.classList.contains("folder-content")) return;
          const icon = header.querySelector(".folder-icon");
          if (open) {
            sub.classList.remove("collapsed");
            if (icon) icon.innerHTML = iconCollapse;
            sessionStorage.setItem(folderId, "open");
          } else {
            sub.classList.add("collapsed");
            if (icon) icon.innerHTML = iconExpand;
            sessionStorage.setItem(folderId, "closed");
          }
        });
      };

      const collapseAllBtn = document.getElementById("sidebar-collapse-all");
      const expandAllBtn = document.getElementById("sidebar-expand-all");
      if (collapseAllBtn) collapseAllBtn.addEventListener("click", () => setAllFolders(false));
      if (expandAllBtn) expandAllBtn.addEventListener("click", () => setAllFolders(true));

      /**
       * SAVE AND RESTORE SCROLL POSITION
       * Remembers where the user was scrolled in the sidebar
       * Useful for long navigation menus
       * This is set up once outside the render loop for efficiency
       */
      const tree = document.getElementById("sidebar-menu");

      // Restore scroll position on page load
      const savedScroll = sessionStorage.getItem("sidebar-menu");
      if (savedScroll !== null) {
        tree.scrollTop = parseInt(savedScroll, 10);
      }

      // Save scroll position in real-time as user scrolls
      tree.addEventListener("scroll", () => {
        sessionStorage.setItem("sidebar-menu", tree.scrollTop);
      });

      /**
       * HIGHLIGHT CURRENT PAGE
       * Adds an "active" class to the link of the current page
       * Allows CSS styling to show which page is being viewed
       * Skips highlighting for index page (home)
       */
      const currentPath = path.replace(/^\//, ""); // Remove leading slash
      
      // Don't highlight anything if on index page (home)
      const isIndexPage = currentPath === "" || currentPath === "/" || currentPath === "index.html" || currentPath.endsWith("/index.html");
      
      const links = document.querySelectorAll("#sidebar-menu a");
      links.forEach(a => {
        if (!isIndexPage && a.href.endsWith(currentPath)) {
          a.classList.add("active"); // Mark this link as the current page
        }
      });
    })
    .catch(err => console.error("Error loading navigation:", err));
});

// ============================================================================
// STEP 5: Initialize hamburger menu for mobile
// ============================================================================
/**
 * Manages the responsive hamburger menu for mobile devices
 * Handles:
 * - Toggle sidebar visibility on mobile
 * - Auto-hide/show based on screen size (999px breakpoint)
 * - Sync button state with sidebar visibility
 * - Apply appropriate CSS classes based on screen size
 */
function cargarMenuHamburguesa() {
  const btn = document.getElementById("icon-btn"); // Hamburger button in main
  const btn2 = document.getElementById("icon-btn2"); // Close button in sidebar
  const nav = document.getElementById("sidebar"); // Sidebar element
  const main = document.getElementsByTagName("main")[0]; // Main content area

  /**
   * EVENT: Click hamburger or close button
   * Toggles sidebar visibility on mobile
   */
  btn.addEventListener("click", () => {
    nav.classList.toggle("show"); // Show/hide sidebar
    btn2.classList.toggle("active"); // Update button appearance
    main.classList.toggle("sidebarActiva"); // Adjust main content layout
    updateHeaderNavigatorState();
  });

  btn2.addEventListener("click", () => {
    nav.classList.toggle("show");
    btn2.classList.toggle("active");
    main.classList.toggle("sidebarActiva");
    updateHeaderNavigatorState();
  });

  /**
   * RESPONSIVE BEHAVIOR
   * Media query at 999px breakpoint to detect mobile vs desktop
   * Automatically adjusts sidebar visibility based on screen size
   */
  const mq = window.matchMedia("(max-width: 999px)");

  /**
   * Handler for screen size changes
   * Only executes when crossing the 999px threshold, not on every resize
   */
  function handleChange(e) {
    if (e.matches) {
      // MOBILE MODE: Hide sidebar, show hamburger menu
      nav.classList.remove("show");
      btn2.classList.remove("active");
      main.classList.remove("sidebarActiva");
      main.classList.remove("pc");
      
    } else {
      // DESKTOP MODE: Show sidebar permanently
      nav.classList.add("show");
      btn2.classList.add("active");
      main.classList.add("sidebarActiva");
      main.classList.add("pc");
    }
  }

  // Execute on initial load to set correct state
  handleChange(mq);

  // Execute only when crossing the 999px threshold
  mq.addEventListener("change", handleChange);
}

// ============================================================================
// STEP 6: Copy-to-clipboard buttons for code blocks
// ============================================================================
/**
 * Adds copy buttons to all inline code blocks (not file code blocks)
 * Users can click to copy code to their clipboard
 */
document.addEventListener('DOMContentLoaded', () => {
  // STEP 6: Add copy buttons to inline code blocks
  document.querySelectorAll('pre.multiline-code').forEach(pre => {
    // Skip file code blocks (they get their own copy button in step 3)
    if (pre.classList.contains("fileCode")) return;
    
    // Create and attach copy button
    createCopyButton(pre);
  });

  // STEP 7: Apply syntax highlighting to code blocks with auto="true"
  // This NOW works for both inline and external code blocks (loaded in STEP 3)
  document.querySelectorAll('pre[auto="true"] > code').forEach(el => {
    hljs.highlightElement(el);
  });
});

/**
 * Creates a copy button and appends it to a code block
 * 
 * @param {Element} father - The <pre> element to add the button to
 */
function createCopyButton(father) {
    father.insertAdjacentHTML("beforeend", `
          <button class="copy-btn" title="Copy code to clipboard">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
          </button>
    `);

    // Set up the click handler for this button
    putCopyButton(father.querySelector(".copy-btn"));
}

/**
 * Handles copy button click event
 * Copies code content to clipboard and shows confirmation
 * 
 * @param {Element} btn - The copy button element
 */
function putCopyButton(btn) {
  btn.addEventListener('click', async () => {
    // Disable button and show "copied" state
    btn.classList.add('copied', 'disabled');
    
    const originalHTML = btn.innerHTML;

    // Change button appearance to show "Copied" message
    btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span class="copy-text">Copied</span>
    `;

    try {
      // Find the code element within the <pre> block
      const pre = btn.closest('pre.multiline-code');
      const code = pre.querySelector('code');
      if (!code) throw new Error('No code found');

      // Copy the code text to clipboard
      await navigator.clipboard.writeText(code.innerText);

      // Revert button after 1 second
      setTimeout(() => {
        btn.classList.remove('copied', 'disabled');
        btn.innerHTML = originalHTML;
      }, 1000);

    } catch (err) {
      console.error('Error copying code:', err);
      // Reset button on error
      btn.classList.remove('copied', 'disabled');
      btn.innerHTML = originalHTML;
    }
  });
}

// ============================================================================
// STEP 7: Initialize syntax highlighting for code blocks
// ============================================================================
/**
 * Apply highlight.js (hljs) to all code blocks with auto="true"
 * This provides syntax highlighting for popular programming languages
 */
const codes = document.querySelectorAll('pre[auto="true"] > code');
codes.forEach(el => {
    hljs.highlightElement(el); // Apply syntax highlighting
});

// ============================================================================
// STEP 8: Initialize media players and image zoom
// ============================================================================
/**
 * Initialize media players and image zoom after DOM is ready
 * Player: Initialize video and audio players
 */


document.addEventListener('DOMContentLoaded', () => {
  const images = document.querySelectorAll('.img');
  if (images.length > 0){
    imageZoom('.img');
  }

  // Player.js: Initialize video and audio players
  // Only initialize if elements exist
  const videos = document.querySelectorAll('video');
  if (videos.length > 0) {
    videoStyle("video");
  }

  const audios = document.querySelectorAll('audio');
  if (audios.length > 0) {
    videoStyle(".audio");
  }
});

// ============================================================================
// STEP 9: Generate header navigator (table of contents) on right side
// ============================================================================
/**
 * Creates a table of contents navigator on the right side
 * Shows all headers (h1-h6) from the main content
 * Only visible on PC (desktop) with sufficient screen width
 */







// ============================================================================
// Global state for Header Navigator (right sidebar) - to fix race conditions
// ============================================================================
let navigatorClickTimeout = null;       // Track current click timeout to clear it on rapid clicks
let navigatorIgnoreScrollUpdates = false;  // Flag to temporarily ignore scroll updates
let navigatorLastHighlighted = null; // Track last element with .resaltado class

function generateHeaderNavigator(container) {
  const main = document.querySelector('main');
  if (!main) return;

  // Get all headers from the main content
  const headers = main.querySelectorAll('h1, h2, h3, h4, h5, h6');
  
  if (headers.length === 0) return;

  // Create the navigator container - use provided container or create new
  let nav;
  if (container && container instanceof HTMLElement) {
    nav = container;
    nav.innerHTML = ''; // Clear existing content
  } else {
    nav = document.createElement('nav');
    nav.id = 'header-navigator';
  }
  nav.setAttribute('aria-label', 'Table of contents');
  
  // Add title
  const title = document.createElement('div');
  title.id = 'header-navigator-title';
  title.textContent = 'On this page';
  nav.appendChild(title);

  // Create list
  const list = document.createElement('ul');
  nav.appendChild(list);

  // Process each header
  headers.forEach((header, index) => {
    // Generate an ID if the header doesn't have one
    let id = header.id;

    // Determine the level for indentation
    const level = header.tagName.toLowerCase(); // 'h1', 'h2', etc.
    
    // Create list item
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#' + id;
    a.textContent = header.textContent;
    a.classList.add('nav-' + level);
    
    // Handle click for smooth scroll
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth' });
        // Update URL without reload
        history.pushState(null, null, '#' + id);
        
        // Clear any pending timeout from previous clicks - FIX for race condition
        if (navigatorClickTimeout) {
          clearTimeout(navigatorClickTimeout);
          navigatorClickTimeout = null;
        }
        
        // Set flag to ignore scroll-based updates for 1 second
        navigatorIgnoreScrollUpdates = true;
        
        // Clear highlight from previous element first
        if (navigatorLastHighlighted) {
          navigatorLastHighlighted.classList.remove("resaltado");
          navigatorLastHighlighted = null;
        }
        
        // Also clear any existing .resaltado from other elements in DOM
        document.querySelectorAll(".resaltado").forEach((element) => 
          element.classList.remove("resaltado")
        );

        // Use setTimeout to force browser to recognize class removal before re-adding
        // This allows the animation to re-trigger on subsequent clicks
        setTimeout(() => {
          target.classList.add("resaltado");
          navigatorLastHighlighted = target;
        }, 10);

        
        // Temporary highlight for nav link
        list.querySelectorAll('a').forEach(l => l.classList.remove('active'));
        a.classList.add('active');
        
        // After 1 second, let updateActiveHeader take over - store timeout globally
        navigatorClickTimeout = setTimeout(() => {
          navigatorIgnoreScrollUpdates = false;
          a.classList.remove('active');
          navigatorClickTimeout = null;
          navigatorLastHighlighted = null;
          updateActiveHeader();
        }, 1000);
      }
    });

    li.appendChild(a);
    list.appendChild(li);
  });

  // Add to body
  document.body.appendChild(nav);

  // Highlight current section on scroll
  // Uses scroll position to determine which header is currently visible
  function updateActiveHeader() {
    // Skip if user just clicked a link (temporary highlight active)
    // Use global variable to fix race conditions with rapid clicks
    if (navigatorIgnoreScrollUpdates) return;
    
    const allLinks = list.querySelectorAll('a');
    if (allLinks.length === 0) return;
    
    // Get current scroll position (top of viewport)
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    
    // Find the header that is closest to the top of the viewport
    // and either above it or just below it
    let activeLink = null;
    let minDistance = Infinity;
    
    allLinks.forEach(link => {
      const id = link.getAttribute('href').substring(1);
      const el = document.getElementById(id);
      if (el) {
        const rect = el.getBoundingClientRect();
        
        // Use rect.top directly (distance from viewport top)
        // Negative = above viewport, Positive = below viewport
        const distance = rect.top;
        
        // We want headers that are:
        // 1. Above the viewport (distance < 0), OR
        // 2. Just below the viewport top (distance > 0 but < 100)
        // Both should be close to the top of the viewport
        if ((distance < 0 && distance > -600) || (distance >= 0 && distance < 100)) {
          if (Math.abs(distance) < minDistance) {
            minDistance = Math.abs(distance);
            activeLink = link;
          }
        }
      }
    });
    
    // If no header found, use the first one that's in the viewport
    if (!activeLink) {
      for (const link of allLinks) {
        const id = link.getAttribute('href').substring(1);
        const el = document.getElementById(id);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top > 0 && rect.top < window.innerHeight) {
            activeLink = link;
            break;
          }
        }
      }
    }
    
    // Update active state (but preserve user-clicked state)
    list.querySelectorAll('a').forEach(link => {
      // Don't remove if user just clicked this link (temporary override)
      if (!link.classList.contains('user-clicked')) {
        link.classList.remove('active');
      }
    });
    
    if (activeLink) {
      activeLink.classList.add('active');
    }
  }
  
  // Update on scroll with debounce for performance
  let scrollTimeout;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(updateActiveHeader, 5);
  });
  
  // Initial update
  updateActiveHeader();
}

// Run the header navigator on desktop
// Determine threshold based on sidebar state
function getNavigatorThreshold() {
  const main = document.querySelector('main');
  if (!main) return 1600;
  
  // Check for sidebarActiva class as the real expanded-sidebar marker
  const classList = main.classList;
  const hasActiveClass = classList.contains('sidebarActiva');
  
  // Also check computed style - if margin-left is large, sidebar is likely expanded
  const style = window.getComputedStyle(main);
  const marginLeft = parseInt(style.marginLeft) || 0;
  const hasMargin = marginLeft > 100;
  
  // If any indicator shows expanded sidebar or screen is large enough, use 1900
  const isLargeScreen = window.innerWidth >= 1900;
  
  return (hasActiveClass || hasMargin || isLargeScreen) ? 1900 : 1600;
}

// Set body data attribute for CSS to use
function updateSidebarState() {
  const main = document.querySelector('main');
  if (!main) {
    document.body.setAttribute('data-sidebar', 'inactive');
    return;
  }
  
  // Check the same things as getNavigatorThreshold for consistency
  const classList = main.classList;
  const hasActiveClass = classList.contains('sidebarActiva');
  
  // Also check computed style
  const style = window.getComputedStyle(main);
  const marginLeft = parseInt(style.marginLeft) || 0;
  const hasMargin = marginLeft > 100;
  
  // If any indicator shows expanded sidebar, mark as active
  if (hasActiveClass || hasMargin) {
    document.body.setAttribute('data-sidebar', 'active');
  } else {
    document.body.setAttribute('data-sidebar', 'inactive');
  }
}

// Update navigator and button based on current state
function updateHeaderNavigatorState() {
  const threshold = getNavigatorThreshold();
  const navigator = document.getElementById('header-navigator');
  const toggleBtn = document.getElementById('header-navigator-toggle');
  
  if (window.innerWidth >= threshold) {
    // Show navigator, hide button
    if (!navigator && typeof generateHeaderNavigator === 'function') {
      generateHeaderNavigator();
    }
    if (toggleBtn) {
      removeHeaderNavigatorToggle();
    }
  } else {
    // Show button, remove navigator
    if (navigator) navigator.remove();
    setupHeaderNavigatorToggle();
  }
  updateSidebarState();
}

// Run on load - after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', updateHeaderNavigatorState);
} else {
  updateHeaderNavigatorState();
}

// Also run after delays to ensure any dynamic classes are applied
setTimeout(updateHeaderNavigatorState, 100);
setTimeout(updateHeaderNavigatorState, 500);

// Watch for dynamic class changes on main (sidebar toggling)
const mainElement = document.querySelector('main');
if (mainElement) {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        updateHeaderNavigatorState();
      }
    });
  });
  observer.observe(mainElement, { attributes: true });
}

// Handle window resize
window.addEventListener('resize', updateHeaderNavigatorState);

// ============================================================================
// Header Navigator Toggle Button for smaller screens
// ============================================================================

/**
 * Remove toggle button and dropdown when screen becomes large
 */
function removeHeaderNavigatorToggle() {
  const toggleBtn = document.getElementById('header-navigator-toggle');
  const dropdown = document.getElementById('header-navigator-dropdown');
  if (toggleBtn) toggleBtn.remove();
  if (dropdown) dropdown.remove();
}

/**
 * Create toggle button and dropdown for screens smaller than 1900px
 * The dropdown shows the same content as the desktop navigator
 */
function setupHeaderNavigatorToggle() {
  // Determine threshold based on sidebar state
  const threshold = getNavigatorThreshold();
  
  // Only run on smaller screens than threshold
  if (window.innerWidth >= threshold) return;
  
  // Remove desktop navigator if it exists (wrong size)
  const desktopNav = document.getElementById('header-navigator');
  if (desktopNav) desktopNav.remove();
  
  // Check if already set up
  if (document.getElementById('header-navigator-toggle')) return;
  
  // Create toggle button
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'header-navigator-toggle';
  toggleBtn.innerHTML = navigatorButton;
  toggleBtn.setAttribute('aria-label', 'Toggle table of contents');
  toggleBtn.setAttribute('aria-expanded', 'false');
  document.body.appendChild(toggleBtn);
  
  // Create dropdown container
  const dropdown = document.createElement('div');
  dropdown.id = 'header-navigator-dropdown';
  document.body.appendChild(dropdown);
  
  // Always regenerate content for dropdown to ensure click handlers work
  if (typeof generateHeaderNavigator === 'function') {
    generateHeaderNavigator(dropdown);
    // Update the title text
    const title = dropdown.querySelector('#header-navigator-title');
    if (title) {
      title.id = 'header-navigator-dropdown-title';
      title.textContent = 'On this page';
    }
    // Update class for links
    const links = dropdown.querySelectorAll('a');
    links.forEach(link => {
      // Get the level from existing class or tag
      const match = link.className.match(/nav-h(\d)/);
      if (match) {
        link.classList.add('nav-h' + match[1]);
      }
    });
  }
  
  // Add click event to toggle dropdown
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isActive = dropdown.classList.toggle('active');
    toggleBtn.setAttribute('aria-expanded', isActive);
    toggleBtn.innerHTML = isActive
      ? navigatorButtonClose
      : navigatorButton;
  });
  
  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!toggleBtn.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.remove('active');
      toggleBtn.setAttribute('aria-expanded', 'false');
      toggleBtn.innerHTML = navigatorButton;
    }
  });
  
  // Prevent dropdown close when clicking inside dropdown
  dropdown.addEventListener('click', (e) => {
    e.stopPropagation();
  });
}

// Note: Toggle button setup is now handled by updateHeaderNavigatorState()
// which is called on load and on resize via updateHeaderNavigatorState()
// No separate setup needed here

// ============================================================================
// STEP 11: Heading link copy-to-clipboard functionality
// ============================================================================
/**
 * Adds event listeners to heading link buttons
 * Clicking the link icon copies the heading's URL to clipboard
 * Shows visual feedback on successful copy
 */
document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', (e) => {
    // Check if the clicked element is a heading link button
    if (e.target.closest('.heading-link-btn')) {
      const btn = e.target.closest('.heading-link-btn');
      const headingId = btn.getAttribute('data-heading-id');
      
      if (!headingId) return;
      
      // Create the full URL with the heading anchor
      const url = window.location.href.split('#')[0] + '#' + headingId;
      
      // Prevent multiple clicks while copying
      if (btn.classList.contains('is-copying')) return;
      btn.classList.add('is-copying');
      
      // Store original content
      const originalContent = btn.innerHTML;
      
      // Copy to clipboard
      try {
        navigator.clipboard.writeText(url);
        
        // Show success SVG
        btn.innerHTML = `<svg class="heading-link-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Copied!"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/><path d="m16 20.5 2.5 2.5 4.5-4.5" stroke-width="1.7"/></svg>`;
        
        // Revert after 1 seconds
        setTimeout(() => {
          btn.innerHTML = originalContent;
          btn.classList.remove('is-copying');
        }, 1000);
      } catch (err) {
        console.error('Failed to copy:', err);
        // Revert on error
        btn.innerHTML = originalContent;
        btn.classList.remove('is-copying');
      }
    }
  });
});