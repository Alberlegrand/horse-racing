/**
 * Button Loader Utility
 * Manages loading states and spinner animation for buttons during async operations
 */
class ButtonLoader {
  constructor() {
    this.activeButtons = new Set();
    this.originalTexts = new Map();
    this.spinnerHTML = `
      <svg class="spinner" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="2" stroke-opacity="0.2"/>
        <path d="M8 1C4.13 1 1 4.13 1 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <style>
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          .spinner { animation: spin 1s linear infinite; display: inline-block; margin-right: 6px; }
        </style>
      </svg>
    `;
  }

  /**
   * Start loading state for button
   * @param {HTMLElement} button - Button element
   * @param {string} loadingText - Text to show while loading (optional)
   */
  start(button, loadingText = 'Chargement...') {
    if (!button) return;

    this.activeButtons.add(button);
    
    // Store original state
    if (!this.originalTexts.has(button)) {
      this.originalTexts.set(button, {
        text: button.innerHTML,
        disabled: button.disabled,
        classList: button.className
      });
    }

    // Apply loading styles
    button.disabled = true;
    button.classList.add('btn-loading', 'opacity-75', 'cursor-wait');
    button.setAttribute('aria-busy', 'true');
    button.setAttribute('aria-label', 'En cours de traitement');
    
    // Update content with spinner
    button.innerHTML = this.spinnerHTML + loadingText;
  }

  /**
   * Stop loading state for button
   * @param {HTMLElement} button - Button element
   */
  stop(button) {
    if (!button || !this.activeButtons.has(button)) return;

    this.activeButtons.delete(button);
    const original = this.originalTexts.get(button);
    
    if (original) {
      button.innerHTML = original.text;
      button.disabled = original.disabled;
      button.className = original.classList;
      button.removeAttribute('aria-busy');
      button.removeAttribute('aria-label');
      this.originalTexts.delete(button);
    }
  }

  /**
   * Execute async operation with button loading state
   * @param {HTMLElement} button - Button element
   * @param {Function} operation - Async function to execute
   * @param {string} loadingText - Text to show while loading (optional)
   */
  async execute(button, operation, loadingText = 'Chargement...') {
    try {
      this.start(button, loadingText);
      const result = await operation();
      this.stop(button);
      return result;
    } catch (error) {
      this.stop(button);
      throw error;
    }
  }

  /**
   * Reset all active loading buttons
   */
  resetAll() {
    for (const button of this.activeButtons) {
      this.stop(button);
    }
    this.activeButtons.clear();
  }
}

// Export singleton instance
window.buttonLoader = new ButtonLoader();
