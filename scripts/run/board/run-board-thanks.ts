import { run_board_fetch, type Fetch } from './run-board-fetch'
import { run_board_state, type BoardPorts, type BoardState, type Pace } from './run-board-state'
import type { Thanks } from './run-board-thanks-csv'
import { run_board_thanks_read } from './run-board-thanks-read'

// The reviewers' roster a `run:board` redraw draws above its legend. Like the GitHub reads
// (`run-board-github.ts`), **a live board never waits on it**: the read is launched and folded in on
// the redraw after it lands; one plain frame waits for it. It is launched again no sooner than the
// roster's own record goes stale. A board with no `read_thanks` port — the chat frame — reads none and
// draws none.

const { TTL_MS } = run_board_thanks_read
const { is_due } = run_board_state

type ThanksState = Pick<BoardState, 'thanks' | 'thanks_fetch' | 'thanks_attempted_ms'>

function launch_thanks(state: BoardState, ports: BoardPorts, now_ms: number): BoardState {
	const { read_thanks } = ports

	if (
		read_thanks === undefined ||
		state.thanks_fetch !== undefined ||
		!is_due(state.thanks_attempted_ms, TTL_MS, now_ms)
	) {
		return state
	}

	const thanks_fetch: Fetch<Thanks> = run_board_fetch.launch(read_thanks, state.thanks)

	return { ...state, thanks_fetch, thanks_attempted_ms: now_ms }
}

function fold_thanks(state: BoardState): BoardState {
	const answer = state.thanks_fetch?.answer()

	if (answer === undefined) return state

	return { ...state, thanks: answer.value, thanks_fetch: undefined }
}

// Folds what landed and launches what is due; at the `settled` pace, waits for it to land.
async function gather_thanks(
	state: BoardState,
	ports: BoardPorts,
	now_ms: number,
	pace: Pace,
): Promise<BoardState> {
	const launched = launch_thanks(fold_thanks(state), ports, now_ms)

	if (pace === 'settled' && launched.thanks_fetch !== undefined) await launched.thanks_fetch.landed

	return fold_thanks(launched)
}

const run_board_thanks = { gather_thanks }

export { run_board_thanks }
export type { ThanksState }
