export const FUTURES_PRODUCTION_ACTIVATION_GATES = Object.freeze([
    'operatorConfigured',
    'liveAuthorized',
    'accountIdentityValid',
    'limitsComplete',
    'storageHealthy',
    'recoveryHealthy',
    'killSwitchPolicyActive',
    'credentialBindingValid',
    'noBlockingOperation',
    'noActiveRatePause',
]);

export const FUTURES_PRODUCTION_ACTIVATION_CODES = Object.freeze({
    ENABLED: 'FUTURES_PRODUCTION_ENABLED',
    OPERATOR_CONFIGURATION: 'FUTURES_PRODUCTION_OPERATOR_CONFIGURATION_REQUIRED',
    LIVE_AUTHORIZATION: 'FUTURES_PRODUCTION_LIVE_AUTHORIZATION_REQUIRED',
    ACCOUNT_IDENTITY: 'FUTURES_PRODUCTION_ACCOUNT_IDENTITY_REJECTED',
    LIMITS: 'FUTURES_PRODUCTION_LIMITS_REJECTED',
    STORAGE: 'FUTURES_PRODUCTION_STORAGE_REJECTED',
    RECOVERY: 'FUTURES_PRODUCTION_RECOVERY_REJECTED',
    KILL_SWITCH_POLICY: 'FUTURES_PRODUCTION_KILL_SWITCH_POLICY_REJECTED',
    CREDENTIAL_BINDING: 'FUTURES_PRODUCTION_CREDENTIAL_ROTATION_BLOCKED',
    BLOCKING_OPERATION: 'FUTURES_PRODUCTION_OPERATION_BLOCKED',
    RATE_PAUSED: 'FUTURES_PRODUCTION_RATE_PAUSED',
});

const CODE_BY_GATE = Object.freeze({
    operatorConfigured: FUTURES_PRODUCTION_ACTIVATION_CODES.OPERATOR_CONFIGURATION,
    liveAuthorized: FUTURES_PRODUCTION_ACTIVATION_CODES.LIVE_AUTHORIZATION,
    accountIdentityValid: FUTURES_PRODUCTION_ACTIVATION_CODES.ACCOUNT_IDENTITY,
    limitsComplete: FUTURES_PRODUCTION_ACTIVATION_CODES.LIMITS,
    storageHealthy: FUTURES_PRODUCTION_ACTIVATION_CODES.STORAGE,
    recoveryHealthy: FUTURES_PRODUCTION_ACTIVATION_CODES.RECOVERY,
    killSwitchPolicyActive: FUTURES_PRODUCTION_ACTIVATION_CODES.KILL_SWITCH_POLICY,
    credentialBindingValid: FUTURES_PRODUCTION_ACTIVATION_CODES.CREDENTIAL_BINDING,
    noBlockingOperation: FUTURES_PRODUCTION_ACTIVATION_CODES.BLOCKING_OPERATION,
    noActiveRatePause: FUTURES_PRODUCTION_ACTIVATION_CODES.RATE_PAUSED,
});

const isExactGateObject = (value) => (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).length === FUTURES_PRODUCTION_ACTIVATION_GATES.length
    && FUTURES_PRODUCTION_ACTIVATION_GATES.every((gate) => (
        Object.hasOwn(value, gate) && typeof value[gate] === 'boolean'
    ))
);

export const evaluateFuturesProductionActivationGates = (gates) => {
    if (!isExactGateObject(gates)) {
        return Object.freeze({
            enabled: false,
            code: FUTURES_PRODUCTION_ACTIVATION_CODES.OPERATOR_CONFIGURATION,
            failedGate: 'invalidGateState',
        });
    }
    const failedGate = FUTURES_PRODUCTION_ACTIVATION_GATES.find(gate => !gates[gate]);
    if (failedGate) {
        return Object.freeze({
            enabled: false,
            code: CODE_BY_GATE[failedGate],
            failedGate,
        });
    }
    return Object.freeze({
        enabled: true,
        code: FUTURES_PRODUCTION_ACTIVATION_CODES.ENABLED,
        failedGate: null,
    });
};
