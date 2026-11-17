import { metrics_totals } from '#scripts/gate/metrics-totals'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { run_ship_pre_detach_pinned } from '#scripts/run/ship/run-ship-pre-detach-pinned'
import { run_chain, type ChainStage, type HoldStop } from './run-chain'
import { run_review_pinned_accepted } from './run-review-pinned-accepted'

// The judgments `run:review`'s open stops on — a metrics total grown past every approval, and a changed
// place no test pins — asked again of the tree round 1's fixes left, before the ship
// (joshuafolkken/kit#7730). They are the functions the ship's pre-detach asks, so a fix that grew a
// total or added an unpinned hunk stops here, not one ship later. The stage runs no command: its hold
// is the check. Each one honours what this branch already accepted (`--accept-metrics`,
// `--unpinned-ok`).

const RECHECK = 'recheck'
const SUCCESS_EXIT_CODE = 0

type Print = (text: string) => void

function metrics_stop(mode: ReadonlyArray<string>): HoldStop {
	return {
		notice: 'a metrics total grew past its approval',
		next: (issue) =>
			`bring the named total back down, or where the growth is meant record it with \`pnpm josh metrics --accept --reason "<why>"\` (\`run:review\` refuses a reopen after round 1), ${run_chain.rerun(issue, RECHECK, mode)}`,
	}
}

function pinned_stop(mode: ReadonlyArray<string>): HoldStop {
	return {
		notice: 'a changed place no test pins',
		next: (issue) =>
			`pin each named place with a test that turns red without it, ${run_chain.rerun(issue, RECHECK, mode)}; for a change no test can pin, ship with \`--unpinned-ok "<reason>"\``,
	}
}

async function metrics_hold(
	mode: ReadonlyArray<string>,
	print: Print,
): Promise<HoldStop | undefined> {
	const refusal = await metrics_totals.totals_refusal(PROJECT_ROOT)

	if (refusal === undefined) return undefined
	print(refusal)

	return metrics_stop(mode)
}

async function pinned_hold(
	issue: string,
	mode: ReadonlyArray<string>,
	print: Print,
): Promise<HoldStop | undefined> {
	const reason = await run_review_pinned_accepted.recorded_reason()
	const result = await run_ship_pre_detach_pinned.pinned_check({
		number: issue,
		unpinned_ok: run_ship_pre_detach_pinned.ok_argv(reason),
	})

	if (result.code === SUCCESS_EXIT_CODE) return undefined
	print(result.out)

	return pinned_stop(mode)
}

// `mode` is the `--join` flags its rerun keeps.
function stage(mode: ReadonlyArray<string>, print: Print = console.info): ChainStage {
	return {
		name: RECHECK,
		argv: [],
		next: (issue) => run_chain.rerun(issue, RECHECK, mode),
		hold: async (issue) =>
			(await metrics_hold(mode, print)) ?? (await pinned_hold(issue, mode, print)),
	}
}

const run_chain_recheck = { RECHECK, stage }

export { run_chain_recheck }
