import { cost_cli } from '#scripts/cost-runtime/cost-cli'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_hand_back_held } from '#scripts/lane/lane-hand-back-held'
import { run_ship_wait_cli } from './run-ship-wait-cli'

// The two calls after a launched `ship --detach`, folded into it (joshuafolkken/kit#5625): the
// `cost --cut` verdict, and on `under` one `ship:wait` chunk, so the session reaches the wait in the call
// that detached. Any other verdict ends the turn and leaves the rest to the supervisor
// (`chain-rule.md` → "A lane child"). `ship:wait` stays its own command for a `pending` re-issue.

const SUCCESS_EXIT_CODE = 0
const UNDER = 'under'
const END_TURN = 'end the turn: the supervisor ships the rest'

// A lane child's detach frees its seat: a full driver's hand-back mark becomes its hold
// (joshuafolkken/kit#7121). A `--detach` outside a lane frees no seat, so it leaves the mark alone.
async function after_launch(issue: string): Promise<number> {
	if (lane_child_marker.is_child_of(process.cwd())) await lane_hand_back_held.record()
	const verdict = cost_cli.session_verdict()

	console.info(`cost --cut: ${verdict}`)
	if (verdict === UNDER) return await run_ship_wait_cli.run([issue])
	console.info(END_TURN)

	return SUCCESS_EXIT_CODE
}

const run_ship_detach_wait = { END_TURN, after_launch }

export { run_ship_detach_wait }
