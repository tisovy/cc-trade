// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import viteConfig from '../../vite.config.js';
import {
  getAnalyticsConfig,
  requestActivityMetrics,
  requestAnalyticsCombined,
} from './analytics';
import { attachMockLocalStorage } from '../test/mocks';

const jsonResponse = (data) => ({
  ok: true,
  status: 200,
  json: vi.fn(() => Promise.resolve(data)),
});

describe('analytics config hardening', () => {
  beforeEach(() => {
    attachMockLocalStorage();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('does not expose ANALYTICS_SECRET through Vite define', () => {
    expect(viteConfig.define).not.toHaveProperty('process.env.ANALYTICS_SECRET');
  });

  it('redacts legacy localStorage secrets and disables renderer signing path', () => {
    localStorage.setItem(
      'analyticsConfig',
      JSON.stringify({
        baseUrl: 'http://analytics.local',
        key: 'public-key',
        secret: 'legacy-secret',
        pollInterval: 10000,
        limit: 50,
      })
    );

    const config = getAnalyticsConfig();

    expect(config).toEqual({
      baseUrl: 'http://analytics.local',
      key: 'public-key',
      pollInterval: 10000,
      limit: 50,
      enabled: false,
      authMode: 'main-process-required',
    });
    expect(config).not.toHaveProperty('secret');

    const cached = JSON.parse(localStorage.setItem.mock.calls.at(-1)[1]);
    expect(cached).not.toHaveProperty('secret');
    expect(cached.enabled).toBe(false);
    expect(cached.authMode).toBe('main-process-required');
  });

  it('scrubs legacy localStorage secret even when baseUrl is missing', () => {
    localStorage.setItem('analyticsConfig', JSON.stringify({ secret: 'legacy-secret' }));

    const config = getAnalyticsConfig();

    expect(config).not.toHaveProperty('secret');
    expect(config.enabled).toBe(false);
    expect(config.authMode).toBe('main-process-required');

    const cached = JSON.parse(localStorage.setItem.mock.calls.at(-1)[1]);
    expect(cached).not.toHaveProperty('secret');
    expect(JSON.stringify(cached)).not.toContain('legacy-secret');
  });

  it('ignores process env secret and caches only sanitized renderer config', () => {
    vi.stubEnv('ANALYTICS_URL', 'http://env-analytics.local');
    vi.stubEnv('ANALYTICS_KEY', 'public-key');
    vi.stubEnv('ANALYTICS_SECRET', 'env-secret');

    const config = getAnalyticsConfig();

    expect(config).toMatchObject({
      baseUrl: 'http://env-analytics.local',
      key: 'public-key',
      enabled: true,
      authMode: 'none',
    });
    expect(config).not.toHaveProperty('secret');

    const cached = JSON.parse(localStorage.setItem.mock.calls.at(-1)[1]);
    expect(cached).not.toHaveProperty('secret');
    expect(JSON.stringify(cached)).not.toContain('env-secret');
  });

  it('disables renderer analytics from the non-secret main signing flag', () => {
    vi.stubEnv('ANALYTICS_URL', 'http://env-analytics.local');
    vi.stubEnv('ANALYTICS_KEY', 'public-key');
    vi.stubEnv('ANALYTICS_REQUIRES_MAIN_SIGNING', 'true');

    const config = getAnalyticsConfig();

    expect(config).toMatchObject({
      baseUrl: 'http://env-analytics.local',
      key: 'public-key',
      enabled: false,
      authMode: 'main-process-required',
    });
    expect(config).not.toHaveProperty('secret');
  });

  it('disables renderer analytics from the main signing flag without requiring an env URL', () => {
    vi.stubEnv('ANALYTICS_URL', '');
    vi.stubEnv('ANALYTICS_BASE_URL', '');
    vi.stubEnv('ANALYTICS_REQUIRES_MAIN_SIGNING', 'true');

    const config = getAnalyticsConfig();

    expect(config).toMatchObject({
      baseUrl: 'http://localhost:3000',
      enabled: false,
      authMode: 'main-process-required',
    });

    const cached = JSON.parse(localStorage.setItem.mock.calls.at(-1)[1]);
    expect(cached).not.toHaveProperty('secret');
    expect(cached.enabled).toBe(false);
    expect(cached.authMode).toBe('main-process-required');
  });

  it('does not fetch from the renderer when main-process signing is required', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem(
      'analyticsConfig',
      JSON.stringify({
        baseUrl: 'http://analytics.local',
        key: 'public-key',
        authMode: 'main-process-required',
        enabled: false,
      })
    );

    await expect(requestAnalyticsCombined({ limit: 10 })).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends unsigned renderer requests without analytics auth headers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ strength: { metrics: [] }, endurance: { metrics: [] } }))
      .mockResolvedValueOnce(jsonResponse({ intervals: {}, generatedAt: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem(
      'analyticsConfig',
      JSON.stringify({
        baseUrl: 'http://analytics.local',
        key: 'public-key',
      })
    );

    await requestAnalyticsCombined({ limit: 10 });
    await requestActivityMetrics({ interval: '5m', limit: 10, volumeThreshold: 1000 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({});
    expect(fetchMock.mock.calls[1][1].headers).toEqual({});
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('X-Analytics-Signature');
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('public-key');
  });
});
