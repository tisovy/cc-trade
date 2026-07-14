import { describe, expect, it } from 'vitest';
import {
    FUTURES_PRODUCTION_ACTIVATION_CODES,
    FUTURES_PRODUCTION_ACTIVATION_GATES,
    evaluateFuturesProductionActivationGates,
} from './futures-production-execution-activation.js';

const complete = Object.fromEntries(
    FUTURES_PRODUCTION_ACTIVATION_GATES.map(gate => [gate, true]),
);

describe('Futures production activation gates', () => {
    it('admits exactly the single all-true combination', () => {
        let admitted = 0;
        const combinations = 2 ** FUTURES_PRODUCTION_ACTIVATION_GATES.length;
        for (let mask = 0; mask < combinations; mask += 1) {
            const gates = Object.fromEntries(FUTURES_PRODUCTION_ACTIVATION_GATES.map(
                (gate, index) => [gate, Boolean(mask & (1 << index))],
            ));
            const result = evaluateFuturesProductionActivationGates(gates);
            if (result.enabled) admitted += 1;
            expect(result.enabled).toBe(mask === combinations - 1);
        }
        expect(admitted).toBe(1);
    });

    it.each(FUTURES_PRODUCTION_ACTIVATION_GATES)(
        'reports the deterministic first failed gate for %s',
        (failedGate) => {
            const gates = { ...complete, [failedGate]: false };
            const result = evaluateFuturesProductionActivationGates(gates);
            expect(result).toEqual(expect.objectContaining({
                enabled: false,
                failedGate,
            }));
        },
    );

    it('rejects malformed and extra gate state without reading truthy aliases', () => {
        expect(evaluateFuturesProductionActivationGates({ ...complete, extra: true }))
            .toEqual({
                enabled: false,
                code: FUTURES_PRODUCTION_ACTIVATION_CODES.OPERATOR_CONFIGURATION,
                failedGate: 'invalidGateState',
            });
        expect(evaluateFuturesProductionActivationGates({
            ...complete,
            liveAuthorized: 'true',
        }).enabled).toBe(false);
    });
});
