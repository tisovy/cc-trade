import { describe, expect, it } from 'vitest';
import {
    FUTURES_PRODUCTION_OPERATOR_STARTUP_ACTIONS,
    captureFuturesProductionOperatorStartupAction,
} from './futures-production-operator-startup.js';

describe('Futures production backend-only operator startup action', () => {
    it('defaults to no action and preserves unrelated arguments', () => {
        const argv = ['electron', 'main.js', '--safe-flag'];
        const captured = captureFuturesProductionOperatorStartupAction({ argv });

        expect(captured).toEqual({
            requested: false,
            valid: true,
            action: null,
            code: 'FUTURES_PRODUCTION_OPERATOR_ACTION_NOT_REQUESTED',
        });
        expect(Object.isFrozen(captured)).toBe(true);
        expect(argv).toEqual(['electron', 'main.js', '--safe-flag']);
    });

    it.each(FUTURES_PRODUCTION_OPERATOR_STARTUP_ACTIONS)(
        'captures and removes the exact %s action before renderer startup',
        (action) => {
            const argv = [
                'electron',
                `--futures-production-operator-action=${action}`,
                'main.js',
            ];
            const captured = captureFuturesProductionOperatorStartupAction({ argv });

            expect(captured).toEqual({
                requested: true,
                valid: true,
                action,
                code: 'FUTURES_PRODUCTION_OPERATOR_ACTION_CAPTURED',
            });
            expect(argv).toEqual(['electron', 'main.js']);
        },
    );

    it.each([
        ['unknown action', ['--futures-production-operator-action=eraseAudit']],
        ['empty action', ['--futures-production-operator-action=']],
        ['alternate spelling', ['--futures-production-operator-reconcile']],
        ['duplicate action', [
            '--futures-production-operator-action=reconcile',
            '--futures-production-operator-action=disengageKillSwitch',
        ]],
    ])('rejects and scrubs %s', (_label, operatorArguments) => {
        const argv = ['electron', ...operatorArguments, 'main.js'];
        const captured = captureFuturesProductionOperatorStartupAction({ argv });

        expect(captured).toEqual({
            requested: true,
            valid: false,
            action: null,
            code: 'FUTURES_PRODUCTION_OPERATOR_ARGUMENT_REJECTED',
        });
        expect(argv).toEqual(['electron', 'main.js']);
    });

    it('fails closed for a non-array process argument source', () => {
        expect(captureFuturesProductionOperatorStartupAction({ argv: null })).toEqual({
            requested: true,
            valid: false,
            action: null,
            code: 'FUTURES_PRODUCTION_OPERATOR_ARGUMENT_REJECTED',
        });
    });
});
