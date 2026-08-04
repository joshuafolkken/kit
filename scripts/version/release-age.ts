import semver from 'semver'

// The minimum-release-age quarantine (kit#768), applied natively instead of inherited from
// safe-chain's interception. safe-chain filters the registry only when the process tree was
// started through one of its six wrapped shell commands, so `josh latest` and
// `pnpm josh latest` used to resolve different "newest release" answers. These functions
// make the resolution deterministic: the policy comes from the repo-managed `.npmrc`, the
// publish timestamps from the registry, and the selection is a pure computation over both.

const MINIMUM_RELEASE_AGE_RE = /^minimum-release-age\s*=\s*(\d+)\s*$/mu
const NO_QUARANTINE_MINUTES = 0
const MS_PER_MINUTE = 60_000

// The quarantine window in minutes from `.npmrc`; a missing or malformed entry means no
// quarantine, matching pnpm's own default for the setting.
function parse_minimum_release_age(npmrc_content: string): number {
	const raw = MINIMUM_RELEASE_AGE_RE.exec(npmrc_content)?.[1]

	return raw === undefined ? NO_QUARANTINE_MINUTES : Number(raw)
}

// Stable releases only, on the requested major, published at or before the cutoff. The
// registry's `time` object also carries `created` / `modified` keys and prereleases; both
// fall out via the semver checks.
function is_eligible(
	version: string,
	published_at: string,
	major: string,
	cutoff_ms: number,
): boolean {
	if (semver.valid(version) === null || semver.prerelease(version) !== null) return false
	if (String(semver.major(version)) !== major) return false
	const published_ms = Date.parse(published_at)

	return Number.isFinite(published_ms) && published_ms <= cutoff_ms
}

// The newest release on the major that has aged past the quarantine window, or undefined
// when none qualifies. Pure: identical inputs give the identical answer regardless of how
// the surrounding process was launched.
function select_aged_version(
	times: Record<string, string>,
	major: string,
	minimum_age_minutes: number,
	now_ms: number,
): string | undefined {
	const cutoff_ms = now_ms - minimum_age_minutes * MS_PER_MINUTE
	// cspell:ignore rcompare -- semver's reverse-compare API, newest first
	const eligible = Object.entries(times)
		.filter(([version, published_at]) => is_eligible(version, published_at, major, cutoff_ms))
		.map(([version]) => version)
		.toSorted(semver.rcompare)

	return eligible[0]
}

const release_age = { parse_minimum_release_age, select_aged_version }

export { release_age }
