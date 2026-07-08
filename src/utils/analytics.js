/**
 * Analytics API client
 * 
 * Configuration sources (in priority order):
 * 1. localStorage 'analyticsConfig' (non-secret values only)
 * 2. process.env (non-secret Vite/Electron values only)
 * 3. Default to localhost:3000
 */

const DEFAULT_ANALYTICS_CONFIG = {
  baseUrl: 'http://localhost:3000',
  key: '',
  pollInterval: 45000,
  limit: 40,
  enabled: true,
  authMode: 'none',
};

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const normalizeAnalyticsConfig = (source = {}) => {
  const hadSecret = hasOwn(source, 'secret') && Boolean(source.secret);
  const requiresMainProcessSigning = hadSecret || source.authMode === 'main-process-required';

  return {
    baseUrl: String(source.baseUrl || DEFAULT_ANALYTICS_CONFIG.baseUrl).trim(),
    key: String(source.key || '').trim(),
    pollInterval: Math.max(5000, Number(source.pollInterval) || DEFAULT_ANALYTICS_CONFIG.pollInterval),
    limit: Math.min(200, Math.max(5, Number(source.limit) || DEFAULT_ANALYTICS_CONFIG.limit)),
    enabled: source.enabled === false || requiresMainProcessSigning ? false : true,
    authMode: requiresMainProcessSigning ? 'main-process-required' : 'none',
  };
};

const writeSanitizedAnalyticsConfig = (config) => {
  try {
    localStorage.setItem('analyticsConfig', JSON.stringify(config));
  } catch {
    // Ignore storage errors
  }
};

/**
 * Get analytics config from multiple sources without exposing signing secrets.
 * Priority: localStorage > non-secret process.env > defaults.
 */
export const getAnalyticsConfig = () => {
  try {
    const stored = localStorage.getItem('analyticsConfig');
    if (stored) {
      const parsed = JSON.parse(stored);
      const hasConfigValues = parsed && typeof parsed === 'object' && (
        parsed.baseUrl ||
        parsed.key ||
        parsed.pollInterval ||
        parsed.limit ||
        parsed.enabled === false ||
        parsed.authMode ||
        hasOwn(parsed, 'secret')
      );
      if (hasConfigValues) {
        const config = normalizeAnalyticsConfig(parsed);
        if (hasOwn(parsed, 'secret')) {
          writeSanitizedAnalyticsConfig(config);
        }
        return config;
      }
    }
  } catch {
    // Ignore storage and parse errors
  }

  // eslint-disable-next-line no-undef -- Electron exposes process in renderer.
  const env = typeof process !== 'undefined' ? process.env : {};
  const requiresMainProcessSigning = env.ANALYTICS_REQUIRES_MAIN_SIGNING === 'true';
  if (env.ANALYTICS_URL || env.ANALYTICS_BASE_URL || requiresMainProcessSigning) {
    const config = normalizeAnalyticsConfig({
      baseUrl: env.ANALYTICS_URL || env.ANALYTICS_BASE_URL,
      key: env.ANALYTICS_KEY,
      pollInterval: env.ANALYTICS_POLL_INTERVAL,
      limit: env.ANALYTICS_LIMIT,
      enabled: !requiresMainProcessSigning,
      authMode: requiresMainProcessSigning ? 'main-process-required' : 'none',
    });

    if (config.baseUrl) {
      writeSanitizedAnalyticsConfig(config);
      console.log('[Analytics] Cached sanitized config from environment to localStorage');
    }

    return config;
  }

  return { ...DEFAULT_ANALYTICS_CONFIG };
};

const buildRouteUrl = (baseUrl, route) => {
  if (!baseUrl) {
    throw new Error("Missing analytics base URL");
  }
  const normalizedRoute = route.startsWith("/") ? route : `/${route}`;
  return new URL(normalizedRoute, baseUrl);
};

const isAnalyticsEnabled = (config) => {
  if (!config.baseUrl) {
    console.log('[Analytics] No baseUrl configured');
    return false;
  }
  if (config.enabled === false || config.authMode === 'main-process-required') {
    console.log('[Analytics] Analytics disabled until main-process signing proxy is available');
    return false;
  }
  return true;
};

export const requestAnalyticsCombined = async ({ limit, signal } = {}) => {
  const config = getAnalyticsConfig();

  console.log('[Analytics] Config loaded:', {
    baseUrl: config.baseUrl,
    hasKey: !!config.key,
    enabled: config.enabled,
    authMode: config.authMode
  });

  if (!isAnalyticsEnabled(config)) {
    return null;
  }

  const url = buildRouteUrl(config.baseUrl, "/analytics/combined");
  if (limit && Number.isFinite(Number(limit))) {
    url.searchParams.set("limit", Math.max(1, Number(limit)));
  }

  // Renderer-side signing is intentionally disabled. Authenticated analytics
  // must go through a main-process proxy so the secret never enters React.
  const headers = {};
  console.log('[Analytics] Renderer signing disabled, sending unsigned combined request');

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
    enabled: config.enabled,
    authMode: config.authMode
  });

  if (!isAnalyticsEnabled(config)) {
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

  // Renderer-side signing is intentionally disabled. Authenticated analytics
  // must go through a main-process proxy so the secret never enters React.
  const headers = {};
  console.log('[Analytics] Renderer signing disabled, sending unsigned activity request');

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
