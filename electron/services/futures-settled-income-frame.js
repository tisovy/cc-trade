// Keeps the IPC row shape cheap when only observation clocks change.
//
// Canonical resource lanes already own frozen canonical row objects. Publishing
// them does not need to normalize and clone those objects again; only their
// deterministic order is missing. One activation/content-keyed snapshot makes
// that sort a content cost instead of an hourly observation cost.

const compareCanonicalRows = (left, right) => (
    left.time - right.time
    || left.incomeType.localeCompare(right.incomeType)
    || left.identity.localeCompare(right.identity)
);

const contentRevision = ({
    activationGeneration,
    accountFingerprint,
    resource,
}) => {
    if (!Number.isSafeInteger(activationGeneration)
        || !Number.isSafeInteger(resource?.generation)
        || resource.generation < 0
        || typeof resource?.digest !== 'string'
        || resource.digest.length === 0) return null;
    return JSON.stringify([
        activationGeneration,
        accountFingerprint ?? null,
        resource.version,
        resource.generation,
        resource.digest,
    ]);
};

const sortedLaneRows = lane => Object.freeze(
    [...lane.rows.values()].sort(compareCanonicalRows),
);

export const createFuturesSettledIncomeRowSnapshotCache = () => {
    let heldRevision = null;
    let heldRowsByType = null;

    return ({ activationGeneration, accountFingerprint, resource }) => {
        const revision = contentRevision({
            activationGeneration,
            accountFingerprint,
            resource,
        });
        if (revision !== null && revision === heldRevision && heldRowsByType !== null) {
            return heldRowsByType;
        }
        const rowsByType = Object.freeze(Object.fromEntries(
            Object.entries(resource.lanes).map(([incomeType, lane]) => [
                incomeType,
                sortedLaneRows(lane),
            ]),
        ));
        if (revision !== null) {
            heldRevision = revision;
            heldRowsByType = rowsByType;
        }
        return rowsByType;
    };
};

export default createFuturesSettledIncomeRowSnapshotCache;
