import { change_base } from '#scripts/git/change-base'
import { git_spawn } from '#scripts/git/git-spawn'
import { split_resolution } from '#scripts/split/split-resolution'
import { test_pinned_logic } from '#scripts/test/test-pinned-logic'
import { test_related_cap } from '#scripts/test/test-related-cap'
import { lane_implement_rate } from './lane-implement-rate'
import { lane_implement_rate_read } from './lane-implement-rate-read'
import { lane_ledger, type LedgerEntry } from './lane-ledger'
import type { PlanSignals } from './lane-plan-size'
import { lane_size_stats } from './lane-size-stats'
import { lane_stats } from './lane-stats'

// What `josh lane:plan` measures beside the plan for its size bar (joshuafolkken/kit#5568,
// `lane-plan-size.ts`): the hunks the tree already changed against its base, counted as `josh
// test:pinned` counts them (modified source files, tests excluded), one file name per hunk so the bar
// can leave out the files a recorded plan holds — none before the first edit, so a
// re-plan or the ship's probe is where it bites — the files the branch committed since that base (the
// stand-in for a cleared record's missing history, joshuafolkken/kit#5684), the files that base holds
// (so a planned file reads as new or existing, joshuafolkken/kit#6652), the recent lines ratio
// `lane:stats` prints, whether this lane already filed a split child, and the `test:related` hubs among
// the planned files. A diff, ledger or graph it cannot read counts as nothing, so an unmeasured axis
// never refuses.

const RATIO_PERIOD_DAYS = lane_implement_rate_read.PERIOD_DAYS
const NAME_ONLY = '--name-only'
const DIFF_ARGUMENTS = [
	'diff',
	'-U0',
	'--no-color',
	'--no-ext-diff',
	'--diff-filter=M',
	'--src-prefix=a/',
	'--dst-prefix=b/',
]

function hunk_files(diff: string): Array<string> {
	return test_pinned_logic.parse_hunks(diff).map((hunk) => hunk.file)
}

type TreeProbe = Pick<PlanSignals, 'hunk_files' | 'committed_files' | 'base_files'>

const NO_PROBE: TreeProbe = { hunk_files: [], committed_files: [] }

async function read_or_empty(arguments_: Array<string>): Promise<string> {
	try {
		return await git_spawn.read(arguments_)
	} catch {
		return ''
	}
}

function names_of(output: string): Array<string> {
	return output.split('\n').filter((name) => name !== '')
}

// An unreadable listing stays unknown rather than empty, so no planned file reads as new by mistake.
async function base_files_of(base: string): Promise<ReadonlySet<string> | undefined> {
	try {
		return new Set(names_of(await git_spawn.read(['ls-tree', '-r', NAME_ONLY, base])))
	} catch {
		return undefined
	}
}

async function probe_of(base: string): Promise<TreeProbe> {
	const [diff, committed, base_files] = await Promise.all([
		read_or_empty([...DIFF_ARGUMENTS, base]),
		read_or_empty(['diff', NAME_ONLY, `${base}...HEAD`]),
		base_files_of(base),
	])

	return { hunk_files: hunk_files(diff), committed_files: names_of(committed), base_files }
}

async function tree_of(): Promise<TreeProbe> {
	const base = await change_base.resolved_through_merge()

	return base === undefined ? NO_PROBE : await probe_of(base)
}

async function entries_of(): Promise<ReadonlyArray<LedgerEntry>> {
	const ledger = await lane_ledger.target()

	return ledger === undefined ? [] : lane_ledger.read_entries(ledger)
}

function signals_from(
	issue: number,
	tree: TreeProbe,
	entries: ReadonlyArray<LedgerEntry>,
	now_ms: number,
): PlanSignals {
	const window = lane_stats.window_of(RATIO_PERIOD_DAYS, now_ms)
	const ratios = lane_size_stats.ratios(entries, window)

	return {
		...tree,
		files_ratio: ratios.files,
		lines_ratio: ratios.lines,
		implement_rate: lane_implement_rate.rate(entries, window),
		split_filed: split_resolution.split_issues(entries).has(issue),
	}
}

// The hubs `paths` holds (joshuafolkken/kit#6543), none for no paths, so a caller with no plan builds no
// graph.
async function hubs_of(paths: ReadonlyArray<string>): Promise<ReadonlyArray<string>> {
	return paths.length === 0 ? [] : await test_related_cap.hubs_of(process.cwd(), paths)
}

async function signals_of(issue: number, paths: ReadonlyArray<string> = []): Promise<PlanSignals> {
	const [tree, entries, hubs] = await Promise.all([tree_of(), entries_of(), hubs_of(paths)])

	return { ...signals_from(issue, tree, entries, Date.now()), hubs }
}

const lane_plan_signals = { hunk_files, signals_from, signals_of }

export { lane_plan_signals }
