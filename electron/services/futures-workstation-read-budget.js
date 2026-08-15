export class FuturesWorkstationReadBudgetError extends Error {
    constructor(code) {
        super('Futures workstation public-read budget rejected an operation');
        this.name = 'FuturesWorkstationReadBudgetError';
        this.code = code;
    }
}

const systemSetTimer = (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    timer?.unref?.();
    return timer;
};

export class FuturesWorkstationReadBudget {
    constructor({
        maximumWeight = 120,
        windowMs = 60_000,
        maximumConcurrent = 2,
        maximumQueue = 16,
        // A read with no room waits for the window to free it. One window is the
        // bound: past that, the room is not coming from anything this desk spent.
        maximumWaitMs = null,
        now = () => Date.now(),
        setTimer = systemSetTimer,
        clearTimer = timer => clearTimeout(timer),
    } = {}) {
        const waitMs = maximumWaitMs === null ? windowMs : maximumWaitMs;
        if (![maximumWeight, windowMs, maximumConcurrent, maximumQueue]
            .every(value => Number.isSafeInteger(value) && value > 0)
            || !Number.isSafeInteger(waitMs) || waitMs < 0
            || typeof now !== 'function'
            || typeof setTimer !== 'function'
            || typeof clearTimer !== 'function') {
            throw new FuturesWorkstationReadBudgetError('INVALID_READ_BUDGET');
        }
        this.maximumWeight = maximumWeight;
        this.windowMs = windowMs;
        this.maximumConcurrent = maximumConcurrent;
        this.maximumQueue = maximumQueue;
        this.maximumWaitMs = waitMs;
        this.now = now;
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        this.history = [];
        this.active = 0;
        this.queue = [];
        this.drainTimer = null;
    }

    prune(now) {
        this.history = this.history.filter(entry => now - entry.at < this.windowMs);
    }

    usedWeight(now = this.now()) {
        this.prune(now);
        return this.history.reduce((total, entry) => total + entry.weight, 0);
    }

    // How long until the window holds room for `weight`. Entries are recorded in
    // the order they were spent, so freeing them oldest-first is the order they
    // age out in. `null` means no amount of waiting frees enough, which the
    // weight bound in `execute` already rules out.
    timeUntilRoom(weight, now) {
        let shortfall = this.usedWeight(now) + weight - this.maximumWeight;
        if (shortfall <= 0) return 0;
        for (const entry of this.history) {
            shortfall -= entry.weight;
            if (shortfall <= 0) return Math.max(0, entry.at + this.windowMs - now);
        }
        return null;
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
                this.dequeue(entry);
                reject(new FuturesWorkstationReadBudgetError('READ_OPERATION_ABORTED'));
                // Whatever is at the head now may need a shorter wait than the
                // one already armed for the read just abandoned.
                this.drain();
            };
            signal?.addEventListener?.('abort', entry.abort, { once: true });
            this.queue.push(entry);
            this.drain();
        });
    }

    dequeue(entry) {
        const index = this.queue.indexOf(entry);
        if (index >= 0) this.queue.splice(index, 1);
        entry.signal?.removeEventListener?.('abort', entry.abort);
    }

    drain() {
        if (this.drainTimer !== null) {
            this.clearTimer(this.drainTimer);
            this.drainTimer = null;
        }
        while (this.active < this.maximumConcurrent && this.queue.length > 0) {
            // Read at the head rather than taking it: a read that has to wait
            // stays queued, so the signal that abandons it still reaches it.
            const entry = this.queue[0];
            if (entry.signal?.aborted) {
                this.dequeue(entry);
                entry.reject(new FuturesWorkstationReadBudgetError('READ_OPERATION_ABORTED'));
                continue;
            }
            const now = this.now();
            const waitMs = this.timeUntilRoom(entry.weight, now);
            if (waitMs === null || waitMs > this.maximumWaitMs) {
                this.dequeue(entry);
                entry.reject(new FuturesWorkstationReadBudgetError('READ_WEIGHT_EXHAUSTED'));
                continue;
            }
            if (waitMs > 0) {
                // The window frees at a moment that is known. A read the desk can
                // make then is delayed until then rather than refused — refusing
                // it costs a resync, and the resync costs the same reads again.
                this.drainTimer = this.setTimer(() => {
                    this.drainTimer = null;
                    this.drain();
                }, waitMs);
                return;
            }
            this.dequeue(entry);
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
            waiting: this.drainTimer !== null,
        });
    }
}
