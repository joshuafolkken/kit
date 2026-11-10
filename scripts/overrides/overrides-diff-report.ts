import { development_engines_verdict } from '#scripts/version/development-engines-verdict'
import { overrides_diff, type ChangedBlock, type DiffSources } from './overrides-diff'
import { overrides_check, type OverridesDiff } from './overrides-logic'

// The dependency-update check read against a git revision (`.claude/skills/dependency-update`
// §2–§3): the `devEngines` verdict line, then the overrides answer. `josh overrides --diff` and
// `josh latest:if-required` both print it, so the check has one implementation.

interface PinVerdict {
	is_overrides_moved: boolean
	is_engines_moved: boolean
}

function print_diff_lines(diff: OverridesDiff, heading: string): void {
	console.error(heading)

	for (const line of overrides_check.format_diff_lines(diff)) {
		console.error(line)
	}
}

function print_overrides(sources: DiffSources, range: string): ReadonlyArray<ChangedBlock> {
	const changed = overrides_diff.changed_blocks(sources)

	for (const block of changed) {
		print_diff_lines(block.diff, `✖ ${block.file} overrides changed since ${range}:`)
	}

	if (changed.length === 0) {
		const summary = overrides_check.describe_sources(sources.after)

		console.info(`✔ overrides unchanged since ${range} (${summary}).`)
	}

	return changed
}

// The one line a dependency-update command ends on, read in place of running `overrides --diff`.
function describe_overrides(changed: ReadonlyArray<ChangedBlock>, range: string): string {
	if (changed.length === 0) return 'overrides: keep'
	const files = changed.map((block) => block.file).join(', ')

	return `overrides: restore (${files} changed since ${range})`
}

// `undefined` when the range resolves to no commit (or merge-base) to compare against.
function report(range: string): PinVerdict | undefined {
	const sources = overrides_diff.read_sources(range)
	if (sources === undefined) return undefined
	const engines = development_engines_verdict.describe(
		sources.before.package_json,
		sources.after.package_json,
	)

	console.info(engines)
	const changed = print_overrides(sources, range)

	console.info(describe_overrides(changed, range))

	return {
		is_overrides_moved: changed.length > 0,
		is_engines_moved: !development_engines_verdict.is_intact(engines),
	}
}

// The overrides half alone, all on stderr, for `josh latest`'s last step: its stdout stays empty and
// `latest:corepack` has already printed the `devEngines` line. A range that resolves to nothing is a
// check that did not run, so it answers not kept.
function judge_overrides(range: string): boolean {
	const sources = overrides_diff.read_sources(range)

	if (sources === undefined) {
		console.error(`overrides: not judged (no commit at ${range})`)

		return false
	}

	const changed = overrides_diff.changed_blocks(sources)

	for (const block of changed) {
		print_diff_lines(block.diff, `✖ ${block.file} overrides changed since ${range}:`)
	}

	console.error(describe_overrides(changed, range))

	return changed.length === 0
}

const overrides_diff_report = { report, judge_overrides, print_diff_lines }

export { overrides_diff_report, type PinVerdict }
