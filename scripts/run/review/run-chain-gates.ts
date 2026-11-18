import { metrics_totals } from '#scripts/gate/metrics-totals'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { buffered_process } from '#scripts/lib/buffered-process'
import { shell_quote } from '#scripts/lib/shell-quote'
import { review_brief_cli } from '#scripts/review/review-brief-cli'
import { run_chain, type ChainStage, type HoldStop } from './run-chain'

// Two stops `run:review` makes, asked by `run:chain` where the rerun after them is cheapest
// (joshuafolkken/kit#7926). A metrics total grown past its approval stops right after `check:related`
// with the `--accept-metrics` rerun, not inside `run:review` one stage run later; a reason given goes
// to `run:review`, which records the acceptance as before. A `--from run:review` entry on a tree whose
// scoped checks are not green stops before any stage runs, with the `--from check:related` rerun. Each
// is the judgment `run:review` itself makes (`metrics_totals.totals_check`,
// `review_brief_cli.scoped_refusal`), so neither gate is weakened.

const METRICS_TOTALS = 'metrics-totals'
const SCOPED_GREEN = 'scoped-green'
const CHECK_RELATED = 'check:related'
const RUN_REVIEW = 'run:review'
const ACCEPT_FLAG = '--accept-metrics'
const FLAG_PREFIX = '--'

type Print = (text: string) => void

// The review arguments as a rerun line types them: each reason one shell word, so a pasted rerun
// never expands a `$` or a backtick in it.
function typed(review_args: ReadonlyArray<string>): ReadonlyArray<string> {
	return review_args.map((part) => (part.startsWith(FLAG_PREFIX) ? part : shell_quote.word(part)))
}

function metrics_stop(review_args: ReadonlyArray<string>): HoldStop {
	const mode = [...typed(review_args), ACCEPT_FLAG, '"<why>"']

	return {
		notice: 'a metrics total grew past its approval',
		refusal: 'metrics-growth',
		next: (issue) =>
			`bring the named total back down, or where the growth is meant give its reason, ${run_chain.rerun(issue, METRICS_TOTALS, mode)}`,
	}
}

async function metrics_hold(
	review_args: ReadonlyArray<string>,
	print: Print,
): Promise<HoldStop | undefined> {
	if (review_args.includes(ACCEPT_FLAG)) return undefined
	const result = await metrics_totals.totals_check(PROJECT_ROOT)

	if (result === undefined || !buffered_process.is_process_failed(result)) return undefined
	print(result.output.trim())

	return metrics_stop(review_args)
}

function metrics_stage(review_args: ReadonlyArray<string>, print: Print): ChainStage {
	return {
		name: METRICS_TOTALS,
		argv: [],
		next: (issue) => run_chain.rerun(issue, METRICS_TOTALS, typed(review_args)),
		hold: async () => await metrics_hold(review_args, print),
	}
}

// The opening list with the metrics stage right after `check:related`.
function opening(
	stages: ReadonlyArray<ChainStage>,
	review_args: ReadonlyArray<string>,
	print: Print = console.info,
): ReadonlyArray<ChainStage> {
	return stages.flatMap((stage) =>
		stage.name === CHECK_RELATED ? [stage, metrics_stage(review_args, print)] : [stage],
	)
}

function scoped_next(review_args: ReadonlyArray<string>): (issue: string) => string {
	return (issue) =>
		`bring the scoped checks green, ${run_chain.rerun(issue, CHECK_RELATED, typed(review_args))}`
}

async function scoped_hold(
	review_args: ReadonlyArray<string>,
	print: Print,
): Promise<HoldStop | undefined> {
	const refusal = await review_brief_cli.scoped_refusal()

	if (refusal === undefined) return undefined
	print(refusal)

	return {
		notice: 'scoped checks not green on this tree',
		refusal: 'scoped-not-green',
		next: scoped_next(review_args),
	}
}

function scoped_stage(review_args: ReadonlyArray<string>, print: Print): ChainStage {
	return {
		name: SCOPED_GREEN,
		argv: [],
		next: scoped_next(review_args),
		hold: async () => await scoped_hold(review_args, print),
	}
}

// A `--from run:review` entry asks the scoped checks first; any other entry runs the stages as given.
function entry(
	stages: ReadonlyArray<ChainStage>,
	from: string | undefined,
	review_args: ReadonlyArray<string>,
	print: Print = console.info,
): ReadonlyArray<ChainStage> {
	if (from !== RUN_REVIEW) return stages

	return [scoped_stage(review_args, print), ...stages]
}

const run_chain_gates = { entry, opening }

export { run_chain_gates }
