import { describe, expect, it } from 'vitest';
import {
    createFuturesProductionExecutionVerificationRuntime as createNormalRuntime,
} from './futures-production-execution-runtime-composition.js?normal-source';
import {
    createFuturesProductionExecutionVerificationRuntime as createVerificationRuntime,
} from './futures-production-execution-runtime-verification-composition.js';

describe('Futures production execution runtime build composition', () => {
    it('keeps normal source fail-closed and verification source in-memory only', async () => {
        expect(createNormalRuntime()).toBeNull();

        const runtime = createVerificationRuntime();
        expect(runtime).toMatchObject({
            mode: 'e2e-in-memory-only',
            coordinator: null,
        });
        expect(runtime.service).toMatchObject({
            handleRequest: expect.any(Function),
            disconnect: expect.any(Function),
            shutdown: expect.any(Function),
        });
        await runtime.service.shutdown();
    });
});
