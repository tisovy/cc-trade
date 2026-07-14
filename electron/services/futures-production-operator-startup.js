const OPERATOR_ARGUMENT_PREFIX = '--futures-production-operator-action=';
const OPERATOR_ARGUMENT_NAMESPACE = '--futures-production-operator-';

export const FUTURES_PRODUCTION_OPERATOR_STARTUP_ACTIONS = Object.freeze([
    'reconcile',
    'engageKillSwitch',
    'disengageKillSwitch',
]);

const ACTION_SET = new Set(FUTURES_PRODUCTION_OPERATOR_STARTUP_ACTIONS);

const result = ({ requested, valid, action, code }) => Object.freeze({
    requested,
    valid,
    action,
    code,
});

export const captureFuturesProductionOperatorStartupAction = ({
    argv = process.argv,
} = {}) => {
    if (!Array.isArray(argv)) {
        return result({
            requested: true,
            valid: false,
            action: null,
            code: 'FUTURES_PRODUCTION_OPERATOR_ARGUMENT_REJECTED',
        });
    }

    const captured = [];
    for (let index = argv.length - 1; index >= 0; index -= 1) {
        const value = argv[index];
        if (typeof value !== 'string' || !value.startsWith(OPERATOR_ARGUMENT_NAMESPACE)) {
            continue;
        }
        captured.unshift(value);
        argv.splice(index, 1);
    }

    if (captured.length === 0) {
        return result({
            requested: false,
            valid: true,
            action: null,
            code: 'FUTURES_PRODUCTION_OPERATOR_ACTION_NOT_REQUESTED',
        });
    }

    const action = captured.length === 1
        && captured[0].startsWith(OPERATOR_ARGUMENT_PREFIX)
        ? captured[0].slice(OPERATOR_ARGUMENT_PREFIX.length)
        : null;
    if (action === null || !ACTION_SET.has(action)) {
        return result({
            requested: true,
            valid: false,
            action: null,
            code: 'FUTURES_PRODUCTION_OPERATOR_ARGUMENT_REJECTED',
        });
    }

    return result({
        requested: true,
        valid: true,
        action,
        code: 'FUTURES_PRODUCTION_OPERATOR_ACTION_CAPTURED',
    });
};
