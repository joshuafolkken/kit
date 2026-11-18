import { lane_ledger, type LedgerEntry, type LintRelatedEntry } from './lane-ledger'
import { lane_stats, type StatsWindow } from './lane-stats'
import { lane_test_related_stats } from './lane-test-related-stats'

// Where a `josh lint:related` run spends its time (joshuafolkken/kit#7827): one row per timed stage —
// the launcher's rebuild, the core wait, the scoped fix pass, the structural checks, the prettier /
// ESLint pair, the document checks and the unused members — then the whole run, each with how many
// runs timed it and their median. The structural checks overlap the lint, so the rows do not add up to
// the whole run. `josh lane:value cell "lint:related stage" <stage> "median (s)"` reads one.

const COLUMNS = ['lint:related stage', 'runs', 'median (s)'] as const

type StageField =
	| 'rebuild_ms'
	| 'core_wait_ms'
	| 'fix_ms'
	| 'structural_ms'
	| 'lint_ms'
	| 'documents_ms'
	| 'unused_members_ms'
	| 'elapsed_ms'

const STAGE_ROWS: ReadonlyArray<readonly [string, StageField]> = [
	['rebuild', 'rebuild_ms'],
	['core wait', 'core_wait_ms'],
	['fix', 'fix_ms'],
	['structural', 'structural_ms'],
	['lint', 'lint_ms'],
	['documents', 'documents_ms'],
	['unused members', 'unused_members_ms'],
	['whole run', 'elapsed_ms'],
]

function is_lint_related(entry: LedgerEntry): entry is LintRelatedEntry {
	return entry.kind === lane_ledger.KIND.LINT_RELATED
}

function stage_row(
	label: string,
	field: StageField,
	runs: ReadonlyArray<LintRelatedEntry>,
): string {
	const timed = runs.map((run) => run[field]).filter((ms) => ms !== undefined)

	return lane_stats.to_row([
		label,
		String(timed.length),
		lane_test_related_stats.seconds_cell(timed),
	])
}

// The period's table: `entries` is the whole ledger, filtered here to `window`.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const runs = lane_stats.in_window(entries, window).filter(is_lint_related)

	return lane_test_related_stats.rows_under(
		COLUMNS,
		STAGE_ROWS.map(([label, field]) => stage_row(label, field, runs)),
	)
}

const lane_lint_related_stats = { table }

export { lane_lint_related_stats }
