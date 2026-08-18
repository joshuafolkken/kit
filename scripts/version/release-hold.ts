import semver from 'semver'
import { release_age } from './release-age'

// A release-age hold: the local minimum-release-age policy withholds the newest release from
// *unpinned* resolution, so anything resolved without an explicit version stops one or more releases
// short of `latest`. Reporting that as a bare `⚠ → <latest>` is indistinguishable from an install the
// user forgot to upgrade — and it recurs after every successful upgrade, because the newest release
// is by definition the youngest (joshuafolkken/kit#808).
//
// **The window binds unpinned resolution only.** Measured on pnpm 11.22.0 with
// `minimum-release-age=1440` and a release published 3.5 h earlier:
//
//   pnpm add pkg@1.80.0   ->  1.80.0   (pnpm records a `minimumReleaseAgeExclude` entry)
//   pnpm add pkg          ->  1.78.0   (the newest release past the window)
//
// So a pinned `Run:` hint always works and is never suppressed. What the window actually holds back
// is peer resolution — the mechanism behind an upstream's effective install (joshuafolkken/kit#698),
// which is why this explanation is attached there and nowhere else.

const MINUTES_PER_HOUR = 60
const MS_PER_MINUTE = 60_000
const HOLD_LABEL = 'Held:'

// Whether `latest` is itself inside the window — the precondition for a hold existing at all. Without
// this check the note fires whenever `select_aged_version` returns something other than `latest` for
// *any* reason: a prerelease `latest` (filtered as ineligible though published weeks ago) would be
// declared "inside the 24 h window" forever, and a `latest` that has aged out would produce the
// degenerate "an unpinned resolve lands on <latest>".
function is_latest_withheld(
	times: Record<string, string>,
	latest: string,
	minimum_age_minutes: number,
	now_ms: number,
): boolean {
	const published_at = times[latest]
	if (published_at === undefined) return false
	const published_ms = Date.parse(published_at)
	if (!Number.isFinite(published_ms)) return false

	return published_ms > now_ms - minimum_age_minutes * MS_PER_MINUTE
}

// The newest release the quarantine window permits, or nothing when there is no hold to explain:
// unavailable timestamps, a `latest` that has already aged out, or nothing aged out yet.
//
// Not scoped to `latest`'s major: a freshly published major is exactly when the previous line is the
// only thing an unpinned resolve can reach.
function resolve_installable(
	times: Record<string, string> | undefined,
	latest: string,
	minimum_age_minutes: number,
	now_ms: number,
): string | undefined {
	if (times === undefined) return undefined
	if (!is_latest_withheld(times, latest, minimum_age_minutes, now_ms)) return undefined
	const installable = release_age.select_aged_version(times, undefined, minimum_age_minutes, now_ms)

	return installable === latest ? undefined : installable
}

// Whether a target is behind `latest` only because the quarantine withheld it. The install must be
// behind `latest` (otherwise there is nothing to explain) and at least at the newest installable
// release (otherwise it is genuinely stale and the existing upgrade hint is the right answer).
//
// `gte`, not equality: an install can sit *ahead* of the newest installable release and still be
// behind `latest` — a version installed before the policy tightened, or one published between the
// page kit reads and `latest`. Treating those as stale would print a command the same policy
// refuses.
function is_at_or_above(version: string, installable: string): boolean {
	// Unparseable versions cannot be ordered, so the comparison falls back to equality rather than
	// guessing at a prerelease or a non-semver tag.
	if (semver.valid(version) === null || semver.valid(installable) === null) {
		return version === installable
	}

	return semver.gte(version, installable)
}

function is_release_age_hold(
	version: string | undefined,
	latest: string,
	installable: string | undefined,
): boolean {
	if (version === undefined || installable === undefined) return false
	if (version === latest) return false

	return is_at_or_above(version, installable)
}

// Render the window in whole hours when it divides evenly, otherwise in minutes. The policy is
// written in minutes but read by humans in hours (1440 → 24 h), and printing "1440 minutes" buries
// the one number the reader needs to judge how long the hold lasts.
function format_window(minimum_age_minutes: number): string {
	if (minimum_age_minutes % MINUTES_PER_HOUR !== 0) return `${String(minimum_age_minutes)} min`

	return `${String(minimum_age_minutes / MINUTES_PER_HOUR)} h`
}

// The explanation that accompanies a staleness marker no unpinned resolve can clear. Names the
// window so the reader can see the gap is a policy delay rather than a failed upgrade.
//
// The "lands on" clause is dropped when the install is already ahead of `installable`: naming a
// lower version beside a `⚠ → <latest>` marker reads as a downgrade instruction, when the point is
// simply that `latest` is not yet reachable.
function format_release_hold_note(
	version: string,
	latest: string,
	installable: string,
	minimum_age_minutes: number,
): string {
	const window = format_window(minimum_age_minutes)
	const head = `${HOLD_LABEL} ${latest} is inside the ${window} minimum-release-age window`
	if (version !== installable) return `${head}; an unpinned resolve cannot reach it yet`

	return `${head}; an unpinned resolve lands on ${installable}`
}

// The note lines for one target, or nothing when the target is not on hold. Returned as an array so
// callers can splice it into a line list without a conditional at every call site.
function build_release_hold_notes(
	version: string | undefined,
	latest: string,
	installable: string | undefined,
	minimum_age_minutes: number,
): Array<string> {
	if (version === undefined || installable === undefined) return []
	if (!is_release_age_hold(version, latest, installable)) return []

	return [format_release_hold_note(version, latest, installable, minimum_age_minutes)]
}

const release_hold = {
	HOLD_LABEL,
	is_at_or_above,
	is_latest_withheld,
	resolve_installable,
	is_release_age_hold,
	format_window,
	format_release_hold_note,
	build_release_hold_notes,
}

export { release_hold }
