/**
 * Image Zoom Functionality
 * 
 * This function adds click-to-zoom functionality to images matching the provided selector.
 * When an image is clicked, it zooms to fit the viewport with a 10px margin on all sides.
 * Click again or click outside the image to close the zoom.
 * 
 * @param {string} selector - CSS selector for images to apply zoom functionality to
 */
const imageZoom = (selector) => {
  // 1. Inject necessary styles (only once)
  if (!document.getElementById('custom-zoom-styles')) {
    const style = document.createElement('style');
    style.id = 'custom-zoom-styles';
    style.textContent = `
      .zoom-active {
        position: relative;
        z-index: 99999 !important;
        cursor: zoom-out !important;
        transition: transform 0.3s cubic-bezier(0.2, 0, 0.2, 1) !important;
        border-radius: 0px !important;
      }
      .zoom-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.85);
        z-index: 99998;
        opacity: 0;
        transition: opacity 0.3s ease;
        pointer-events: none;
      }
      .zoom-overlay.is-visible {
        opacity: 1;
        pointer-events: auto;
      }
      .zoom-no-scroll {
        overflow: hidden !important;
      }
    `;
    document.head.appendChild(style);
  }

  // 2. Create background overlay (only once)
  let overlay = document.querySelector('.zoom-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'zoom-overlay';
    document.body.appendChild(overlay);
  }

  let activeImg = null;

  // Internal function to close the zoom
  const closeZoom = () => {
    if (!activeImg) return;
    
    activeImg.style.transform = 'none';
    overlay.classList.remove('is-visible');
    
    // Devolver el scroll al body inmediatamente al empezar a cerrar
    document.body.classList.remove('zoom-no-scroll');
    
    activeImg.addEventListener('transitionend', () => {
      if (activeImg && !overlay.classList.contains('is-visible')) {
        activeImg.style.transition = '';
        activeImg.classList.remove('zoom-active');
        activeImg = null;
      }
    }, { once: true });
  };

  // 3. Apply zoom logic to elements matching the selector
  document.querySelectorAll(selector).forEach(img => {
    img.style.cursor = 'zoom-in';

    img.addEventListener('click', () => {
      if (activeImg) {
        closeZoom();
        return;
      }

      // Hide scrollbars BEFORE calculating dimensions
      document.body.classList.add('zoom-no-scroll');

      activeImg = img;
      img.classList.add('zoom-active');
      overlay.classList.add('is-visible');

      img.style.transition = 'transform 0.3s cubic-bezier(0.2, 0, 0.2, 1)';

      // Dimensiones de la imagen y ventana (ya sin scrollbars)
      const rect = img.getBoundingClientRect();
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;

      // Calcular centro
      const translateX = (windowWidth / 2) - (rect.left + rect.width / 2);
      const translateY = (windowHeight / 2) - (rect.top + rect.height / 2);

      // 10px MARGIN: Subtract 20px from total available (10px on each side)
      const maxAvailableWidth = windowWidth - 20;
      const maxAvailableHeight = windowHeight - 20;

      // Calculate maximum scale respecting the 10px margin
      const scaleX = maxAvailableWidth / rect.width;
      const scaleY = maxAvailableHeight / rect.height;
      const maxScale = Math.min(scaleX, scaleY);

      // Aplicar transformación
      img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${maxScale})`;
    });
  });

  // Global events to close zoom
  overlay.addEventListener('click', closeZoom);
  window.addEventListener('resize', closeZoom);
  
  // Just in case user tries to use mouse wheel
  window.addEventListener('wheel', (e) => {
    if (activeImg) {
      e.preventDefault();
      closeZoom();
    }
  }, { passive: false });
};