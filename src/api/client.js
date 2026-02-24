/**
 * API client for future backend calls.
 * No backend connected yet – use static data via src/data/staticData.js
 */

import { API_CONFIG } from './config.js';

export async function apiRequest(endpoint, options = {}) {
  const url = API_CONFIG.baseURL ? `${API_CONFIG.baseURL.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}` : null;
  if (!url) {
    return Promise.reject(new Error('API baseURL not configured. Using static data.'));
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeout);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
    const data = await res.json().catch(() => ({}));
    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

export function get(endpoint) {
  return apiRequest(endpoint, { method: 'GET' });
}

export function post(endpoint, body) {
  return apiRequest(endpoint, { method: 'POST', body: JSON.stringify(body) });
}

export function put(endpoint, body) {
  return apiRequest(endpoint, { method: 'PUT', body: JSON.stringify(body) });
}

export function del(endpoint) {
  return apiRequest(endpoint, { method: 'DELETE' });
}
