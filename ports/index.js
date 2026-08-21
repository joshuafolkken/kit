// Single definition of the dev and preview port numbers for every kit consumer.
//
// Both ports move together from one personal, non-committed `PORT_SEED` (see `.env`), so a machine
// running several kit projects at once can give each one its own pair instead of every project
// landing on vite's default 5173 and the wrangler preview's 4173. Unset means seed 0 — today's
// numbers exactly — which is what keeps CI and every un-migrated consumer working untouched.
//
// This module is plain committed JavaScript rather than a `dist/`-built library like `./version`
// because `playwright.config.ts` imports it, and that config is loaded by kit's own type check,
// unit suite and E2E run. A build artifact would make all three fail on a fresh clone until
// `pnpm build` had run.
const PORT_SEED_KEY = 'PORT_SEED'
const DEV_PORT_BASE = 5173
const PREVIEW_PORT_BASE = 4173
const MIN_SEED = 0
const MAX_PORT = 65_535
// The dev base is the higher of the two, so bounding it bounds both ports.
const MAX_SEED = MAX_PORT - DEV_PORT_BASE

const INTEGER_PATTERN = /^\d+$/u

/**
 * @param {string} raw
 * @returns {never}
 */
function fail_invalid_seed(raw) {
	throw new Error(
		`${PORT_SEED_KEY} must be an integer between ${MIN_SEED} and ${MAX_SEED}, got ${JSON.stringify(raw)}. ` +
			`Unset it to use the default ports (dev ${DEV_PORT_BASE}, preview ${PREVIEW_PORT_BASE}).`,
	)
}

/**
 * Resolve the offset applied to both base ports.
 *
 * An unset variable is the documented default and yields 0. Every other rejected shape — a
 * non-integer, a negative, an out-of-range number, and an empty value — throws instead of falling
 * back to 0: a silent fallback would put two projects back on one port, which is the failure this
 * module exists to remove.
 *
 * @param {Record<string, string | undefined>} [environment]
 * @returns {number}
 */
function resolve_seed(environment = process.env) {
	const raw = environment[PORT_SEED_KEY]
	if (raw === undefined) return MIN_SEED

	const trimmed = raw.trim()
	if (!INTEGER_PATTERN.test(trimmed)) fail_invalid_seed(raw)

	const seed = Number(trimmed)
	if (seed > MAX_SEED) fail_invalid_seed(raw)

	return seed
}

/**
 * @param {number} base
 * @param {Record<string, string | undefined>} [environment]
 * @returns {number}
 */
function offset_from(base, environment) {
	return base + resolve_seed(environment)
}

/**
 * @param {Record<string, string | undefined>} [environment]
 * @returns {number}
 */
function resolve_development_port(environment = process.env) {
	return offset_from(DEV_PORT_BASE, environment)
}

/**
 * @param {Record<string, string | undefined>} [environment]
 * @returns {number}
 */
function resolve_preview_port(environment = process.env) {
	return offset_from(PREVIEW_PORT_BASE, environment)
}

const ports = {
	resolve_seed,
	resolve_development_port,
	resolve_preview_port,
}

export { PORT_SEED_KEY, ports }
