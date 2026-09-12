// Single definition of the dev and preview port numbers for every kit consumer.
//
// Both ports move together from a personal, non-committed `PORT_SEED` (see `.env`) and, inside a
// lane, its seat `JOSH_LANE_SEAT`, so a machine running several kit projects — and several lanes of
// one — can give each its own pair instead of every project landing on vite's default 5173 and the
// wrangler preview's 4173. The offset is `seed × 10 + lane`: seat 0 is the main work tree, so a
// project that never opens a lane sits on `seed × 10`, and an unset — or blank, the shape
// `.env.example` ships — seed is 0, today's numbers exactly, which is what keeps CI and every
// un-migrated consumer working untouched. Multiplying the seed is what makes distinct seeds occupy
// disjoint bands (seed 1 is 10..19, seed 2 is 20..29) with no convention for anyone to break.
//
// This module is plain committed JavaScript rather than a `dist/`-built library like `./version`
// because `playwright.config.ts` imports it, and that config is loaded by kit's own type check,
// unit suite and E2E run. A build artifact would make all three fail on a fresh clone until
// `pnpm build` had run.
import { existsSync } from 'node:fs'
import path from 'node:path'

const PORT_SEED_KEY = 'PORT_SEED'
// The lane's seat, written into a lane's own `.env` by `lane:open` and 0 (the main work tree)
// everywhere else. It is a separate key from `PORT_SEED` on purpose: the lane's `.env` keeps its
// project's seed unchanged and adds this, so the file says plainly which number is the project's
// and which is the seat, and the multiplication that combines them lives only here.
const LANE_SEAT_KEY = 'JOSH_LANE_SEAT'
const ENV_FILE_NAME = '.env'
const PACKAGE_FILE_NAME = 'package.json'
// What `.env` is allowed to contribute to this process, and through it to the `webServer` child:
// the settings kit's own Playwright config reads. `CI` is deliberately absent even though the same
// config reads it — it describes the run, not the project, and a value pinned in a file would make
// every local run claim to be CI. Everything else in `.env` belongs to the consumer's application,
// which loads the file in its own start script when it wants it (#826).
const PROJECT_ENVIRONMENT_KEYS = new Set([PORT_SEED_KEY, LANE_SEAT_KEY, 'PLAYWRIGHT_REUSE_SERVER'])
const DEV_PORT_BASE = 5173
const PREVIEW_PORT_BASE = 4173
const MIN_SEED = 0
// `offset = seed × 10 + lane`. Keeping every seed's whole band below 1000 is what makes one
// project's preview port (4173 + offset) unable to land on another's dev port (5173 + offset):
// that would need the two offsets to differ by exactly 1000, which no offset under 1000 can. From
// `seed × 10 + 9 < 1000` the seed ceiling is 99, and the seat runs 0..9.
const SEED_LANE_MULTIPLIER = 10
const MAX_LANE = 9
const MAX_SEED = 99

const INTEGER_PATTERN = /^\d+$/u

/**
 * @param {string} key
 * @param {string} raw
 * @param {number} max
 * @returns {never}
 */
function fail_invalid(key, raw, max) {
	throw new Error(
		`${key} must be an integer between ${MIN_SEED} and ${max}, got ${JSON.stringify(raw)}. ` +
			`Unset it to use the default ports (dev ${DEV_PORT_BASE}, preview ${PREVIEW_PORT_BASE}).`,
	)
}

/**
 * An unset variable and a blank one are one case, not two: `.env.example` ships the key with no
 * value, so both spell "I have not set this". Reading them through one funnel is also what keeps
 * `resolve_bounded` inside the complexity limit.
 *
 * @param {Record<string, string | undefined>} environment
 * @param {string} key
 * @returns {string}
 */
function read_trimmed(environment, key) {
	const raw = environment[key]

	return raw === undefined ? '' : raw.trim()
}

/**
 * Resolve one bounded, non-negative integer from the environment.
 *
 * An unset variable is the documented default and yields 0, and a blank one means the same thing:
 * `.env.example` ships the key with no value, so blank is the shape of "I have not set this" and
 * of turning it back off, never of a typo. Every genuinely malformed shape — a non-integer, a
 * negative, an out-of-range number — throws instead of falling back to 0: a silent fallback would
 * put two projects back on one port, which is the failure this module exists to remove.
 *
 * @param {Record<string, string | undefined>} environment
 * @param {string} key
 * @param {number} max
 * @returns {number}
 */
function resolve_bounded(environment, key, max) {
	const trimmed = read_trimmed(environment, key)
	if (trimmed.length === 0) return MIN_SEED
	if (!INTEGER_PATTERN.test(trimmed)) fail_invalid(key, trimmed, max)

	const value = Number(trimmed)
	if (value > max) fail_invalid(key, trimmed, max)

	return value
}

/**
 * The project's port seed, 0..99.
 *
 * @param {Record<string, string | undefined>} [environment]
 * @returns {number}
 */
function resolve_seed(environment = process.env) {
	return resolve_bounded(environment, PORT_SEED_KEY, MAX_SEED)
}

/**
 * The lane's seat, 0..9 — 0 (the main work tree) when unset.
 *
 * @param {Record<string, string | undefined>} [environment]
 * @returns {number}
 */
function resolve_lane(environment = process.env) {
	return resolve_bounded(environment, LANE_SEAT_KEY, MAX_LANE)
}

/**
 * The offset applied to both base ports: `seed × 10 + lane`.
 *
 * @param {Record<string, string | undefined>} [environment]
 * @returns {number}
 */
function resolve_offset(environment = process.env) {
	return resolve_seed(environment) * SEED_LANE_MULTIPLIER + resolve_lane(environment)
}

/**
 * @param {number} base
 * @param {Record<string, string | undefined>} [environment]
 * @returns {number}
 */
function offset_from(base, environment) {
	return base + resolve_offset(environment)
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
 * Locate the project root that governs `directory` — the nearest ancestor holding a `package.json`.
 *
 * #826: the loader read `.env` from the working directory and nowhere else, while Playwright
 * defaults `webServer.cwd` to the config file's directory and `pnpm run` executes a script from the
 * package root. Running `pnpm exec playwright test` from a subdirectory therefore left this side on
 * seed 0 while its own `webServer` came up seeded — the disagreement #820 fixed, arriving through
 * the other half of the pair. Resolving the package root first is what makes every reader name one
 * file from any working directory, because the package root is exactly the directory `pnpm run`
 * hands the script that reads it.
 *
 * The root's `.env` is the only candidate: a `.env` beside the caller is deliberately not preferred
 * over it, because preferring one would let an `e2e/.env` holding unrelated fixture data shadow the
 * seed and re-create the very timeout above. A directory with no `package.json` at or above it —
 * which no installed consumer has — keeps itself rather than climbing to the filesystem root, so a
 * stray `~/.env` is never adopted.
 *
 * @param {string} directory
 * @returns {string}
 */
function resolve_project_directory(directory) {
	// Absolute first: `path.dirname('.')` is `'.'`, so a relative directory would end the ascent on
	// its first step and land back in the mismatch this resolves.
	const start = path.resolve(directory)
	let current = start

	while (!existsSync(path.join(current, PACKAGE_FILE_NAME))) {
		const parent = path.dirname(current)
		if (parent === current) return start

		current = parent
	}

	return current
}

/**
 * Put every key the file introduced back the way it was, the project keys excepted.
 *
 * `loadEnvFile` never overwrites a variable already present, so the file's contribution is exactly
 * the set of keys absent from the snapshot.
 *
 * @param {Record<string, string | undefined>} snapshot
 * @returns {void}
 */
function discard_loaded_keys(snapshot) {
	for (const key of Object.keys(process.env)) {
		// `Reflect.deleteProperty` rather than `delete`: the key is computed, and `process.env` is the
		// one object where removing an entry is the documented way to unset a variable.
		if (!PROJECT_ENVIRONMENT_KEYS.has(key) && !Object.hasOwn(snapshot, key)) {
			Reflect.deleteProperty(process.env, key)
		}
	}
}

/**
 * Apply the project settings kit's own Playwright config reads from `.env`, and nothing else.
 *
 * Every reader comes through here. `playwright.config.ts` is loaded by Playwright itself — from
 * `pnpm exec playwright test`, the VS Code extension and `josh test:e2e` alike — with nothing on
 * the way in that reads `.env`, and `josh port` calls this rather than the
 * `--env-file-if-exists=.env` tsx flag it used to carry, because that flag resolved the file
 * against the working directory while this resolves it at the project root (#826). Two readers on
 * two rules is how `josh port preview` printed 4176 while Playwright waited on 4173, costing a
 * consumer its whole E2E suite to a webServer timeout (#820).
 *
 * The file is parsed by `loadEnvFile`, so `.env` is read exactly as the flag reads it, and then
 * every key outside `PROJECT_ENVIRONMENT_KEYS` is taken back out. #826: the `webServer` child
 * inherits this process's environment wholesale, so keeping the rest handed a consumer's `.env`
 * secrets to the dev or preview server for the sake of two settings. A `CLOUDFLARE_API_TOKEN`
 * sitting there is not inert: `wrangler` prefers it over the OAuth session it would otherwise use,
 * so a token short of the needed scopes turned a working preview into a 403. A server that wants
 * `.env` still loads it in its own start script, which is where that decision was made before this
 * loader existed.
 *
 * A missing file is the documented default and does nothing, and a variable already present in the
 * environment wins over the file, so an explicit `PORT_SEED=2 pnpm josh test:e2e` still overrides
 * `.env`.
 *
 * @param {string} [directory]
 * @returns {boolean} whether a file was found and loaded
 */
function load_environment_file(directory = process.cwd()) {
	const file = path.join(resolve_project_directory(directory), ENV_FILE_NAME)
	if (!existsSync(file)) return false

	const snapshot = { ...process.env }

	process.loadEnvFile(file)
	discard_loaded_keys(snapshot)

	return true
}

const ports = {
	load_environment_file,
	resolve_seed,
	resolve_lane,
	resolve_development_port,
	resolve_preview_port,
}

export { ENV_FILE_NAME, LANE_SEAT_KEY, PORT_SEED_KEY, PROJECT_ENVIRONMENT_KEYS, ports }
