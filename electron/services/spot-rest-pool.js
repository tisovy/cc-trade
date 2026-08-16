// The spot REST leg's connections, and the count that proves they are reused.
//
// Every spot request used to open its own TLS connection and throw it away.
// Measured through the operator's own proxy on 2026-08-16, that is 630 ms for a
// request that opens a connection against 325 ms for one that does not — a
// handshake paid on every read, every account refresh and every order.
//
// The futures leg stopped paying it in `pay-the-handshake-once`. Spot did not,
// for a reason that is written down in the code it was left in: `keepAlive:
// false, // Disable keepAlive to avoid axios agent issues`. What that comment
// protected against is no longer reachable — the Binance SDK builds its own
// keep-alive agent only when it has not been given one
// (`@binance/common`: `if (configuration?.keepAlive && !configuration?.baseOptions?.httpsAgent)`),
// and this desk gives it one. So the flag decides nothing while an agent is set,
// and the agent decides everything.

import https from 'node:https';

// Sized for spot's traffic rather than copied from the futures pool, and chosen
// for headroom rather than measured — because spot's traffic has never been
// measured at all. Until this change the record carried no spot timing of any
// kind, so there is no observed concurrency to size against, and inventing a
// tight bound from nothing is how a pool becomes the thing that queues.
//
// `maxSockets` is the ceiling on requests in flight at once; spot's widest
// moment is an account refresh, which is three reads, plus whatever the operator
// is doing. Thirty-two is far above that and costs nothing while unused.
// `maxFreeSockets` is how many stay warm between bursts: four, the same as the
// futures pool, because that is what a refresh's width plus a command needs to
// find a connection already open.
export const SPOT_REST_CONNECTION_POOL = Object.freeze({
    keepAlive: true,
    maxSockets: 32,
    maxFreeSockets: 4,
});

// A connection actually opened. The absence of these lines is the evidence the
// pool is working — a request served from the pool writes nothing, because the
// working case is the common one and recording it would fill the record with its
// own success. Their return in numbers is the alarm.
export const SPOT_REST_CONNECT_PHASE = 'spot-rest-connect';

export const createPooledSpotRestAgent = () => new https.Agent(SPOT_REST_CONNECTION_POOL);

// Marks an agent this has already been wrapped around, so a second call cannot
// stack a second counter on the same agent and report every open twice.
const OBSERVED = Symbol('spot-rest-connections-observed');

/**
 * Counts the connections an agent actually opens.
 *
 * `createConnection` is the one method `http.Agent` calls when it has no free
 * socket to hand out, and every agent this desk uses implements it — Node's own
 * `https.Agent` directly, and both proxy agents through `agent-base`. So a call
 * to it is exactly "a connection was opened", which is the reading the operator
 * needs and the one `agent.sockets` cannot give without sampling.
 *
 * Wrapped rather than subclassed because the agent is built by whichever proxy
 * library the operator's environment selects, and this has to hold for all
 * three. Total by construction: a recorder that raises must not be able to take
 * down a request, so the count is taken inside its own guard and the original
 * method is called either way.
 */
export const observeSpotRestConnections = (agent, recordEvent) => {
    if (!agent || typeof agent.createConnection !== 'function') return agent;
    if (typeof recordEvent !== 'function') return agent;
    if (agent[OBSERVED] === true) return agent;
    const original = agent.createConnection.bind(agent);
    agent.createConnection = (...args) => {
        try {
            recordEvent('timing', {
                phase: SPOT_REST_CONNECT_PHASE,
                // A connection's own cost is not known here — the socket has not
                // finished opening — and this line is a count rather than a
                // duration. Zero is the honest reading: what is being recorded
                // is that an open happened, not how long it took.
                durationMs: 0,
                outcome: 'ok',
                cache: 'miss',
            });
        } catch {
            // A diagnostic may never cost a request.
        }
        return original(...args);
    };
    agent[OBSERVED] = true;
    return agent;
};
