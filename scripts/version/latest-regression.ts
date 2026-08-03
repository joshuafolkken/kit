import { package_with_deps_schema } from '#scripts/overrides/schemas'
import semver from 'semver'

// `pnpm update --latest` sets each range to whatever the registry reports as newest. When a
// supply-chain guard suppresses versions younger than a minimum age, the newest *allowed* version
// can be older than the one already installed, and the update writes that regression into
// package.json and the lockfile without a word. Detecting it means comparing the ranges the update
// rewrote against the ones it replaced — the registry is not consulted again, so this stays a pure
// comparison of two manifests.

interface VersionRegression {
	name: string
	kept: string
	offered: string
}

function read_direct_dependencies(package_json_content: string): Record<string, string> {
	const parsed = package_with_deps_schema.parse(JSON.parse(package_json_content))

	return { ...parsed.dependencies, ...parsed.devDependencies }
}

// Ranges are compared by their lowest satisfying version: `^4.23.5` guarantees at least 4.23.5, so
// a rewrite to `^4.23.1` lowers the floor even though both ranges could resolve to the same build.
// A range semver cannot read (a git URL, `workspace:*`, a tag) yields undefined and is skipped —
// there is no ordering to assert, and guessing one would revert updates that were never regressions.
function to_floor(range: string | undefined): semver.SemVer | undefined {
	if (range === undefined) return undefined

	try {
		return semver.minVersion(range) ?? undefined
	} catch {
		return undefined
	}
}

function is_regression(before_range: string | undefined, after_range: string | undefined): boolean {
	const before = to_floor(before_range)
	const after = to_floor(after_range)

	if (before === undefined || after === undefined) return false

	return semver.lt(after, before)
}

/**
 * Compare the direct dependencies of two package.json revisions and report every entry whose
 * version floor moved down. Packages added or removed between the two are not regressions.
 */
function find_regressions(before_content: string, after_content: string): Array<VersionRegression> {
	const before = read_direct_dependencies(before_content)
	const after = read_direct_dependencies(after_content)

	return Object.entries(before)
		.filter(([name, range]) => is_regression(range, after[name]))
		.map(([name, range]) => ({ name, kept: range, offered: after[name] ?? '' }))
}

function format_regression(regression: VersionRegression): string {
	return `${regression.name}@${regression.kept} (newest allowed is ${regression.offered})`
}

// Named "keeping" rather than "skipping" so it does not read as the held-back list printed above it:
// those are packages deliberately pinned, these are ones the update would have moved backwards.
//
// The wording blames the *allowed* set rather than the registry: the newer version is normally still
// published and still tagged latest — a minimum-age gate is simply hiding it for now — so the state
// is transient and a later run moves forward on its own.
//
// It also has to say the whole update was rolled back. Excluding the offender from the update
// targets does not exclude it from resolution: pnpm resolves the entire graph either way, and while
// a pin sits above the newest allowed version that pin is unresolvable
// (`ERR_PNPM_NO_MATCHING_VERSION`). So the choice is between a downgrade and no update at all, and
// a reader who is told only "kept tsx" would wrongly assume the rest of the run went through.
function format_kept_back_notice(regressions: ReadonlyArray<VersionRegression>): string {
	const list = regressions.map((regression) => format_regression(regression)).join(', ')

	return [
		`\n⏮ Keeping ${list} — the newest allowed version is older than the installed one.`,
		'   The update was rolled back and no dependency changed: while a pin sits above the newest',
		'   allowed version, the whole tree cannot be resolved. Re-run once the newer release is',
		'   no longer withheld.',
	].join('\n')
}

const latest_regression = {
	read_direct_dependencies,
	find_regressions,
	format_kept_back_notice,
}

export { latest_regression }
export type { VersionRegression }
