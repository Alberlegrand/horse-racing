/**
 * API Client helper - uses cookies for authentication
 */

const API_BASE = '/api/v1';

/**
 * Get default headers
 */
function getHeaders(customHeaders = {}) {
  return {
    'Content-Type': 'application/json',
    ...customHeaders
  };
}

/**
 * Fetch wrapper that handles auth errors
 */
async function apiFetch(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const fetchOptions = {
    ...options,
    credentials: 'include', // Include cookies automatically
    headers: getHeaders(options.headers || {})
  };

  try {
    const response = await fetch(url, fetchOptions);
    
    // If 401 or 403, redirect to login
    if (response.status === 401 || response.status === 403) {
      console.warn('Authentication failed, redirecting to login');
      window.location.href = '/';
      return null;
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (err) {
    console.error(`API Error (${endpoint}):`, err);
    throw err;
  }
}

/**
 * GET request
 */
export function apiGet(endpoint) {
  return apiFetch(endpoint, { method: 'GET' });
}

/**
 * POST request
 */
export function apiPost(endpoint, data) {
  return apiFetch(endpoint, {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

/**
 * PUT request
 */
export function apiPut(endpoint, data) {
  return apiFetch(endpoint, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

/**
 * DELETE request
 */
export function apiDelete(endpoint) {
  return apiFetch(endpoint, { method: 'DELETE' });
}

/**
 * Logout
 */
export function logout() {
  return apiFetch('/auth/logout', { method: 'POST' }).then(() => {
    window.location.href = '/';
  });
}
