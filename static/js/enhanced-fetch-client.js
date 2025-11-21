/**
 * Enhanced Fetch Client with Automatic Retry & Error Handling
 * Wraps all fetch calls with loading states and connection management
 */
class EnhancedFetchClient {
  constructor() {
    this.isRetrying = false;
    this.retryDelay = 1000; // ms
    this.maxRetries = 3;
    this.timeout = 10000; // ms
    this.requestQueue = [];
    this.isProcessingQueue = false;
  }

  /**
   * Main fetch method with auto-retry and loading state
   * @param {string} url - URL to fetch
   * @param {Object} options - Fetch options
   * @param {HTMLElement} button - Button element to show loading state
   */
  async fetch(url, options = {}, button = null) {
    // Add button loading state if provided
    if (button) {
      window.buttonLoader?.start(button, 'Chargement...');
    }

    try {
      const response = await this.retryWithBackoff(() =>
        this.fetchWithTimeout(url, options)
      );

      if (!response.ok) {
        const data = await this.safeJsonParse(response);
        const error = new Error(data?.error || `Erreur HTTP ${response.status}`);
        error.status = response.status;
        error.response = data;
        throw error;
      }

      return await this.safeJsonParse(response);
    } catch (error) {
      await window.connectionErrorHandler?.handleFetchError(error, {
        url,
        status: error.status
      });
      throw error;
    } finally {
      if (button) {
        window.buttonLoader?.stop(button);
      }
    }
  }

  /**
   * Fetch with abort timeout
   */
  async fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeout = options.timeout || this.timeout;
    
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
        credentials: options.credentials || 'include'
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Retry with exponential backoff
   */
  async retryWithBackoff(operation, maxAttempts = this.maxRetries) {
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        // Don't retry on client errors (400-499) except for 408, 429
        if (error.status >= 400 && error.status < 500) {
          if (error.status !== 408 && error.status !== 429) {
            throw error;
          }
        }

        if (attempt === maxAttempts) {
          throw error;
        }

        // Check if it's a retryable error
        if (!this.isRetryableError(error)) {
          throw error;
        }

        const delay = Math.pow(2, attempt - 1) * this.retryDelay;
        console.log(`[FETCH RETRY] Attempt ${attempt}/${maxAttempts}, retrying in ${delay}ms...`);

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  /**
   * Check if error is retryable
   */
  isRetryableError(error) {
    // Network errors
    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      return true;
    }

    // Timeout errors
    if (error.name === 'AbortError' || error.message.includes('timeout')) {
      return true;
    }

    // Server errors (5xx)
    if (error.status >= 500) {
      return true;
    }

    // Too Many Requests
    if (error.status === 429) {
      return true;
    }

    // Request Timeout
    if (error.status === 408) {
      return true;
    }

    return false;
  }

  /**
   * Safe JSON parsing
   */
  async safeJsonParse(response) {
    try {
      const text = await response.clone().text();
      return text ? JSON.parse(text) : {};
    } catch (e) {
      return { error: response.statusText };
    }
  }

  /**
   * POST request with auto-retry
   */
  async post(url, data, button = null) {
    return this.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    }, button);
  }

  /**
   * GET request with auto-retry
   */
  async get(url, button = null) {
    return this.fetch(url, {
      method: 'GET'
    }, button);
  }

  /**
   * DELETE request with auto-retry
   */
  async delete(url, button = null) {
    return this.fetch(url, {
      method: 'DELETE'
    }, button);
  }

  /**
   * PUT request with auto-retry
   */
  async put(url, data, button = null) {
    return this.fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    }, button);
  }

  /**
   * Batch requests with concurrency control
   */
  async batch(requests, concurrency = 3) {
    const results = [];
    const executing = [];

    for (let i = 0; i < requests.length; i++) {
      const request = requests[i];
      const promise = Promise.resolve().then(() => this.fetch(
        request.url,
        request.options,
        request.button
      )).then(
        result => (results[i] = { success: true, data: result }),
        error => (results[i] = { success: false, error })
      );

      executing.push(promise);

      if (executing.length >= concurrency) {
        await Promise.race(executing);
        executing.splice(executing.findIndex(p => p === promise), 1);
      }
    }

    await Promise.all(executing);
    return results;
  }

  /**
   * Queue request for later execution
   */
  queueRequest(request) {
    this.requestQueue.push(request);
    this.processQueue();
  }

  /**
   * Process queued requests
   */
  async processQueue() {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;
    try {
      while (this.requestQueue.length > 0) {
        const request = this.requestQueue.shift();
        try {
          await this.fetch(request.url, request.options, request.button);
        } catch (error) {
          console.error('[QUEUE] Failed to process request:', error);
          // Re-queue failed request for retry
          this.requestQueue.unshift(request);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }
}

// Export singleton instance
window.enhancedFetch = new EnhancedFetchClient();
