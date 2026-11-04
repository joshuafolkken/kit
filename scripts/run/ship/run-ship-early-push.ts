import { josh_command } from '#scripts/josh/josh-run'
import { early_push_record } from '#scripts/run/early-push-record'
import { run_ship_probe } from './run-ship-probe'
import { run_ship_stage, type ShipState, type Stage } from './run-ship-stage'
import type { ShipArguments } from './run-ship-steps'

// Push only an already committed tree; a reviewer may have left a repair in progress.
async function push(args: ShipArguments): Promise<void> {
	const state = await run_ship_probe.read_state()

	if (!state.is_committed || state.is_pushed) {
		await early_push_record.record('ship', state.is_pushed ? 'already-pushed' : 'uncommitted')

		return
	}

	const result = await josh_command.josh_run(
		['git', '-y', '--skip-commit', ...args.body, args.title],
		true,
	)

	await early_push_record.record('ship', result.code === 0 ? 'pushed' : 'push-failed')
}

// Both parallel stages have settled: a push or a round-2 repair changes the commit flags.
async function refresh(stage: Stage, is_review: boolean, state: ShipState): Promise<ShipState> {
	if (!is_review || stage !== run_ship_stage.STAGE.GATE) return state

	return await run_ship_probe.read_state()
}

const run_ship_early_push = { push, refresh }

export { run_ship_early_push }
