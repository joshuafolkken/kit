// Single definition of the dev and preview port numbers for every kit consumer.
//
// Both ports move together from one personal, non-committed `PORT_SEED` (see `.env`), so a machine
// running several kit projects at once can give each one its own pair instead of every project
// landing on vite's default 5173 and the wrangler preview's 4173. Unset — or left blank, the shape
// `.env.example` ships — means seed 0, today's numbers exactly, which is what keeps CI and every
// un-migrated consumer working untouched.
//
// This module is plain committed JavaScript rather than a `dist/`-built library like `./version`
// because `playwright.config.ts` imports it, and that config is loaded by kit's own type check,
// unit suite and E2E run. A build artifact would make all three fail on a fresh clone until
// `pnpm build` had run.
import { existsSync } from 'node:fs'
import path from 'node:path'

const PORT_SEED_KEY = 'PORT_SEED'
const ENV_FILE_NAME = '.env'
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
 * An unset variable and a blank one are one case, not two: `.env.example` ships the key with no
 * value, so both spell "I have not set this". Reading them through one funnel is also what keeps
 * `resolve_seed` inside the complexity limit.
 *
 * @param {Record<string, string | undefined>} environment
 * @returns {string}
 */
function read_trimmed_seed(environment) {
	const raw = environment[PORT_SEED_KEY]

	return raw === undefined ? '' : raw.trim()
}

/**
 * Resolve the offset applied to both base ports.
 *
 * An unset variable is the documented default and yields 0, and a blank one means the same thing:
 * `.env.example` ships the key with no value, so blank is the shape of "I have not set this" and
 * of turning a seed back off, never of a typo. Every genuinely malformed shape — a non-integer, a
 * negative, an out-of-range number — throws instead of falling back to 0: a silent fallback would
 * put two projects back on one port, which is the failure this module exists to remove.
 *
 * @param {Record<string, string | undefined>} [environment]
 * @returns {number}
 */
function resolve_seed(environment = process.env) {
	const trimmed = read_trimmed_seed(environment)
	if (trimmed.length === 0) return MIN_SEED
	if (!INTEGER_PATTERN.test(trimmed)) fail_invalid_seed(trimmed)

	const seed = Number(trimmed)
	if (seed > MAX_SEED) fail_invalid_seed(trimmed)

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

/**
 * Load the project's `.env` into `process.env` so `PORT_SEED` reaches a reader that `josh` did not
 * launch.
 *
 * `josh port` gets the file through tsx's `--env-file-if-exists=.env`, but `playwright.config.ts`
 * is loaded by Playwright itself — from `pnpm exec playwright test`, the VS Code extension and
 * `josh test:e2e` alike — and no such flag is on that path. Without this the two read the same
 * `.env` and disagree: `josh port preview` printed 4176 while Playwright waited on 4173, so a
 * consumer wiring `--port $(pnpm josh port preview)` exactly as documented lost its whole E2E
 * suite to a webServer timeout (#820).
 *
 * The semantics match the flag it stands in for, deliberately and in full: the whole file is
 * loaded rather than the one variable this module cares about, because a loader that read `.env`
 * selectively would leave `josh` commands and Playwright disagreeing about every other variable in
 * it. A missing file is the documented default and does nothing, and a variable already present in
 * the environment wins over the file, so an explicit `PORT_SEED=2 pnpm josh test:e2e` still
 * overrides `.env`. The directory defaults to the working directory because that is what the
 * flag's relative `.env` resolves against — anchoring on this file instead would make the two
 * disagree whenever Playwright runs from a subdirectory.
 *
 * @param {string} [directory]
 * @returns {boolean} whether a file was found and loaded
 */
function load_environment_file(directory = process.cwd()) {
	const file = path.join(directory, ENV_FILE_NAME)
	if (!existsSync(file)) return false

	process.loadEnvFile(file)

	return true
}

const ports = {
	load_environment_file,
	resolve_seed,
	resolve_development_port,
	resolve_preview_port,
}

export { ENV_FILE_NAME, PORT_SEED_KEY, ports }
