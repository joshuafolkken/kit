// Single definition of the env-flag vocabulary for every kit consumer.
//
// "Is this env var switched on?" looks too small to share, but the vocabulary is the interface: a
// consumer config that re-declares it drifts immediately (#828 — a `vite.config.ts` clone accepted
// only '1'/'true', so `ANALYZE=yes` silently did nothing in the same repository where
// `PLAYWRIGHT_REUSE_SERVER=yes` worked). One exported predicate is what makes every config file
// answer "what is a truthy flag?" the same way.
//
// This module is plain committed JavaScript rather than a `dist/`-built library like `./version`
// for the same reason as `./ports`: `playwright.config.ts` imports it, and that config is loaded
// by kit's own type check, unit suite and E2E run. A build artifact would make all three fail on a
// fresh clone until `pnpm build` had run.
const TRUTHY_FLAG_VALUES = new Set(['1', 'true', 'yes', 'on'])
const FALSY_FLAG_VALUES = new Set(['0', 'false', 'no', 'off'])

/**
 * @param {string} value
 * @returns {string}
 */
function normalize_flag_value(value) {
	return value.trim().toLowerCase()
}

/**
 * Whether an opt-in env flag is switched on.
 *
 * Env vars are always strings, so `Boolean(value)` would enable the flag for '0' and 'false' too —
 * the two spellings someone reaches for to turn it off. Only affirmative spellings enable; every
 * other value, including empty and unset, reads as off.
 *
 * @param {string | undefined} value
 * @returns {boolean}
 */
function is_flag_enabled(value) {
	return value !== undefined && TRUTHY_FLAG_VALUES.has(normalize_flag_value(value))
}

/**
 * Whether the `CI` variable says this run is CI.
 *
 * `CI` is not an opt-in flag with a fixed vocabulary — Woodpecker exports `CI=woodpecker` — so the
 * affirmative allow-list above would drop such runs into dev mode. Invert the test instead: any
 * value counts as CI except an empty one and the explicit negatives. (`ci-info` opts out on the
 * exact string 'false' alone; the negative set here also covers '0', 'no' and 'off'.)
 *
 * @param {string | undefined} value
 * @returns {boolean}
 */
function is_ci_enabled(value) {
	if (value === undefined) return false
	const normalized = normalize_flag_value(value)

	return normalized.length > 0 && !FALSY_FLAG_VALUES.has(normalized)
}

const environment_flags = {
	normalize_flag_value,
	is_flag_enabled,
	is_ci_enabled,
}

export { environment_flags }
