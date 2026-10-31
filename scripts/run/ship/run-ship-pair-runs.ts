import type { GateTree } from '#scripts/gate/gate-tree'
import { scoped_green } from '#scripts/gate/scoped-green'

// **One scoped pair at a time in a ship process** (joshuafolkken/kit#5538). Round 2 runs beside the
// gate stage and both meet the pair: run side by side on one tree, each read no green record and ran
// both checks — the second run cost the stage its minutes. Queued, the later pair reads the records
// the earlier one wrote, so an unmoved tree runs nothing a second time. The verdict is the checks'
// own either way.
//
// Each run that starts checks is counted, and a run after the first names why it ran again, so the
// lap `lane:breakdown` reads carries it: the tree moved since the last pair, the last pair was red on
// this tree, or it was green and left no record this pair could reuse.

const SUCCESS_EXIT_CODE = 0

const REASON = { MOVED: 'moved', RECHECK: 'recheck', NO_RECORD: 'no-record' } as const

type Reason = (typeof REASON)[keyof typeof REASON]

interface PairRun {
	runs: number
	rerun?: Reason
}

interface Last {
	tree: GateTree
	code: number
}

// `current` is the run the pair now in its turn started, absent while it started none.
const state: { runs: number; last?: Last; current?: PairRun; queue: Promise<unknown> } = {
	runs: 0,
	queue: Promise.resolve(),
}

// The earlier pair's own caller reads its failure; the queue only waits for it to end.
async function after<T>(ahead: Promise<unknown>, run: () => Promise<T>): Promise<T> {
	await Promise.allSettled([ahead])
	delete state.current

	return await run()
}

async function one_at_a_time<T>(run: () => Promise<T>): Promise<T> {
	const turn = after(state.queue, run)

	state.queue = turn

	return await turn
}

function reason_of(last: Last, tree: GateTree): Reason {
	if (!scoped_green.is_unmoved(last.tree, tree)) return REASON.MOVED

	return last.code === SUCCESS_EXIT_CODE ? REASON.NO_RECORD : REASON.RECHECK
}

// Why a run after the first that started checks runs them again; the first names none, even after a
// pair that ran nothing.
function rerun_of(tree: GateTree): Reason | undefined {
	if (state.runs === 1 || state.last === undefined) return undefined

	return reason_of(state.last, tree)
}

// Counts the run about to start checks on `tree`; the line the ship log carries for a rerun.
function begin(tree: GateTree): string | undefined {
	state.runs += 1
	const rerun = rerun_of(tree)

	state.current = rerun === undefined ? { runs: state.runs } : { runs: state.runs, rerun }

	return rerun === undefined ? undefined : `scoped pair run ${String(state.runs)} (${rerun})`
}

// The tree a pair met and how it ended — a pair that ran nothing met it green.
function met(tree: GateTree, code: number): void {
	state.last = { tree, code }
}

function current(): PairRun | Record<string, never> {
	return state.current ?? {}
}

function forget(): void {
	state.runs = 0
	delete state.last
	delete state.current
}

const run_ship_pair_runs = { REASON, begin, current, forget, met, one_at_a_time }

export { run_ship_pair_runs }
