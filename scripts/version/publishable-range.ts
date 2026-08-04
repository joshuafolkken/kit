import { package_with_deps_schema } from '#scripts/overrides/schemas'
import semver from 'semver'

// kit ships a `preinstall` hook that installs @aikidosec/safe-chain, whose minimum-age policy hides
// releases younger than its window from every install running behind it. A range whose floor sits
// inside that window has no satisfying version for a consumer, so `pnpm install` fails with
// ERR_PNPM_NO_MATCHING_VERSION naming a version that demonstrably exists and is tagged latest (#742).
//
// The check asks the registry through that same filtered view instead of modelling the policy:
// `pnpm view <name>@<range> version` prints no version and exits non-zero
// (ERR_PNPM_PACKAGE_NOT_FOUND) exactly when nothing visible satisfies the range. Modelling would
// mean guessing safe-chain's threshold, and `minimumReleaseAgeExclude` cannot stand in for it —
// that list governs pnpm's own `minimum-release-age`, and safe-chain has no knowledge of it, which
// is precisely what made the original failure surprising.

interface PublishedRange {
	name: string
	range: string
}

interface ProbeResult {
	exit_code: number
	stdout: string
}

type RangeProbe = (name: string, range: string) => ProbeResult

interface RangePartition {
	checked: Array<PublishedRange>
	skipped: Array<PublishedRange>
}

// A registry range is the only kind this guard can ask about. `workspace:*`, `catalog:`, `file:`,
// `link:` and git URLs resolve outside the registry entirely, so probing them would report a
// violation for a dependency that installs fine — and this runs in consumer repos too, where those
// protocols are ordinary. semver decides: anything it cannot read as a range is not a registry range.
function is_registry_range(range: string): boolean {
	return semver.validRange(range) !== null
}

// Only `dependencies` are installed by a consumer, so only they can break a consumer's install.
// devDependencies never reach one, and peer ranges are satisfied from the consumer's own tree.
function read_published_ranges(package_json_content: string): Array<PublishedRange> {
	const parsed = package_with_deps_schema.parse(JSON.parse(package_json_content))

	return Object.entries(parsed.dependencies ?? {}).map(([name, range]) => ({ name, range }))
}

function partition_registry_ranges(ranges: ReadonlyArray<PublishedRange>): RangePartition {
	const partition: RangePartition = { checked: [], skipped: [] }

	for (const entry of ranges) {
		if (is_registry_range(entry.range)) partition.checked.push(entry)
		else partition.skipped.push(entry)
	}

	return partition
}

// A satisfied range is proven by an actual version on stdout, not merely by output existing:
// safe-chain appends its own "some package versions were suppressed" notice to stdout, so a query
// that answered nothing still comes back non-empty. Requiring a token semver can parse ignores that
// banner without having to match its text, which would rot the moment its wording changes.
//
// Fails closed otherwise: a probe that could not answer (network error, auth failure) counts as
// unsatisfiable rather than being waved through. This runs as a release gate, where a false stop
// costs one re-run and a false pass publishes a package nobody can install.
function is_satisfiable(result: ProbeResult): boolean {
	if (result.exit_code !== 0) return false

	return result.stdout.split(/\s+/u).some((token) => semver.valid(token) !== null)
}

function find_unsatisfiable(
	ranges: ReadonlyArray<PublishedRange>,
	probe: RangeProbe,
): Array<PublishedRange> {
	return ranges.filter((entry) => !is_satisfiable(probe(entry.name, entry.range)))
}

function format_violation(violation: PublishedRange): string {
	return `   ${violation.name}@${violation.range} — no visible version satisfies this range`
}

// The remedy is spelled out because the failure reads as "this version does not exist" while the
// version does exist: without the explanation the obvious next step is to raise the floor further.
function format_failure(violations: ReadonlyArray<PublishedRange>): string {
	return [
		`\n✖ ${String(violations.length)} published dependency range(s) cannot be resolved:`,
		...violations.map((violation) => format_violation(violation)),
		'',
		'   A consumer re-resolving its lockfile installs these ranges and hits',
		'   ERR_PNPM_NO_MATCHING_VERSION. Lower each floor to a release that is already outside',
		'   the supply-chain minimum-age window — the caret still admits the newer version once',
		'   it ages in, so nothing is given up.',
	].join('\n')
}

function format_success(count: number): string {
	return `\n✔ ${String(count)} published dependency range(s) resolve against the registry.`
}

// Printed rather than dropped in silence: a guard that quietly narrows its own coverage reports
// success for exactly the dependencies it never looked at.
function format_skipped(skipped: ReadonlyArray<PublishedRange>): string {
	const list = skipped.map((entry) => `${entry.name}@${entry.range}`).join(', ')

	return `\n⏭ Not checked — resolved outside the registry: ${list}`
}

const publishable_range = {
	read_published_ranges,
	partition_registry_ranges,
	is_registry_range,
	is_satisfiable,
	find_unsatisfiable,
	format_failure,
	format_skipped,
	format_success,
}

export { publishable_range }
export type { ProbeResult, PublishedRange, RangePartition, RangeProbe }
