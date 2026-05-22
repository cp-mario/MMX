/**
 * ============================================================
 * MINIMAL MEDIA PLAYER - LIGHTWEIGHT & CUSTOMIZABLE
 * ============================================================
 * A simple, efficient video and audio player with:
 * - Play/pause controls
 * - Progress bar with seeking
 * - Volume control with mute toggle
 * - Fullscreen support (video only)
 * - Keyboard shortcuts
 * - Auto-hide interface with mouse detection
 * ============================================================
 */

/**
 * SVG ICON DEFINITIONS
 * Store all player control icons as inline SVG strings
 */
const ICONS = {
    play: `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`,
    
    pause: `<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>`,

    volume: `<svg viewBox="0 0 25 25" xmlns="http://www.w3.org/2000/svg" xml:space="preserve" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:2"><path d="M2.5 8.056v8.889h5.926l7.407 7.407V.648L8.426 8.055zm20 4.444a6.68 6.68 0 0 0-3.704-5.97v11.941a6.68 6.68 0 0 0 3.704-5.97Z" style="fill-rule:nonzero;stroke:#000;stroke-width:.97px"/></svg>`,

    mute: `<svg viewBox="0 0 25 25" xmlns="http://www.w3.org/2000/svg" xml:space="preserve" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:2"><path d="M2.5 8.056v8.889h5.926l7.407 7.407V.648L8.426 8.055z" style="fill-rule:nonzero;stroke:#000;stroke-width:.97px"/><path d="m17.979 15.255 5.51-5.51m-5.51 0 5.51 5.51" style="fill:none;stroke:#FFF;stroke-width:1.35px;stroke-linecap:round;stroke-miterlimit:1.5"/></svg>`,

    fullscreen: `<svg viewBox="0 0 25 25" xmlns="http://www.w3.org/2000/svg" xml:space="preserve" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linecap:round;stroke-linejoin:round;stroke-miterlimit:1.5"><path d="M8.341 1.163H1.174V8.33M16.67 23.831h7.167v-7.167m-22.663 0v7.167h7.167M23.837 8.33V1.163H16.67" style="fill:none;stroke:#FFF;stroke-width:2.32px"/></svg>`,

    fullscreenExit: `<svg viewBox="0 0 25 25" xmlns="http://www.w3.org/2000/svg" xml:space="preserve" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linecap:round;stroke-linejoin:round;stroke-miterlimit:1.5"><path d="M1.174 8.33h7.167V1.163m15.496 15.501H16.67v7.167m-8.329 0v-7.167H1.174M16.67 1.163V8.33h7.167" style="fill:none;stroke:#FFF;stroke-width:2.32px"/></svg>`
};

/**
 * UTILITY: Create a control button with specified icon
 * @param {string} icon - SVG icon string
 * @returns {HTMLButtonElement} - Configured button element
 */
function createButton(icon) {
    const btn = document.createElement("button");
    btn.className = "vs-btn";
    btn.innerHTML = icon;
    return btn;
}

/**
 * MAIN PLAYER SETUP FUNCTION
 * Initializes the custom media player for video or audio elements
 * @param {HTMLMediaElement} media - The <video> or <audio> element to enhance
 */
function setup(media) {
    // Resolve if a selector string was passed
    if (typeof media === 'string') {
        const el = document.querySelector(media);
        if (!el) return;
        media = el;
    }

    // If a non-media element (e.g. wrapper or container) was passed,
    // try to find an <audio> or <video> inside it.
    if (!(media instanceof HTMLMediaElement)) {
        if (media && media.querySelector) {
            const found = media.querySelector('audio,video');
            if (found) media = found;
        }
    }

    // If still not a media element, bail out
    if (!media || !(media instanceof HTMLMediaElement)) return;

    // Prevent duplicate initialization
    if (media.dataset.vsReady) return;
    media.dataset.vsReady = "1";

    // Disable native browser controls
    media.controls = false;

    // Detect media type (video or audio)
    const isVideo = media.tagName.toLowerCase() === "video";

    // ========== CREATE DOM STRUCTURE ==========
    const wrapper = document.createElement("div");
    wrapper.className = "vs-wrapper";
    
    // Add audio-mode class for styling differences
    if (!isVideo) {
        wrapper.classList.add("audio-mode");
    }

    // Thresholds for small screen detection (width of wrapper, not screen)
    const videoSmallThreshold = 404;  // New threshold for videos
    const audioSmallThreshold = 374;  // New threshold for audios

    // Replace media element with wrapper and append media inside
    media.parentNode.insertBefore(wrapper, media);
    wrapper.appendChild(media);

    // ========== BUILD CONTROLS UI ==========
    const controls = document.createElement("div");
    controls.className = "vs-controls";

    // Play/Pause button
    const playBtn = createButton(ICONS.play);

    // Progress bar container and fill
    const progress = document.createElement("div");
    progress.className = "vs-progress";

    const progressFill = document.createElement("div");
    progressFill.className = "vs-progress-fill";
    progress.appendChild(progressFill);
    
    // Progress hover indicator (circle + time)
    const progressHover = document.createElement("div");
    progressHover.className = "vs-progress-hover";
    const progressHoverTime = document.createElement("span");
    progressHoverTime.className = "vs-progress-hover-time";
    progressHover.appendChild(progressHoverTime);
    progress.appendChild(progressHover);

    // Volume button and slider
    const volumeBtn = createButton(ICONS.volume);
    const volume = document.createElement("input");
    volume.type = "range";
    volume.min = 0;
    volume.max = 1;
    volume.step = 0.01;
    volume.value = media.volume;
    volume.className = "vs-volume";

    // Assemble controls
    controls.appendChild(playBtn);
    controls.appendChild(progress);
    controls.appendChild(volumeBtn);
    controls.appendChild(volume);

    // Small screen detection and volume slider behavior
    // Start with a default and let updateSmallScreenStatus set accurate value
    let isSmallScreen = false;
    let isVolumeSliderVisible = false;

    // Function to update small screen status based on wrapper width thresholds
    function updateSmallScreenStatus() {
        const wasSmallScreen = isSmallScreen;
        isSmallScreen = isVideo ? wrapper.offsetWidth < videoSmallThreshold : wrapper.offsetWidth < audioSmallThreshold;
        if (isSmallScreen !== wasSmallScreen) {
            if (isSmallScreen) {
                wrapper.classList.add('vs-small-screen');
                // Hide slider if visible (use CSS class)
                if (isVolumeSliderVisible) {
                    volume.classList.remove('visible');
                    isVolumeSliderVisible = false;
                }
            } else {
                wrapper.classList.remove('vs-small-screen');
                // Ensure slider class removed for normal (large) screens
                volume.classList.remove('visible');
            }
        }
    }

    // Initial update
    updateSmallScreenStatus();

    // Add resize listener
    window.addEventListener('resize', updateSmallScreenStatus);



    // Modify volume button click handler
    // Stop propagation so wrapper click handlers don't toggle playback
    volumeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
            // Normal behavior for large screens
            media.muted = !media.muted;
            volumeBtn.innerHTML = media.muted ? ICONS.mute : ICONS.volume;
            volume.value = media.muted ? 0 : media.volume || 1;
        }
    );

    // Prevent clicks/touches on the slider from bubbling to wrapper
    volume.addEventListener('mousedown', (e) => e.stopPropagation());
    volume.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    volume.addEventListener('click', (e) => e.stopPropagation());

    // Fullscreen button (video only)
    let fullscreenBtn;
    if (isVideo) {
        fullscreenBtn = createButton(ICONS.fullscreen);
        controls.appendChild(fullscreenBtn);
    }

    wrapper.appendChild(controls);

    // ========== STATE MANAGEMENT ==========
    let isDragging = false;
    let clickTimer = null;
    let hideTimeout = null;

    // ========== PLAYBACK CONTROL FUNCTIONS ==========
    
    /**
     * Update play button and wrapper state based on media playback status
     * Optimized to avoid unnecessary DOM updates
     */
    let lastPlayState = null;
    function updatePlayState() {
        const isPaused = media.paused;
        if (lastPlayState === isPaused) return; // Skip if state hasn't changed
        lastPlayState = isPaused;
        
        if (isPaused) {
            playBtn.innerHTML = ICONS.play;
            wrapper.classList.add("paused");
        } else {
            playBtn.innerHTML = ICONS.pause;
            wrapper.classList.remove("paused");
        }
    }

    /**
     * Toggle between play and pause states
     */
    function togglePlay() {
        media.paused ? media.play() : media.pause();
    }

    /**
     * Update progress bar fill width based on current playback time
     * Continuous update regardless of play state
     */
    let updateRAFId = null;
    function updateProgress() {
        if (!isDragging && media.duration && isFinite(media.duration)) {
            const percent = (media.currentTime / media.duration) * 100;
            progressFill.style.width = percent + "%";
        }
    }
    
    /**
     * Continuous progress update loop using RAF
     */
    function startProgressLoop() {
        if (updateRAFId === null) {
            function loop() {
                updateProgress();
                updateRAFId = requestAnimationFrame(loop);
            }
            updateRAFId = requestAnimationFrame(loop);
        }
    }
    
    /**
     * Stop the progress update loop
     */
    function stopProgressLoop() {
        if (updateRAFId !== null) {
            cancelAnimationFrame(updateRAFId);
            updateRAFId = null;
        }
    }
    
    /**
     * Format seconds to MM:SS time format
     */
    function formatTime(seconds) {
        if (!isFinite(seconds)) return "0:00";
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    }
    
    /**
     * Show time indicator on progress bar hover or touch
     */
    function updateProgressHover(e) {
        const rect = progress.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const hoverTime = percent * media.duration;
        
        // Position the hover indicator
        const hoverPercent = percent * 100;
        progressHover.style.left = hoverPercent + "%";
        progressHoverTime.textContent = formatTime(hoverTime);

        if (hoverPercent <= 0) {
            progressHover.style.transform = "translate(0, -50%) scale(1)";
        } else if (hoverPercent >= 100) {
            progressHover.style.transform = "translate(-100%, -50%) scale(1)";
        } else {
            progressHover.style.transform = "translate(-50%, -50%) scale(1)";
        }
    }

    /**
     * Seek to specific time in media with touch/mouse support
     * Optimized with validation and bounds checking
     * @param {MouseEvent|TouchEvent} e - Click or touch event on progress bar
     */
    function seek(e) {
        if (!e.touches && !e.clientX) return; // Validate event
        
        e.preventDefault();
        const rect = progress.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        
        if (media.duration && isFinite(media.duration)) {
            media.currentTime = percent * media.duration;
        }
    }

    // ========== PROGRESS BAR EVENT LISTENERS ==========
    // Mouse events
    progress.addEventListener("mousedown", (e) => {
        isDragging = true;
        seek(e);
    });
    
    progress.addEventListener("mousemove", (e) => {
        updateProgressHover(e);
        if (isDragging) seek(e);
    });
    
    /**
     * Check if mouse is within 4px range of the progress bar
     */
    function isMouseNearProgress(e) {
        const rect = progress.getBoundingClientRect();
        const distFromBar = Math.abs(e.clientY - (rect.top + rect.height / 2));
        return distFromBar <= (rect.height / 2 + 7); // 7px expansion zone
    }
    
    // Detect when mouse is near progress bar (even outside it)
    // But skip this when dragging - let window mousemove handle it
    controls.addEventListener("mousemove", (e) => {
        if (isDragging) return; // Skip when dragging
        
        if (isMouseNearProgress(e)) {
            updateProgressHover(e);
            progressHover.classList.add("visible");
            progress.classList.add("hover");
        } else {
            progressHover.classList.remove("visible");
            progress.classList.remove("hover");
        }
    });
    
    // Keep expanded while dragging
    progress.addEventListener("mousedown", () => {
        progress.classList.add("hover");
        progressHover.classList.add("visible");
    });

    window.addEventListener("mousemove", (e) => {
        if (isDragging) {
            updateProgressHover(e);
            seek(e);
            // Ensure indicator stays visible while dragging anywhere
            if (!progressHover.classList.contains("visible")) {
                progressHover.classList.add("visible");
                progress.classList.add("hover");
            }
        }
    });

    window.addEventListener("mouseup", () => {
        isDragging = false;
        // Remove hover state when mouse is released
        setTimeout(() => {
            if (!isDragging) {
                progressHover.classList.remove("visible");
                progress.classList.remove("hover");
            }
        }, 0);
    });
    
    // Remove hover state when mouse leaves controls area
    controls.addEventListener("mouseleave", () => {
        progressHover.classList.remove("visible");
        progress.classList.remove("hover");
    });

    // Touch events for mobile
    progress.addEventListener("touchstart", (e) => {
        isDragging = true;
        updateProgressHover(e);
        progressHover.classList.add("visible");
        progress.classList.add("hover");
        seek(e);
    }, { passive: false });

    window.addEventListener("touchmove", (e) => {
        if (isDragging) {
            e.preventDefault();
            updateProgressHover(e);
            seek(e);
            if (!progressHover.classList.contains("visible")) {
                progressHover.classList.add("visible");
                progress.classList.add("hover");
            }
        }
    }, { passive: false });

    window.addEventListener("touchend", () => {
        isDragging = false;
        progressHover.classList.remove("visible");
        progress.classList.remove("hover");
    });

    // ========== PLAY BUTTON EVENT LISTENER ==========
    playBtn.addEventListener("click", togglePlay);

    // ========== FULLSCREEN MANAGEMENT ==========
    
    /**
     * Toggle fullscreen mode for video player
     */
    function toggleFullscreen() {
        if (!isVideo) return;
        if (!document.fullscreenElement) {
            wrapper.requestFullscreen().catch(err => console.log(err));
        } else {
            document.exitFullscreen();
        }
    }

    /**
     * Update fullscreen button icon and wrapper class when fullscreen state changes
     */
    document.addEventListener("fullscreenchange", () => {
        if (document.fullscreenElement === wrapper) {
            wrapper.classList.add("in-fullscreen");
            if (fullscreenBtn) {
                fullscreenBtn.innerHTML = ICONS.fullscreenExit;
            }
        } else {
            wrapper.classList.remove("in-fullscreen");
            if (fullscreenBtn) {
                fullscreenBtn.innerHTML = ICONS.fullscreen;
            }
        }
    });

    // ========== AUTO-HIDE INTERFACE WITH MOUSE DETECTION ==========
    
    /**
     * Reset the hide timer for mouse/keyboard inactivity
     * Shows interface and resets the 2-second inactivity timer
     */
    function resetHideTimer() {
        wrapper.classList.remove("hide-interface");
        clearTimeout(hideTimeout);
        
        // Only hide interface if video is playing AND not in small screen mode
        if (!media.paused && isVideo && !isSmallScreen) {
            hideTimeout = setTimeout(() => {
                // Don't hide if mouse is hovering over controls
                if (!controls.matches(':hover')) {
                    wrapper.classList.add("hide-interface");
                }
            }, 2000);
        }
    }

    // ========== SINGLE VS DOUBLE CLICK DETECTION ==========
    if (isVideo) {
        /**
         * Detect single vs double click on desktop:
         * - Single click: toggle play/pause
         * - Double click: toggle fullscreen
         */
        let clickCount = 0;
        wrapper.addEventListener("click", (e) => {
            // Ignore clicks on controls or inputs
            if (e.target.closest(".vs-controls") || e.target.tagName === "INPUT") return;

            clickCount++;
            
            if (clickCount === 1) {
                // First click detected
                clickTimer = setTimeout(() => {
                    if (clickCount === 1) {
                        togglePlay();
                    }
                    clickCount = 0;
                }, 200); // 200ms window to detect second click
            } else if (clickCount === 2) {
                // Second click detected
                clearTimeout(clickTimer);
                clickCount = 0;
                toggleFullscreen();
            }
        });

        // Add touch support for mobile double-tap
        let lastTouchTime = 0;
        let touchCount = 0;
        wrapper.addEventListener("touchend", (e) => {
            if (e.target.closest(".vs-controls") || e.target.tagName === "INPUT") return;
            
            const currentTime = new Date().getTime();
            const tapLength = currentTime - lastTouchTime;
            
            if (tapLength < 300 && tapLength > 0) {
                // Double tap detected
                e.preventDefault();
                lastTouchTime = 0;
                toggleFullscreen();
            } else {
                // Single tap
                if (lastTouchTime === 0) {
                    togglePlay();
                }
                lastTouchTime = currentTime;
            }
        });

        // Mouse movement and activity handlers
        wrapper.addEventListener("mousemove", resetHideTimer);
        wrapper.addEventListener("click", resetHideTimer);
        media.addEventListener("play", resetHideTimer);
        
        // Clear hide timeout when paused
        media.addEventListener("pause", () => {
            wrapper.classList.remove("hide-interface");
            clearTimeout(hideTimeout);
        });
    }

    // ========== VOLUME CONTROL ==========
    
    /**
     * Update volume when slider changes
     */
    volume.addEventListener("input", () => {
        media.volume = volume.value;
        media.muted = volume.value == 0;

        volumeBtn.innerHTML = media.muted ? ICONS.mute : ICONS.volume;
    });

    /**
     * Toggle mute when volume button clicked
     */
    // NOTE: volume button behavior is handled above (it depends on small/large screen).
    // Removed duplicate listener to avoid conflicting actions.

    // ========== FULLSCREEN BUTTON EVENT LISTENER ==========
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener("click", toggleFullscreen);
    }

    // ========== MEDIA EVENT LISTENERS ==========
    media.addEventListener("play", updatePlayState);
    media.addEventListener("pause", updatePlayState);
    media.addEventListener("loadedmetadata", () => {
        updateProgress();
        startProgressLoop();
    });
    
    // Start progress loop when wrapper is created
    startProgressLoop();

    // ========== KEYBOARD SHORTCUTS ==========
    wrapper.tabIndex = 0;

    wrapper.addEventListener("keydown", (e) => {
        // Ignore keyboard shortcuts when typing in an input
        const tag = document.activeElement.tagName;
        if (tag === "INPUT") return;

        switch (e.code) {
            // Spacebar or K: Play/Pause
            case "KeyK":
            case "Space":
                e.preventDefault();
                togglePlay();
                break;

            // M: Toggle Mute
            case "KeyM":
                media.muted = !media.muted;
                volumeBtn.innerHTML = media.muted ? ICONS.mute : ICONS.volume;
                break;

            // F: Fullscreen
            case "KeyF":
                e.preventDefault();
                toggleFullscreen();
                break;

            // Right Arrow: Skip forward 5 seconds
            case "ArrowRight":
                media.currentTime += 5;
                break;

            // Left Arrow: Rewind 5 seconds
            case "ArrowLeft":
                media.currentTime -= 5;
                break;
        }
    });

    // Initialize play state on setup
    updatePlayState();
}

// ============================================================
// PUBLIC API - Initialize player on specific selector
// ============================================================

/**
 * Initializes the custom player on all matching elements
 * Usage: videoStyle(".player");
 * @param {string} selector - CSS selector for media elements to enhance
 */
window.videoStyle = function(selector) {
    document.querySelectorAll(selector).forEach(setup);
};

// ============================================================
// AUTO-INITIALIZATION - Watch for dynamically added media
// ============================================================

/**
 * Monitor DOM for dynamically added media elements with data-vs-auto attribute
 * Automatically initializes the player on new elements
 */
const observer = new MutationObserver(() => {
    document.querySelectorAll("[data-vs-auto]").forEach(setup);
});

/**
 * Start observing the DOM when page loads
 */
document.addEventListener("DOMContentLoaded", function () {
    observer.observe(document.body, {
        childList: true,    // Watch for added/removed elements
        subtree: true       // Watch all descendants
    });
});