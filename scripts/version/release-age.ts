import { readFileSync } from 'node:fs'
import path from 'node:path'
import semver from 'semver'
import { z } from 'zod'

// The minimum-release-age quarantine (kit#768), applied natively instead of inherited from
// safe-chain's interception. safe-chain filters the registry only when the process tree was
// started through one of its six wrapped shell commands, so `josh latest` and
// `pnpm josh latest` used to resolve different "newest release" answers. These functions
// make the resolution deterministic: the policy comes from the repo-managed `.npmrc`, the
// publish timestamps from the registry, and the selection is a pure computation over both.

const MINIMUM_RELEASE_AGE_RE = /^minimum-release-age\s*=\s*(\d+)\s*$/mu
const NO_QUARANTINE_MINUTES = 0
const NPMRC_PATH = '.npmrc'

// A version → ISO publish date map, the shape both the registry and the GitHub Packages API are
// reduced to before the aged-version selection runs.
const release_times_schema = z.record(z.string(), z.string())
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
// An undefined major matches every line; a defined one pins the search to that major.
function is_on_major(version: string, major: string | undefined): boolean {
	return major === undefined || String(semver.major(version)) === major
}

function is_eligible(
	version: string,
	published_at: string,
	major: string | undefined,
	cutoff_ms: number,
): boolean {
	if (semver.valid(version) === null || semver.prerelease(version) !== null) return false
	if (!is_on_major(version, major)) return false
	const published_ms = Date.parse(published_at)

	return Number.isFinite(published_ms) && published_ms <= cutoff_ms
}

// The newest release on the major that has aged past the quarantine window, or undefined
// when none qualifies. Pure: identical inputs give the identical answer regardless of how
// the surrounding process was launched.
// `major` pins the search to one major line — what `josh latest` needs, since corepack validates the
// resolved pnpm version against `devEngines`. Pass `undefined` to search every major, which is what
// an "is this installable at all" question wants: `pnpm add pkg@latest` resolves to the newest
// permitted release regardless of major (joshuafolkken/kit#808).
function select_aged_version(
	times: Record<string, string>,
	major: string | undefined,
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

// The window declared in one `.npmrc`, or nothing when the file is absent, unreadable, or does not
// declare the setting. Distinguishing "not declared" from "declared as 0" is what lets an explicit
// `minimum-release-age=0` opt-out stop the walk instead of falling through to an ancestor's policy.
function read_declared_minimum_release_age(npmrc_path: string): number | undefined {
	try {
		const raw = MINIMUM_RELEASE_AGE_RE.exec(readFileSync(npmrc_path, 'utf8'))?.[1]

		return raw === undefined ? undefined : Number(raw)
	} catch {
		return undefined
	}
}

// The quarantine window declared by one specific `.npmrc`, defaulting to the project's own. An
// absent, unreadable, or undeclared setting means no quarantine — the policy is advisory, and a
// project without one is not held back.
//
// Deliberately not the upward walk below: `josh latest` resolves this against the working directory
// it also writes `corepack use` into, and honouring a user-level policy there could freeze pnpm
// bumps in a project that declares none (joshuafolkken/kit#808).
function read_minimum_release_age(npmrc_path: string = NPMRC_PATH): number {
	return read_declared_minimum_release_age(npmrc_path) ?? NO_QUARANTINE_MINUTES
}

// The window declared by the nearest `.npmrc` at or above `start`, or nothing.
//
// Two reasons this walks rather than reading one path. `josh version` and `josh latest` both run
// from anywhere inside a project — and from outside one — so resolving against the working directory
// alone would silently read "no quarantine" in every subdirectory. And pnpm merges config per key
// across project, workspace and user levels, so a project `.npmrc` that only sets a registry must
// not mask a `~/.npmrc` carrying the policy (joshuafolkken/kit#808).
//
// `boundary` stops the walk at a known root. Production passes none — a user-level `~/.npmrc` is a
// legitimate source — while tests bound the search so it cannot depend on the machine's real home.
//
// Simplification: the walk visits every ancestor, whereas pnpm consults only the project, the
// workspace root, `~/.npmrc` and its global config. A stray `.npmrc` in an intermediate directory
// would therefore be honoured here and not by pnpm. The consequence is one informational `Held:`
// line — the value never suppresses a command — so the faithful four-level model is not worth its
// complexity here.
function find_declared_minimum_release_age(
	start: string,
	boundary: string | undefined,
): number | undefined {
	const declared = read_declared_minimum_release_age(path.join(start, NPMRC_PATH))
	if (declared !== undefined) return declared
	if (start === boundary) return undefined
	const parent = path.dirname(start)

	return parent === start ? undefined : find_declared_minimum_release_age(parent, boundary)
}

// The quarantine window resolved by walking up from a starting directory. An absent or undeclared
// policy means no quarantine — it is advisory, and a project without one is not held back.
function read_nearest_minimum_release_age(start: string, boundary?: string): number {
	return find_declared_minimum_release_age(path.resolve(start), boundary) ?? NO_QUARANTINE_MINUTES
}

const release_age = {
	release_times_schema,
	parse_minimum_release_age,
	read_minimum_release_age,
	read_nearest_minimum_release_age,
	select_aged_version,
}

export { release_age }
