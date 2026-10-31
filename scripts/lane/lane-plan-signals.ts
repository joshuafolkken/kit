import { change_base } from '#scripts/git/change-base'
import { git_spawn } from '#scripts/git/git-spawn'
import { split_resolution } from '#scripts/split/split-resolution'
import { test_pinned_logic } from '#scripts/test/test-pinned-logic'
import { lane_ledger, type LedgerEntry } from './lane-ledger'
import type { PlanSignals } from './lane-plan-size'
import { lane_size_stats } from './lane-size-stats'
import { lane_stats } from './lane-stats'

// What `josh lane:plan` measures beside the plan for its size bar (joshuafolkken/kit#5568,
// `lane-plan-size.ts`): the hunks the tree already changed against its base, counted as `josh
// test:pinned` counts them (modified source files, tests excluded) — none before the first edit, so a
// re-plan or the ship's probe is where it bites — the recent lines ratio
// `lane:stats` prints, and whether this lane already filed a split child. A diff or ledger it cannot
// read counts as nothing, so an unmeasured axis never refuses.

const RATIO_PERIOD_DAYS = 3
const DIFF_ARGUMENTS = [
	'diff',
	'-U0',
	'--no-color',
	'--no-ext-diff',
	'--diff-filter=M',
	'--src-prefix=a/',
	'--dst-prefix=b/',
]

function counted_hunks(diff: string): number {
	return test_pinned_logic.parse_hunks(diff).length
}

async function diff_of(base: string): Promise<string> {
	try {
		return await git_spawn.read([...DIFF_ARGUMENTS, base])
	} catch {
		return ''
	}
}

async function hunks_of(): Promise<number> {
	const base = await change_base.resolved_through_merge()

	return base === undefined ? 0 : counted_hunks(await diff_of(base))
}

async function entries_of(): Promise<ReadonlyArray<LedgerEntry>> {
	const ledger = await lane_ledger.target()

	return ledger === undefined ? [] : lane_ledger.read_entries(ledger)
}

function signals_from(
	issue: number,
	hunks: number,
	entries: ReadonlyArray<LedgerEntry>,
	now_ms: number,
): PlanSignals {
	const window = lane_stats.window_of(RATIO_PERIOD_DAYS, now_ms)

	return {
		hunks,
		lines_ratio: lane_size_stats.lines_ratio(entries, window),
		split_filed: split_resolution.split_issues(entries).has(issue),
	}
}

async function signals_of(issue: number): Promise<PlanSignals> {
	const [hunks, entries] = await Promise.all([hunks_of(), entries_of()])

	return signals_from(issue, hunks, entries, Date.now())
}

const lane_plan_signals = { counted_hunks, signals_from, signals_of }

export { lane_plan_signals }
