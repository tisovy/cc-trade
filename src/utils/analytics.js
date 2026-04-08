/**
 * Analytics API client
 * 
 * Configuration sources (in priority order):
 * 1. localStorage 'analyticsConfig'
 * 2. process.env (Node/Electron)
 * 3. Default to localhost:3000
 */

const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

const bufferToHex = (buffer) => {
  if (!buffer) return "";
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const getSubtleCrypto = () => {
  if (typeof window !== "undefined" && window.crypto?.subtle) {
    return window.crypto.subtle;
  }
  if (typeof self !== "undefined" && self.crypto?.subtle) {
    return self.crypto.subtle;
  }
  return null;
};

/**
 * Get analytics config from multiple sources
 * Priority: localStorage > process.env > defaults
 */
export const getAnalyticsConfig = () => {
  // Try localStorage first
  try {
    const stored = localStorage.getItem('analyticsConfig');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === 'object' && parsed.baseUrl) {
        return {
          baseUrl: String(parsed.baseUrl || '').trim(),
          key: String(parsed.key || '').trim(),
          secret: String(parsed.secret || '').trim(),
          pollInterval: Math.max(5000, Number(parsed.pollInterval) || 45000),
          limit: Math.min(200, Math.max(5, Number(parsed.limit) || 40)),
        };
      }
    }
  } catch {
    // Ignore parse errors
  }

  // Try process.env (works in Electron with nodeIntegration: true)
  // eslint-disable-next-line no-undef
  const env = typeof process !== 'undefined' ? process.env : {};
  if (env.ANALYTICS_URL || env.ANALYTICS_BASE_URL) {
    const config = {
      baseUrl: String(env.ANALYTICS_URL || env.ANALYTICS_BASE_URL || '').trim(),
      key: String(env.ANALYTICS_KEY || '').trim(),
      secret: String(env.ANALYTICS_SECRET || '').trim(),
      pollInterval: Math.max(5000, Number(env.ANALYTICS_POLL_INTERVAL) || 45000),
      limit: Math.min(200, Math.max(5, Number(env.ANALYTICS_LIMIT) || 40)),
    };

    // Cache to localStorage for future use
    if (config.baseUrl) {
      try {
        localStorage.setItem('analyticsConfig', JSON.stringify(config));
        console.log('[Analytics] Cached config from environment to localStorage');
      } catch {
        // Ignore storage errors
      }
    }

    return config;
  }

  // Default fallback
  return {
    baseUrl: 'http://localhost:3000', // TODO: update this address
    key: '',
    secret: '',
    pollInterval: 45000,
    limit: 40
  };
};

const hmacSha256Hex = async (secret, payload) => {
  if (!secret || !payload) {
    throw new Error("Missing secret or payload for HMAC");
  }

  const subtle = getSubtleCrypto();
  if (!subtle || !encoder) {
    throw new Error("WebCrypto is not available for analytics signing");
  }

  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(payload);
  const cryptoKey = await subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign"]
  );
  const signatureBuffer = await subtle.sign("HMAC", cryptoKey, messageData);
  return bufferToHex(signatureBuffer);
};

const buildRouteUrl = (baseUrl, route) => {
  if (!baseUrl) {
    throw new Error("Missing analytics base URL");
  }
  const normalizedRoute = route.startsWith("/") ? route : `/${route}`;
  return new URL(normalizedRoute, baseUrl);
};

const getRelativePath = (url) => {
  if (!(url instanceof URL)) return "";
  return `${url.pathname}${url.search || ""}`;
};

export const requestAnalyticsCombined = async ({ limit, signal } = {}) => {
  const config = getAnalyticsConfig();

  console.log('[Analytics] Config loaded:', {
    baseUrl: config.baseUrl,
    hasKey: !!config.key,
    hasSecret: !!config.secret
  });

  if (!config.baseUrl) {
    console.log('[Analytics] No baseUrl configured');
    return null;
  }

  const url = buildRouteUrl(config.baseUrl, "/analytics/combined");
  if (limit && Number.isFinite(Number(limit))) {
    url.searchParams.set("limit", Math.max(1, Number(limit)));
  }

  // Build headers - only include auth if credentials are configured
  const headers = {};
  if (config.key && config.secret) {
    const relativePath = getRelativePath(url);
    const timestamp = Date.now().toString();
    const payload = `${config.key}:${timestamp}:GET:${relativePath}:`;
    const signature = await hmacSha256Hex(config.secret, payload);
    headers["X-Analytics-Key"] = config.key;
    headers["X-Analytics-Ts"] = timestamp;
    headers["X-Analytics-Signature"] = signature;
    console.log('[Analytics] Auth headers added for combined request');
  } else {
    console.log('[Analytics] No auth credentials, sending unauthenticated request');
  }

  const startTime = Date.now();
  console.log('[Analytics] Fetching combined:', url.toString());

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers,
      signal,
    });

    const elapsed = Date.now() - startTime;
    console.log(`[Analytics] Combined response: ${response.status} in ${elapsed}ms`);

    if (!response.ok) {
      let message;
      try {
        message = await response.text();
      } catch {
        message = "";
      }
      console.error('[Analytics] Combined request failed:', response.status, message);
      const error = new Error(message || `Analytics request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }

    const data = await response.json();
    console.log('[Analytics] Combined data received:', {
      strengthCount: data.strength?.items?.length || 0,
      enduranceCount: data.endurance?.items?.length || 0
    });
    return data;
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`[Analytics] Combined fetch error after ${elapsed}ms:`, err.message);
    throw err;
  }
};

export const requestActivityMetrics = async ({ interval, limit, volumeThreshold, signal } = {}) => {
  const config = getAnalyticsConfig();

  console.log('[Analytics] Config loaded for activity:', {
    baseUrl: config.baseUrl,
    hasKey: !!config.key,
    hasSecret: !!config.secret
  });

  if (!config.baseUrl) {
    console.log('[Analytics] No baseUrl configured');
    return null;
  }

  const url = buildRouteUrl(config.baseUrl, "/analytics/activity");
  if (interval && typeof interval === "string") {
    url.searchParams.set("interval", interval);
  }
  if (limit && Number.isFinite(Number(limit))) {
    url.searchParams.set("limit", Math.max(1, Number(limit)));
  }
  if (Number.isFinite(Number(volumeThreshold)) && Number(volumeThreshold) > 0) {
    url.searchParams.set("volumeThreshold", Number(volumeThreshold));
  }

  // Build headers - only include auth if credentials are configured
  const headers = {};
  if (config.key && config.secret) {
    const relativePath = getRelativePath(url);
    const timestamp = Date.now().toString();
    const payload = `${config.key}:${timestamp}:GET:${relativePath}:`;
    const signature = await hmacSha256Hex(config.secret, payload);
    headers["X-Analytics-Key"] = config.key;
    headers["X-Analytics-Ts"] = timestamp;
    headers["X-Analytics-Signature"] = signature;
    console.log('[Analytics] Auth headers added for activity request');
  } else {
    console.log('[Analytics] No auth credentials, sending unauthenticated request');
  }

  const startTime = Date.now();
  console.log('[Analytics] Fetching activity:', url.toString());

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers,
      signal,
    });

    const elapsed = Date.now() - startTime;
    console.log(`[Analytics] Activity response: ${response.status} in ${elapsed}ms`);

    if (!response.ok) {
      let message;
      try {
        message = await response.text();
      } catch {
        message = "";
      }
      console.error('[Analytics] Activity request failed:', response.status, message);
      const error = new Error(message || `Activity request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }

    const data = await response.json();
    console.log('[Analytics] Activity data received:', {
      generatedAt: data.generatedAt,
      intervalCount: Object.keys(data.intervals || {}).length
    });
    return data;
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`[Analytics] Activity fetch error after ${elapsed}ms:`, err.message);
    throw err;
  }
};
