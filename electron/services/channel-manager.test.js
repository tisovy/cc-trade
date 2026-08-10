/**
 * Tests for ChannelManager and MarketStreamManager
 * 
 * These tests verify:
 * 1. Hub stores connections after view changes
 * 2. Stream deduplication (same stream, multiple subscribers)
 * 3. Depth view enable/disable logic
 * 4. Reconnection debouncing
 * 5. Cleanup behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import the module to test
// Note: We need to re-export for testing since it uses module.exports
const channelManagerModule = await import('./channel-manager.js');
const { ChannelManager, MarketStreamManager, CHANNEL_TYPES } = channelManagerModule;

describe('MarketStreamManager', () => {
    let manager;
    let mockLogger;
    let mockConnectFn;
    let mockMessageHandler;

    beforeEach(() => {
        vi.useFakeTimers();
        
        mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        
        mockConnectFn = vi.fn().mockResolvedValue({
            on: vi.fn(),
            close: vi.fn(),
            disconnect: vi.fn(),
        });
        
        mockMessageHandler = vi.fn();
        
        manager = new MarketStreamManager(mockLogger);
        manager.setConnectFunction(mockConnectFn);
        manager.setMessageHandler(mockMessageHandler);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    describe('Kline Stream Management', () => {
        it('should add kline stream for a channel', () => {
            manager.addKlineStream('mini-BTCUSDT-1h', 'BTCUSDT', '1h');
            
            const streams = manager.getAllStreams();
            expect(streams).toContain('btcusdt@kline_1h');
        });

        it('should track multiple channels subscribing to same stream (deduplication)', () => {
            // Two different channels subscribe to the same stream
            manager.addKlineStream('mini-BTCUSDT-1h', 'BTCUSDT', '1h');
            manager.addKlineStream('detail-BTCUSDT-1h', 'BTCUSDT', '1h');
            
            const streams = manager.getAllStreams();
            // Should only have ONE stream entry despite two subscribers
            expect(streams.filter(s => s === 'btcusdt@kline_1h')).toHaveLength(1);
        });

        it('should not remove stream if other channels still subscribe to it', () => {
            manager.addKlineStream('mini-BTCUSDT-1h', 'BTCUSDT', '1h');
            manager.addKlineStream('detail-BTCUSDT-1h', 'BTCUSDT', '1h');
            
            // Remove one subscriber
            manager.removeKlineStream('mini-BTCUSDT-1h', 'BTCUSDT', '1h');
            
            // Stream should still exist (other channel needs it)
            const streams = manager.getAllStreams();
            expect(streams).toContain('btcusdt@kline_1h');
        });

        it('should remove stream when last subscriber unsubscribes', () => {
            manager.addKlineStream('mini-BTCUSDT-1h', 'BTCUSDT', '1h');
            
            // Remove the only subscriber
            manager.removeKlineStream('mini-BTCUSDT-1h', 'BTCUSDT', '1h');
            
            const streams = manager.getAllStreams();
            expect(streams).not.toContain('btcusdt@kline_1h');
        });

        it('should handle multiple different streams', () => {
            manager.addKlineStream('mini-BTCUSDT-1h', 'BTCUSDT', '1h');
            manager.addKlineStream('mini-ETHUSDT-4h', 'ETHUSDT', '4h');
            manager.addKlineStream('mini-BNBUSDT-1d', 'BNBUSDT', '1d');
            
            const streams = manager.getAllStreams();
            expect(streams).toContain('btcusdt@kline_1h');
            expect(streams).toContain('ethusdt@kline_4h');
            expect(streams).toContain('bnbusdt@kline_1d');
            expect(streams).toHaveLength(3);
        });

        it('should remove all streams for a channel', () => {
            manager.addKlineStream('mini-BTCUSDT-1h', 'BTCUSDT', '1h');
            manager.addKlineStream('mini-BTCUSDT-1h', 'ETHUSDT', '4h'); // Same channel, different stream
            
            manager.removeChannelStreams('mini-BTCUSDT-1h');
            
            const streams = manager.getAllStreams();
            expect(streams).toHaveLength(0);
        });
    });

    describe('Depth View Management', () => {
        it('should NOT include trade/depth streams by default', () => {
            manager.addKlineStream('detail-BTCUSDT-1h', 'BTCUSDT', '1h');
            manager.setDetailSymbol('BTCUSDT');
            
            const streams = manager.getAllStreams();
            expect(streams).toContain('btcusdt@kline_1h');
            expect(streams).not.toContain('btcusdt@trade');
            expect(streams).not.toContain('btcusdt@depth@100ms');
        });

        it('should include trade/depth streams when depth view is enabled', () => {
            manager.addKlineStream('detail-BTCUSDT-1h', 'BTCUSDT', '1h');
            manager.enableDepthView('BTCUSDT');
            
            const streams = manager.getAllStreams();
            expect(streams).toContain('btcusdt@kline_1h');
            expect(streams).toContain('btcusdt@trade');
            expect(streams).toContain('btcusdt@depth@100ms');
        });

        it('should remove trade/depth streams when depth view is disabled', () => {
            manager.addKlineStream('detail-BTCUSDT-1h', 'BTCUSDT', '1h');
            manager.enableDepthView('BTCUSDT');
            
            // Verify they're there
            let streams = manager.getAllStreams();
            expect(streams).toContain('btcusdt@trade');
            
            // Disable depth view
            manager.disableDepthView();
            
            streams = manager.getAllStreams();
            expect(streams).not.toContain('btcusdt@trade');
            expect(streams).not.toContain('btcusdt@depth@100ms');
            // Kline should still be there
            expect(streams).toContain('btcusdt@kline_1h');
        });

        it('should track depth view state correctly', () => {
            expect(manager.isDepthViewEnabled()).toBe(false);
            expect(manager.getDepthViewSymbol()).toBeNull();
            
            manager.enableDepthView('BTCUSDT');
            
            expect(manager.isDepthViewEnabled()).toBe(true);
            expect(manager.getDepthViewSymbol()).toBe('BTCUSDT');
            
            manager.disableDepthView();
            
            expect(manager.isDepthViewEnabled()).toBe(false);
            expect(manager.getDepthViewSymbol()).toBeNull();
        });

        it('should handle depth view symbol change', () => {
            manager.enableDepthView('BTCUSDT');
            
            let streams = manager.getAllStreams();
            expect(streams).toContain('btcusdt@trade');
            
            // Change to different symbol
            manager.enableDepthView('ETHUSDT');
            
            streams = manager.getAllStreams();
            expect(streams).not.toContain('btcusdt@trade');
            expect(streams).toContain('ethusdt@trade');
            expect(streams).toContain('ethusdt@depth@100ms');
        });

        it('should not trigger redundant enable calls for same symbol', () => {
            manager.enableDepthView('BTCUSDT');
            const firstCallCount = mockLogger.info.mock.calls.length;
            
            // Enable again with same symbol
            manager.enableDepthView('BTCUSDT');
            
            // Should not log again (no-op)
            expect(mockLogger.info.mock.calls.length).toBe(firstCallCount);
        });
    });

    describe('Reconnection Debouncing', () => {
        it('should debounce multiple rapid subscription changes', async () => {
            // Add multiple streams rapidly
            manager.addKlineStream('mini-BTCUSDT-1h', 'BTCUSDT', '1h');
            manager.addKlineStream('mini-ETHUSDT-4h', 'ETHUSDT', '4h');
            manager.addKlineStream('mini-BNBUSDT-1d', 'BNBUSDT', '1d');
            
            // Should NOT have connected yet (debounce period)
            expect(mockConnectFn).not.toHaveBeenCalled();
            
            // Advance past debounce period (2 seconds)
            await vi.advanceTimersByTimeAsync(2100);
            
            // Now it should connect with all streams at once
            expect(mockConnectFn).toHaveBeenCalledTimes(1);
            // The stream parameter is an array of streams
            const callArg = mockConnectFn.mock.calls[0][0];
            expect(callArg.stream).toContain('btcusdt@kline_1h');
            expect(callArg.stream).toContain('ethusdt@kline_4h');
            expect(callArg.stream).toContain('bnbusdt@kline_1d');
        });

        it('should not reconnect if streams have not changed', async () => {
            manager.addKlineStream('mini-BTCUSDT-1h', 'BTCUSDT', '1h');
            
            // Wait for initial connection
            await vi.advanceTimersByTimeAsync(2100);
            expect(mockConnectFn).toHaveBeenCalledTimes(1);
            
            // Simulate connected streams
            manager.connectedStreams = ['btcusdt@kline_1h'];
            manager.marketWsConnection = { on: vi.fn() };
            
            // Try to trigger reconnect with same streams
            manager.scheduleReconnect();
            await vi.advanceTimersByTimeAsync(2100);
            
            // Should NOT reconnect (streams unchanged)
            expect(mockConnectFn).toHaveBeenCalledTimes(1);
        });
    });

    describe('Connection Status', () => {
        it('should return correct status', () => {
            manager.addKlineStream('mini-BTCUSDT-1h', 'BTCUSDT', '1h');
            manager.enableDepthView('BTCUSDT');
            
            const status = manager.getStatus();
            
            expect(status.streams).toContain('btcusdt@kline_1h');
            expect(status.streams).toContain('btcusdt@trade');
            expect(status.depthViewEnabled).toBe(true);
            expect(status.depthViewSymbol).toBe('BTCUSDT');
        });
    });

    describe('Cleanup', () => {
        it('should clear all state on cleanup', async () => {
            manager.addKlineStream('mini-BTCUSDT-1h', 'BTCUSDT', '1h');
            manager.enableDepthView('BTCUSDT');
            manager.marketWsConnection = { disconnect: vi.fn() };
            
            const mockDisconnect = vi.fn();
            await manager.cleanup(mockDisconnect);
            
            expect(manager.getAllStreams()).toHaveLength(0);
            expect(manager.isDepthViewEnabled()).toBe(false);
            expect(manager.marketWsConnection).toBeNull();
        });

        // A connect is an await. Cleanup that lands inside it used to be undone
        // by the socket arriving afterwards and being adopted as the current
        // one — a live connection to a market the operator had already left.
        it('discards a connect that resolves after cleanup instead of reviving it', async () => {
            let resolveConnect;
            const lateSocket = { on: vi.fn(), close: vi.fn(), disconnect: vi.fn() };
            mockConnectFn.mockImplementationOnce(() => new Promise((resolve) => {
                resolveConnect = resolve;
            }));

            manager.addKlineStream('mini-BTCUSDT-1h', 'BTCUSDT', '1h');
            const connecting = manager.reconnectMarketSocket();
            await Promise.resolve();

            await manager.cleanup(vi.fn());
            resolveConnect(lateSocket);
            await connecting;

            expect(manager.marketWsConnection).toBeNull();
            expect(lateSocket.on).not.toHaveBeenCalled();
            expect(lateSocket.disconnect).toHaveBeenCalledOnce();

            // And no reconnect timer survives it either.
            await vi.advanceTimersByTimeAsync(10_000);
            expect(manager.marketWsConnection).toBeNull();
        });

        it('should cancel pending reconnect timer on cleanup', async () => {
            manager.addKlineStream('mini-BTCUSDT-1h', 'BTCUSDT', '1h');
            // Timer is scheduled but not yet fired
            
            await manager.cleanup(vi.fn());
            
            // Advance time - should not trigger reconnect
            await vi.advanceTimersByTimeAsync(3000);
            expect(mockConnectFn).not.toHaveBeenCalled();
        });
    });
});

describe('ChannelManager', () => {
    let manager;
    let mockLogger;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        
        manager = new ChannelManager(mockLogger);
    });

    describe('Channel Creation', () => {
        it('should create a channel with correct properties', () => {
            const channel = manager.createChannel('mini-BTCUSDT-1h', CHANNEL_TYPES.MINI, 'BTCUSDT', '1h');
            
            expect(channel.id).toBe('mini-BTCUSDT-1h');
            expect(channel.type).toBe(CHANNEL_TYPES.MINI);
            expect(channel.symbol).toBe('BTCUSDT');
            expect(channel.interval).toBe('1h');
        });

        it('should track channels', () => {
            manager.createChannel('mini-BTCUSDT-1h', CHANNEL_TYPES.MINI, 'BTCUSDT', '1h');
            manager.createChannel('mini-ETHUSDT-4h', CHANNEL_TYPES.MINI, 'ETHUSDT', '4h');
            
            expect(manager.hasChannel('mini-BTCUSDT-1h')).toBe(true);
            expect(manager.hasChannel('mini-ETHUSDT-4h')).toBe(true);
            expect(manager.hasChannel('nonexistent')).toBe(false);
        });

        it('should replace existing channel with same ID', () => {
            const channel1 = manager.createChannel('mini-BTCUSDT-1h', CHANNEL_TYPES.MINI, 'BTCUSDT', '1h');
            const channel2 = manager.createChannel('mini-BTCUSDT-1h', CHANNEL_TYPES.MINI, 'BTCUSDT', '1h');
            
            // Implementation removes old and creates new (not reusing)
            expect(channel2.id).toBe(channel1.id);
            expect(channel2.symbol).toBe(channel1.symbol);
            // Only one channel with this ID should exist
            expect(manager.getChannelIds().filter(id => id === 'mini-BTCUSDT-1h')).toHaveLength(1);
        });
    });

    describe('Detail Channel Tracking', () => {
        it('should track detail channel', () => {
            manager.createChannel('detail-BTCUSDT-1h', CHANNEL_TYPES.DETAIL, 'BTCUSDT', '1h');
            
            const detailChannel = manager.getDetailChannel();
            expect(detailChannel).not.toBeNull();
            expect(detailChannel.symbol).toBe('BTCUSDT');
        });

        it('should allow multiple detail channels (frontend manages active one)', () => {
            manager.createChannel('detail-BTCUSDT-1h', CHANNEL_TYPES.DETAIL, 'BTCUSDT', '1h');
            manager.createChannel('detail-ETHUSDT-4h', CHANNEL_TYPES.DETAIL, 'ETHUSDT', '4h');
            
            // Multiple detail channels can exist (e.g., during transitions)
            const detailChannels = manager.getChannelsByType(CHANNEL_TYPES.DETAIL);
            expect(detailChannels.length).toBe(2);
            
            // getDetailChannel returns first one found
            const detailChannel = manager.getDetailChannel();
            expect(detailChannel).not.toBeNull();
        });
    });

    describe('Channel Removal', () => {
        it('should remove channel', async () => {
            manager.createChannel('mini-BTCUSDT-1h', CHANNEL_TYPES.MINI, 'BTCUSDT', '1h');
            
            await manager.removeChannel('mini-BTCUSDT-1h', null);
            
            expect(manager.hasChannel('mini-BTCUSDT-1h')).toBe(false);
        });

        it('should clear detail channel reference when removed', async () => {
            manager.createChannel('detail-BTCUSDT-1h', CHANNEL_TYPES.DETAIL, 'BTCUSDT', '1h');
            
            await manager.removeChannel('detail-BTCUSDT-1h', null);
            
            expect(manager.getDetailChannel()).toBeNull();
        });
    });

    describe('MarketStreamManager Integration', () => {
        it('should expose MarketStreamManager instance', () => {
            const streamManager = manager.getMarketStreamManager();
            expect(streamManager).toBeInstanceOf(MarketStreamManager);
        });

        it('should share MarketStreamManager across channel operations', () => {
            const streamManager1 = manager.getMarketStreamManager();
            const streamManager2 = manager.getMarketStreamManager();
            
            expect(streamManager1).toBe(streamManager2);
        });
    });
});

describe('Connection Hub Behavior', () => {
    let manager;
    let mockLogger;

    beforeEach(() => {
        vi.useFakeTimers();
        mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        manager = new ChannelManager(mockLogger);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should preserve kline streams when switching views', () => {
        const streamManager = manager.getMarketStreamManager();
        
        // Simulate MainView: add kline streams
        streamManager.addKlineStream('mini-BTCUSDT-1h', 'BTCUSDT', '1h');
        streamManager.addKlineStream('mini-ETHUSDT-4h', 'ETHUSDT', '4h');
        
        // Verify streams are tracked
        expect(streamManager.getAllStreams()).toContain('btcusdt@kline_1h');
        expect(streamManager.getAllStreams()).toContain('ethusdt@kline_4h');
        
        // Simulate switching to DepthView: enable depth
        streamManager.enableDepthView('BTCUSDT');
        
        // Kline streams should still be there
        expect(streamManager.getAllStreams()).toContain('btcusdt@kline_1h');
        expect(streamManager.getAllStreams()).toContain('ethusdt@kline_4h');
        // Plus depth streams
        expect(streamManager.getAllStreams()).toContain('btcusdt@trade');
        
        // Simulate switching back to MainView: disable depth
        streamManager.disableDepthView();
        
        // Kline streams should STILL be there (preserved!)
        expect(streamManager.getAllStreams()).toContain('btcusdt@kline_1h');
        expect(streamManager.getAllStreams()).toContain('ethusdt@kline_4h');
        // Depth streams should be gone
        expect(streamManager.getAllStreams()).not.toContain('btcusdt@trade');
    });

    it('should batch multiple subscription requests efficiently', async () => {
        const streamManager = manager.getMarketStreamManager();
        const mockConnect = vi.fn().mockResolvedValue({ on: vi.fn() });
        streamManager.setConnectFunction(mockConnect);
        
        // Rapid-fire subscriptions (like during startup)
        streamManager.addKlineStream('mini-1', 'BTCUSDT', '1h');
        streamManager.addKlineStream('mini-2', 'ETHUSDT', '4h');
        streamManager.addKlineStream('mini-3', 'BNBUSDT', '1d');
        streamManager.addKlineStream('mini-4', 'SOLUSDT', '1h');
        streamManager.addKlineStream('mini-5', 'ADAUSDT', '4h');
        streamManager.addKlineStream('mini-6', 'XRPUSDT', '1d');
        streamManager.addKlineStream('mini-7', 'DOGEUSDT', '1h');
        streamManager.addKlineStream('mini-8', 'AVAXUSDT', '4h');
        
        // No connection yet (debouncing)
        expect(mockConnect).not.toHaveBeenCalled();
        
        // Wait for debounce
        await vi.advanceTimersByTimeAsync(2100);
        
        // Should make exactly ONE connection with all 8 streams
        expect(mockConnect).toHaveBeenCalledTimes(1);
        
        const callArg = mockConnect.mock.calls[0][0];
        expect(callArg.stream).toContain('btcusdt@kline_1h');
        expect(callArg.stream).toContain('ethusdt@kline_4h');
        expect(callArg.stream).toContain('avaxusdt@kline_4h');
    });
});
