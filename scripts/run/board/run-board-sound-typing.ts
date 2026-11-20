import { run_board_sound_player, type Playing, type StartHandlers } from './run-board-sound-player'
import type { Note } from './run-board-sound-synth'
import { run_board_sound_wav } from './run-board-sound-wav'

// joshuafolkken/kit#8250: the teletype trill a live board in a theme sounds while a line types — two
// sine notes, B♭5 then D6, one pair per letter at the intro's pace (the theme row's `intro.letter_ms`, `run-board-theme-defs.ts`). One player sounds it
// however many rows type at once: `set` is idempotent, so a second `on` starts no second player and a
// second `off` does nothing. The WAV is `TRILL_PAIRS` pairs long and loops in one audio stream. A
// trill whose player cannot start stays silent rather than ringing BEL, which is the cues' single
// notice. It is apart from the cues (`run-board-sound-cues.ts`): no tier, transition or repeat rule
// reaches it, so a cue sounds over it.

const NAME = 'teletype'
const TELETYPE: ReadonlyArray<Note> = [
	{ pitch: 'Bb5', ms: 25, wave: 'sine' },
	{ pitch: 'D6', ms: 25, wave: 'sine' },
]
const TRILL_PAIRS = 160
const NOTES: ReadonlyArray<Note> = Array.from({ length: TRILL_PAIRS }, () => TELETYPE).flat()

interface TypingSound {
	set: (is_on: boolean) => void
	stop: () => void
}

interface TypingPorts {
	file: () => string | undefined
	start: (file: string, handlers: StartHandlers) => void
}

// The trill's state: whether it is on, whether the board has closed it for good, the player sounding
// it and the WAV once written.
interface Held {
	is_on: boolean
	is_stopped: boolean
	child: Playing | undefined
	file: string | undefined
}

const DEFAULT_PORTS: TypingPorts = {
	file: () => run_board_sound_wav.cached_wav(NAME, NOTES),
	start: (file, handlers) => {
		run_board_sound_player.loop(file, handlers)
	},
}

// An ended loop stays silent, including a clean exit: restarting would reintroduce the gap.
function hold(held: Held, child: Playing): void {
	if (!held.is_on || held.is_stopped) {
		child.kill()

		return
	}

	held.child = child
	child.on('exit', () => {
		if (held.child !== child) return
		held.child = undefined
	})
}

function begin(held: Held, ports: TypingPorts): void {
	held.file ??= ports.file()
	if (held.file === undefined) return

	ports.start(held.file, {
		started: (child) => {
			hold(held, child)
		},
		failed: () => {
			held.child = undefined
		},
	})
}

function silence(held: Held): void {
	held.child?.kill()
	held.child = undefined
}

function set(held: Held, ports: TypingPorts, is_on: boolean): void {
	if (held.is_stopped || is_on === held.is_on) return
	held.is_on = is_on
	if (is_on) begin(held, ports)
	else silence(held)
}

// The board's trill, off until a line types; `stop` ends it for good as the board closes.
function typing_sound(ports: TypingPorts = DEFAULT_PORTS): TypingSound {
	const held: Held = { is_on: false, is_stopped: false, child: undefined, file: undefined }

	return {
		set: (is_on) => {
			set(held, ports, is_on)
		},
		stop: () => {
			held.is_stopped = true
			held.is_on = false
			silence(held)
		},
	}
}

const run_board_sound_typing = { NAME, NOTES, TELETYPE, TRILL_PAIRS, typing_sound }

export { run_board_sound_typing }
export type { TypingPorts, TypingSound }
