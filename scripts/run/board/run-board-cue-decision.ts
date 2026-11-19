import type { BoardHeader } from './run-board-header'
import { run_board_header_notice } from './run-board-header-notice'
import type { LocalRead } from './run-board-read'
import type { CueName } from './run-board-sound-cues'
import { run_board_sound_repeat } from './run-board-sound-repeat'
import { run_board_sound_transition } from './run-board-sound-transition'
import type { BoardState } from './run-board-state'

// What a frame decides about its sound, without sounding it: the cue it picked, if any, and what the next
// frame carries over.

type CueState = Pick<BoardState, 'plan' | 'sound_snapshot' | 'sound_pending' | 'notice'>

type CueDecision = Pick<BoardState, 'sound_snapshot' | 'sound_pending' | 'notice'> & {
	cue: CueName | undefined
}

// The cue this frame picked over the last one's, kept as the notice the header draws whether it sounds or
// not, and what the next frame weighs its own against. A frame before the plan is read is no base — the
// rows the plan brings were already there — so the frame the plan arrives on is the first base, silent.
// It is decided before the frame is drawn, so the notice shows on the frame it sounds on.
function decided(
	state: CueState,
	header: BoardHeader,
	events: LocalRead['events'],
	now_ms: number,
): CueDecision {
	const snapshot =
		state.plan === undefined ? undefined : run_board_sound_transition.snapshot_of(header, events)
	const { sounding, pending } = run_board_sound_repeat.next_cue(
		state.sound_snapshot,
		snapshot,
		state.sound_pending,
		now_ms,
	)
	const notice = run_board_header_notice.next(state.notice, sounding, now_ms)

	return { sound_snapshot: snapshot, sound_pending: pending, notice, cue: sounding?.cause.cue }
}

const run_board_cue_decision = { decided }

export { run_board_cue_decision }
export type { CueDecision }
