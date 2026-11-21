import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_board_sound_cues } from './run-board-sound-cues'
import {
	run_board_sound_transition,
	type Cause,
	type SoundSnapshot,
} from './run-board-sound-transition'

// A wait on a person or an alert left standing sounds once more after ten minutes, and never again while
// it stands (joshuafolkken/kit#7947); a cue missed while away from the desk is not lost for good. An
// info cue never replays.

const REPLAY_AFTER_MINUTES = 10
const REPLAY_AFTER_MS = REPLAY_AFTER_MINUTES * MS_PER_MINUTE

// The standing cue's cause, when it began, and whether its one replay has sounded.
interface Pending {
	readonly cause: Cause
	readonly since_ms: number
	readonly is_replayed: boolean
}

// What a frame sounds: the cause, and whether it is a standing cue's replay.
interface Sounding {
	readonly cause: Cause
	readonly is_repeat: boolean
}

interface NextCue {
	readonly sounding: Sounding | undefined
	readonly pending: Pending | undefined
}

// The loudest human or alert cue a frame holds; info cues are not tracked.
function standing_cause(current: SoundSnapshot | undefined): Cause | undefined {
	if (current === undefined) return undefined
	const held = run_board_sound_transition
		.held_causes(current)
		.filter((cause) => run_board_sound_cues.CUES[cause.cue].tier !== 'info')

	return run_board_sound_transition.loudest_cause(held)
}

// Whether `pending` still counts for `standing`: the same cue, not sounded afresh by this frame.
function is_kept(
	pending: Pending | undefined,
	standing: Cause,
	transition: Cause | undefined,
): pending is Pending {
	return transition?.cue !== standing.cue && pending?.cause.cue === standing.cue
}

// The pending cue carried into this frame: dropped once resolved, restarted when another cue stands or
// this frame's transition sounds it afresh — a second lane entering the same wait counts from its own start.
// A kept cue takes the cause standing now, so its replay names a lane still waiting, not one resolved.
function carried(
	pending: Pending | undefined,
	standing: Cause | undefined,
	transition: Cause | undefined,
	now_ms: number,
): Pending | undefined {
	if (standing === undefined) return undefined
	if (is_kept(pending, standing, transition)) return { ...pending, cause: standing }

	return { cause: standing, since_ms: now_ms, is_replayed: false }
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
	const transition = run_board_sound_transition.cause_of(previous, current)
	const next = carried(pending, standing_cause(current), transition, now_ms)
	const sounding = transition === undefined ? undefined : { cause: transition, is_repeat: false }
	if (sounding !== undefined || !is_due(next, now_ms)) return { sounding, pending: next }
	const replay = { cause: next.cause, is_repeat: true }

	return { sounding: replay, pending: { ...next, is_replayed: true } }
}

const run_board_sound_repeat = { REPLAY_AFTER_MS, next_cue }

export { run_board_sound_repeat }
export type { NextCue, Pending, Sounding }
