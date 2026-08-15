// Walks the **production source graph** — every module reachable from the real
// entry points — and fails when it can generate exchange data instead of
// reading it. This is the source-side half of the production-only guarantee;
// `check-electron-build-artifacts.mjs` is the other half and inspects the built
// artifacts. Both are required: source can be clean while a build pulls in a
// verification composition, and a build can be clean while source drifts.
//
// The check used to match six literal symbol names over relative imports only.
// A mock under a new name passed, and a subtree reached through a bare or
// aliased specifier was never walked at all — the script still printed success
// over a graph it had silently stopped exploring. Everything below exists to
// close those two holes.

import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const PRODUCTION_ENTRY_POINTS = Object.freeze([
  'electron/main.js',
  'electron/preload.cjs',
  'src/main.jsx',
])

// A tripwire, not a target. The graph may grow freely; it may not silently
// shrink, because a resolution gap removes modules from the walk without
// removing them from the product. Recorded at 105 executable modules on
// 2026-08-09, with room for ordinary consolidation. Lower it only when the
// graph genuinely shrank and you have said why.
export const PRODUCTION_MODULE_FLOOR = 100

const SOURCE_EXTENSIONS = Object.freeze(['', '.js', '.jsx', '.mjs', '.cjs'])

// Only executable modules are walked and scanned. A stylesheet cannot generate
// exchange data, and scanning one produces false findings on class names such
// as `.cancel-order-stub`.
const SCRIPT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs'])
const isScriptModule = filePath => SCRIPT_EXTENSIONS.has(path.extname(filePath))

// Specifier prefixes that resolve to first-party code. Anything added to a
// bundler's resolve.alias for a production build belongs here too, or the
// subtree behind it stops being checked.
export const FIRST_PARTY_ALIASES = Object.freeze([
  Object.freeze({ prefix: '@/', target: 'src/' }),
])

const IMPORT_PATTERN = /(?:import\s+(?:[^'"()]+?\s+from\s+)?|export\s+[^'"()]+?\s+from\s+|(?:import|require)\s*\()(['"])([^'"]+)\1/g

// Named shapes kept from the original check. They no longer carry the guarantee
// on their own — the generic rules below do — but a known regression should
// still fail by its own name rather than as an anonymous match.
export const NAMED_FORBIDDEN_PATTERNS = Object.freeze([
  Object.freeze(['runtime mock mode flag', /\bUSE_MOCK\b/]),
  Object.freeze(['runtime synthetic order builder', /build(?:Spot|Futures)MockOrderPlacementExecutionReport/]),
  Object.freeze(['runtime synthetic market generator', /\b(?:generateTrade|generateTicker|generateDepth|buildMockChartPayload)\b/]),
  Object.freeze(['runtime synthetic Futures account state', /\bfuturesMockState\b/]),
  Object.freeze(['renderer synthetic initial data', /\b(?:initialChartData|mockFilters)\b/]),
  Object.freeze(['production fake transport import', /futures-(?:production-)?workstation-fake-transport/]),
])

// Shape-based, so renaming does not help: anything *declared* or *called* as a
// mock, fake, stub, synthetic, simulated or dummy thing fails wherever it sits
// in the production graph.
export const GENERIC_FORBIDDEN_PATTERNS = Object.freeze([
  Object.freeze([
    'synthetic data identifier',
    /\b(?:mock|fake|stub|synthetic|simulated|dummy)[A-Za-z0-9_]*\s*(?:=[^=]|\(|:)/i,
  ]),
])

// `Math.random()` is how synthetic market data is manufactured, so its presence
// in the production graph is a finding by default. These files are the
// exceptions, each because it mints an identifier rather than a market value.
// Adding a file here is a deliberate act that shows up in review.
export const RANDOMNESS_ALLOWLIST = Object.freeze(new Map([
  ['src/utils/tradingCommands.js', 'client order id entropy'],
  ['src/utils/cache.js', 'local alert identifiers'],
  ['src/context/DrawingProvider.jsx', 'local drawing identifiers'],
  ['electron/services/channel-manager.js', 'websocket channel identifiers'],
]))

const RANDOMNESS_PATTERN = /Math\s*\.\s*random\s*\(/

const isFile = async (filePath) => {
  try {
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
}

// Full-line comments only. Trailing comments are left in place so a URL such as
// `https://fapi.binance.com` is never truncated into something that changes
// what the patterns see.
const stripComments = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter(line => !/^\s*\/\//.test(line))
  .join('\n')

const applyAliases = (specifier) => {
  for (const { prefix, target } of FIRST_PARTY_ALIASES) {
    if (specifier.startsWith(prefix)) return `${target}${specifier.slice(prefix.length)}`
  }
  return null
}

const withinRoot = (root, candidate) => {
  const relative = path.relative(root, candidate)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

const resolveExisting = async (base) => {
  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = `${base}${extension}`
    if (await isFile(candidate)) return candidate
  }
  for (const extension of SOURCE_EXTENSIONS.slice(1)) {
    const candidate = path.join(base, `index${extension}`)
    if (await isFile(candidate)) return candidate
  }
  return null
}

/**
 * Resolves a specifier to a first-party file, or null when it is third-party.
 *
 * Relative specifiers resolve against the importing file. Aliased and bare
 * specifiers resolve against the repository root, which is what makes a
 * first-party module reached without a leading `./` part of the walk instead of
 * an invisible hole in it. Anything landing outside the root, or inside
 * `node_modules`, is third-party and is not walked.
 */
export const resolveFirstPartyImport = async ({ root, fromFile, specifier }) => {
  if (specifier.startsWith('node:') || specifier.startsWith('data:')) return null
  const aliased = applyAliases(specifier)
  const base = specifier.startsWith('.')
    ? path.resolve(path.dirname(fromFile), specifier)
    : path.resolve(root, aliased ?? specifier)
  if (!withinRoot(root, base) || base.includes(`${path.sep}node_modules${path.sep}`)) return null
  const resolved = await resolveExisting(base)
  return resolved !== null && isScriptModule(resolved) ? resolved : null
}

/**
 * Walks the production graph and reports every violation found in it.
 *
 * Returns the visited module count alongside the violations so the caller can
 * apply the floor: a graph that stops being walked reports zero violations,
 * which is indistinguishable from a clean graph unless the size is checked too.
 */
export const analyzeProductionSourceGraph = async ({
  root,
  entryPoints = PRODUCTION_ENTRY_POINTS,
  namedPatterns = NAMED_FORBIDDEN_PATTERNS,
  genericPatterns = GENERIC_FORBIDDEN_PATTERNS,
  randomnessAllowlist = RANDOMNESS_ALLOWLIST,
} = {}) => {
  const pending = entryPoints.map(entry => path.resolve(root, entry))
  const visited = new Set()
  const violations = []

  while (pending.length > 0) {
    const filePath = pending.pop()
    if (visited.has(filePath)) continue
    visited.add(filePath)
    const source = await readFile(filePath, 'utf8')
    const relativePath = path.relative(root, filePath)
    const code = stripComments(source)

    for (const [label, pattern] of [...namedPatterns, ...genericPatterns]) {
      if (pattern.test(code)) violations.push(`${relativePath}: ${label}`)
    }
    if (RANDOMNESS_PATTERN.test(code) && !randomnessAllowlist.has(relativePath)) {
      violations.push(`${relativePath}: unexplained Math.random() in the production graph`)
    }

    for (const match of code.matchAll(IMPORT_PATTERN)) {
      const dependency = await resolveFirstPartyImport({
        root,
        fromFile: filePath,
        specifier: match[2],
      })
      if (dependency !== null) pending.push(dependency)
    }
  }

  return { moduleCount: visited.size, modules: visited, violations }
}

export const runProductionSourceGraphCheck = async ({
  root = process.cwd(),
  moduleFloor = PRODUCTION_MODULE_FLOOR,
  ...options
} = {}) => {
  const { moduleCount, violations } = await analyzeProductionSourceGraph({ root, ...options })
  const failures = [...violations]
  if (moduleCount < moduleFloor) {
    failures.push(
      `production source graph shrank to ${moduleCount} modules, below the recorded floor of ${moduleFloor}`
      + ' — a specifier the walk cannot resolve hides everything behind it',
    )
  }
  return { moduleCount, failures }
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const { moduleCount, failures } = await runProductionSourceGraphCheck()
  if (failures.length > 0) {
    throw new Error(`Production source graph MOCK contract failed:\n${failures.join('\n')}`)
  }
  console.log(
    `Production source graph is MOCK-free (${moduleCount} modules walked, floor ${PRODUCTION_MODULE_FLOOR}).`,
  )
}
