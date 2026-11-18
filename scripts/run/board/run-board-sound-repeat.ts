import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_board_sound_cues, type CueName } from './run-board-sound-cues'
import { run_board_sound_transition, type SoundSnapshot } from './run-board-sound-transition'

// A wait on a person or an alert left standing sounds once more after ten minutes, and never again while
// it stands (joshuafolkken/kit#7947); a cue missed while away from the desk is not lost for good. An
// info cue never replays.

const REPLAY_AFTER_MINUTES = 10
const REPLAY_AFTER_MS = REPLAY_AFTER_MINUTES * MS_PER_MINUTE

// The standing cue, when it began, and whether its one replay has sounded.
interface Pending {
	readonly cue: CueName
	readonly since_ms: number
	readonly is_replayed: boolean
}

interface NextCue {
	readonly cue: CueName | undefined
	readonly pending: Pending | undefined
}

// The loudest human or alert cue a frame holds; info cues are not tracked.
function standing_cue(current: SoundSnapshot | undefined): CueName | undefined {
	if (current === undefined) return undefined
	const held = run_board_sound_transition
		.held_cues(current)
		.filter((cue) => run_board_sound_cues.CUES[cue].tier !== 'info')

	return run_board_sound_cues.loudest(held)
}

// The pending cue carried into this frame: dropped once resolved, restarted when another cue stands or
// this frame's transition sounds it afresh — a second lane entering the same wait counts from its own start.
function carried(
	pending: Pending | undefined,
	standing: CueName | undefined,
	transition: CueName | undefined,
	now_ms: number,
): Pending | undefined {
	if (standing === undefined) return undefined
	if (transition !== standing && pending?.cue === standing) return pending

	return { cue: standing, since_ms: now_ms, is_replayed: false }
}

function is_due(pending: Pending | undefined, now_ms: number): pending is Pending {
	return (
		pending !== undefined && !pending.is_replayed && now_ms - pending.since_ms >= REPLAY_AFTER_MS
	)
}

// The cue this frame sounds: a transition first, else the standing cue's one replay once it is due.
function next_cue(
	previous: SoundSnapshot | undefined,
	current: SoundSnapshot | undefined,
	pending: Pending | undefined,
	now_ms: number,
): NextCue {
	const transition = run_board_sound_transition.cue_of(previous, current)
	const next = carried(pending, standing_cue(current), transition, now_ms)
	if (transition !== undefined || !is_due(next, now_ms)) return { cue: transition, pending: next }

	return { cue: next.cue, pending: { ...next, is_replayed: true } }
}

const run_board_sound_repeat = { REPLAY_AFTER_MS, next_cue }

export { run_board_sound_repeat }
export type { NextCue, Pending }
