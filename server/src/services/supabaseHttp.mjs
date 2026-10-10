import { CONFIG } from '../config.mjs';

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function retryDelayMs(attempt, response) {
  const retryAfter = response?.headers?.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const dateDelay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay) && dateDelay > 0) return Math.min(dateDelay, 1500);
  }
  return Math.min(150 * (2 ** attempt) + Math.floor(Math.random() * 100), 1000);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Make bounded Supabase requests. Safe reads retry transient network/provider
 * failures; writes are never retried because their commit status may be unknown.
 */
export async function fetchSupabase(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const canRetry = ['GET', 'HEAD'].includes(method) && !options.signal;
  const retries = canRetry ? CONFIG.SUPABASE_HTTP_RETRIES : 0;
  const timeoutMs = CONFIG.SUPABASE_HTTP_TIMEOUT_MS;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        ...options,
        signal: options.signal || AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      if (attempt >= retries) throw error;
      await wait(retryDelayMs(attempt));
      continue;
    }

    if (!canRetry || attempt >= retries || !RETRYABLE_STATUSES.has(response.status)) return response;
    await response.body?.cancel().catch(() => {});
    await wait(retryDelayMs(attempt, response));
  }

  throw new Error('Supabase request could not be completed.');
}
