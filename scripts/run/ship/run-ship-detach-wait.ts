import { cost_cli } from '#scripts/cost-runtime/cost-cli'
import { run_ship_wait_cli } from './run-ship-wait-cli'

// The two calls after a launched `ship --detach`, folded into it (joshuafolkken/kit#5625): the
// `cost --cut` verdict, and on `under` one `ship:wait` chunk, so the session reaches the wait in the call
// that detached. Any other verdict ends the turn and leaves the rest to the supervisor
// (`chain-rule.md` → "A lane child"). `ship:wait` stays its own command for a `pending` re-issue.

const SUCCESS_EXIT_CODE = 0
const UNDER = 'under'
const END_TURN = 'end the turn: the supervisor ships the rest'

async function after_launch(issue: string): Promise<number> {
	const verdict = cost_cli.session_verdict()

	console.info(`cost --cut: ${verdict}`)
	if (verdict === UNDER) return await run_ship_wait_cli.run([issue])
	console.info(END_TURN)

	return SUCCESS_EXIT_CODE
}

const run_ship_detach_wait = { END_TURN, after_launch }

export { run_ship_detach_wait }
