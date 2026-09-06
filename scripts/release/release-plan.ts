import semver from 'semver'

// What a release is, decided from main's history alone (joshuafolkken/kit#1169).
//
// **A version is a property of main's history, not of a branch.** `bump-version.ts` reads the local
// `package.json` and increments it, so two branches cut from the same version both claim the same
// next number — and git's three-way merge does not report two branches writing the same line to the
// same value as a conflict. What surfaces instead is one version carrying two issues, with the other
// version never existing.
//
// The answer is to stop asking a branch. `pending` is how many merges main has taken since the commit
// that last changed the version, and the release raises the version by that many minors. There is one
// place that decides, and it looks only at main at the moment it runs — which is why no lock, no
// reserved number and no queue is needed.

interface VersionedCommit {
	sha: string
	version: string | undefined
}

interface ReleasePlan {
	base: string
	pending: number
	current_version: string
	next_version: string
}

const PENDING_ICON = '🚚'
const SHORT_SHA_LENGTH = 7

// The version immediately before `commits[index]`. `commits` is newest-first and lists only the
// commits that touched `package.json` along main's own first-parent line, so that version is exactly
// `commits[index + 1]`'s: by construction nothing between the two changed the file.
// `oldest_parent_version` closes the list at its far end, where there is no neighbor to compare with.
//
// **The fallback belongs to the end of the list and nowhere else.** `read_version_at` answers
// `undefined` for any revision whose `package.json` could not be read — absent, malformed, or a
// `git show` that failed — so a `?? oldest_parent_version` written on the neighbor's *version*
// would fire in the middle of the list too, comparing against a version several commits older and
// declaring a base far too new. The bounds check asks about the neighbor's existence instead.
function previous_version_of(
	commits: ReadonlyArray<VersionedCommit>,
	index: number,
	oldest_parent_version: string | undefined,
): string | undefined {
	const previous = commits[index + 1]

	return previous === undefined ? oldest_parent_version : previous.version
}

// **The newest commit whose `package.json` version differs from the version immediately before it.**
//
// **A commit that touched `package.json` without moving the version is skipped**, which is what makes
// this right once children stop bumping (joshuafolkken/kit#1486): a dependency update rewrites the
// file every time and must not be mistaken for a release.
//
// **Both sides have to be readable for this to be a version change.** An unreadable neighbor makes
// the comparison unanswerable, and the search carries on to older commits rather than declaring one:
// a base that is too new under-counts the merges since it, and the release then ships fewer minors
// than issues — silently, which is the one failure this command exists to prevent. Finding no base at
// all is reported as a failure by the caller, which is the honest end of the same reasoning.
function find_version_base(
	commits: ReadonlyArray<VersionedCommit>,
	oldest_parent_version: string | undefined,
): string | undefined {
	const found = commits.find((commit, index) => {
		const previous = previous_version_of(commits, index, oldest_parent_version)

		return commit.version !== undefined && previous !== undefined && commit.version !== previous
	})

	return found?.sha
}

// **Raising the version by `pending` minors.** `semver.inc(v, 'minor')` applied N times zeroes the
// patch once and adds one to the minor each time, so N applications are a single addition — written
// as one here rather than as a loop, because the loop would only be re-deriving that identity.
//
// **`pending === 0` returns the current version untouched, and that needs its own branch.** The
// arithmetic zeroes the patch, so `1.339.4` with nothing pending would come back as `1.339.0` — a
// *downgrade* carried inside every `ReleasePlan`, including the ones whose caller decides not to
// release at all.
function next_version(current: string, pending: number): string {
	const parsed = semver.parse(current)

	if (parsed === null) throw new Error(`Invalid version format: ${current}`)

	if (pending === 0) return parsed.version

	return `${String(parsed.major)}.${String(parsed.minor + pending)}.0`
}

function short_sha(sha: string): string {
	return sha.slice(0, SHORT_SHA_LENGTH)
}

// **The count is the line a person reads**, which is why it is built here rather than at each caller:
// the release command prints it, and so does anything else that wants to say how much is waiting to
// ship (joshuafolkken/kit#1169 → "未リリースのマージ件数が、目に見える場所に出る").
function format_pending_line(pending: number): string {
	return `${PENDING_ICON} unreleased merges on main: ${String(pending)}`
}

function format_nothing_to_release(base: string): string {
	return [
		format_pending_line(0),
		`  Nothing to release — no merge has landed on main since ${short_sha(base)}, the commit that last changed the version.`,
	].join('\n')
}

function format_plan(plan: ReleasePlan): string {
	return [
		format_pending_line(plan.pending),
		`  base ${short_sha(plan.base)} · ${plan.current_version} → ${plan.next_version}`,
	].join('\n')
}

const release_plan = {
	find_version_base,
	previous_version_of,
	format_nothing_to_release,
	format_pending_line,
	format_plan,
	next_version,
	short_sha,
	PENDING_ICON,
}

export { release_plan }
export type { ReleasePlan, VersionedCommit }
