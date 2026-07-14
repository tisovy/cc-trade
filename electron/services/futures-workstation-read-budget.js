export class FuturesWorkstationReadBudgetError extends Error {
    constructor(code) {
        super('Futures workstation public-read budget rejected an operation');
        this.name = 'FuturesWorkstationReadBudgetError';
        this.code = code;
    }
}

export class FuturesWorkstationReadBudget {
    constructor({
        maximumWeight = 120,
        windowMs = 60_000,
        maximumConcurrent = 2,
        maximumQueue = 16,
        now = () => Date.now(),
    } = {}) {
        if (![maximumWeight, windowMs, maximumConcurrent, maximumQueue]
            .every(value => Number.isSafeInteger(value) && value > 0)
            || typeof now !== 'function') {
            throw new FuturesWorkstationReadBudgetError('INVALID_READ_BUDGET');
        }
        this.maximumWeight = maximumWeight;
        this.windowMs = windowMs;
        this.maximumConcurrent = maximumConcurrent;
        this.maximumQueue = maximumQueue;
        this.now = now;
        this.history = [];
        this.active = 0;
        this.queue = [];
    }

    prune(now) {
        this.history = this.history.filter(entry => now - entry.at < this.windowMs);
    }

    usedWeight(now = this.now()) {
        this.prune(now);
        return this.history.reduce((total, entry) => total + entry.weight, 0);
    }

    execute(weight, operation, { signal } = {}) {
        if (!Number.isSafeInteger(weight) || weight < 1 || weight > this.maximumWeight
            || typeof operation !== 'function') {
            return Promise.reject(new FuturesWorkstationReadBudgetError('INVALID_READ_OPERATION'));
        }
        if (signal?.aborted) {
            return Promise.reject(new FuturesWorkstationReadBudgetError('READ_OPERATION_ABORTED'));
        }
        if (this.queue.length >= this.maximumQueue) {
            return Promise.reject(new FuturesWorkstationReadBudgetError('READ_QUEUE_OVERFLOW'));
        }
        return new Promise((resolve, reject) => {
            const entry = { weight, operation, signal, resolve, reject, abort: null };
            entry.abort = () => {
                const index = this.queue.indexOf(entry);
                if (index >= 0) this.queue.splice(index, 1);
                reject(new FuturesWorkstationReadBudgetError('READ_OPERATION_ABORTED'));
            };
            signal?.addEventListener?.('abort', entry.abort, { once: true });
            this.queue.push(entry);
            this.drain();
        });
    }

    drain() {
        while (this.active < this.maximumConcurrent && this.queue.length > 0) {
            const entry = this.queue.shift();
            entry.signal?.removeEventListener?.('abort', entry.abort);
            if (entry.signal?.aborted) {
                entry.reject(new FuturesWorkstationReadBudgetError('READ_OPERATION_ABORTED'));
                continue;
            }
            const now = this.now();
            const used = this.usedWeight(now);
            if (used + entry.weight > this.maximumWeight) {
                entry.reject(new FuturesWorkstationReadBudgetError('READ_WEIGHT_EXHAUSTED'));
                continue;
            }
            this.history.push(Object.freeze({ at: now, weight: entry.weight }));
            this.active += 1;
            Promise.resolve()
                .then(entry.operation)
                .then(entry.resolve, entry.reject)
                .finally(() => {
                    this.active -= 1;
                    this.drain();
                });
        }
    }

    snapshot() {
        return Object.freeze({
            maximumWeight: this.maximumWeight,
            usedWeight: this.usedWeight(),
            active: this.active,
            queued: this.queue.length,
        });
    }
}
