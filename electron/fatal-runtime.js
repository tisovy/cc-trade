import { writeSync } from 'node:fs';

const installations = new WeakMap();
const writeFatal = ({ code }) => writeSync(2,
    `[fatal-runtime] ${code}: runtime integrity unconfirmed; exiting with status 1. `
    + 'Exchange orders may remain active. Verify the exchange before repeating commands.\n');

// A failure handled by its request owner never reaches these events. Once it
// does, a network-looking code/message cannot prove that owner recovered.
export function installFatalRuntimeHandlers({
    processHost = process,
    exit = null,
    writeDiagnostic = writeFatal,
    recordFault = () => {},
} = {}) {
    const existing = installations.get(processHost);
    if (existing) return existing;
    let faulted = false;

    const terminate = code => {
        if (faulted) return;
        faulted = true;
        processHost.exitCode = 1;
        const reading = Object.freeze({ phase: 'main-runtime', code });
        // Never inspect the thrown value: even reading a property or converting
        // it to text can throw, disclose a request, or execute a hostile getter.
        try { writeDiagnostic(reading); } catch { /* best effort before exit */ }
        try { recordFault(reading); } catch { /* the disk may already be faulty */ }
        try {
            exit?.(1);
        } finally {
            // Electron app.exit is immediate and bypasses cancellable quit
            // handlers. If it throws or unexpectedly returns, still do not resume.
            processHost.exit(1);
        }
    };
    const onUncaught = (_error, origin) => terminate(
        origin === 'unhandledRejection' ? 'UNHANDLED_REJECTION' : 'UNCAUGHT_EXCEPTION',
    );
    const onUnhandled = () => terminate('UNHANDLED_REJECTION');
    const dispose = () => {
        if (installations.get(processHost) !== dispose) return;
        processHost.removeListener('uncaughtException', onUncaught);
        processHost.removeListener('unhandledRejection', onUnhandled);
        installations.delete(processHost);
    };
    installations.set(processHost, dispose);
    processHost.prependListener('uncaughtException', onUncaught);
    processHost.prependListener('unhandledRejection', onUnhandled);
    return dispose;
}
