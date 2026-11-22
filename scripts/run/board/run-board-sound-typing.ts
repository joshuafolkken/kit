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

// `left_ms`, given with `on`, is how long the letters still type: the trill stops itself then rather
// than at the next `set(false)`, which a slow gather can hold up (joshuafolkken/kit#8523). Without it
// (the intro) the trill sounds until `set(false)`.
interface TypingSound {
	set: (is_on: boolean, left_ms?: number) => void
	stop: () => void
}

interface TypingPorts {
	file: () => string | undefined
	start: (file: string, handlers: StartHandlers) => void
	// Calls `fire` after `ms`; the returned function cancels it. A timer that holds no process open
	// when left out.
	after?: (ms: number, fire: () => void) => () => void
}

// The trill's state: whether it is on, whether the board has closed it for good, the player sounding
// it, the WAV once written and the cancel of the timer that stops it once its letters type through.
interface Held {
	is_on: boolean
	is_stopped: boolean
	child: Playing | undefined
	file: string | undefined
	generation: symbol | undefined
	disarm: (() => void) | undefined
}

function after(ms: number, fire: () => void): () => void {
	const timer = setTimeout(fire, ms)

	timer.unref()

	return () => {
		clearTimeout(timer)
	}
}

// The teletype trill's WAV path, the wargames theme's typing voice (joshuafolkken/kit#8365).
function teletype_wav(): string | undefined {
	return run_board_sound_wav.cached_wav(NAME, NOTES)
}

const DEFAULT_PORTS: TypingPorts = {
	file: teletype_wav,
	start: (file, handlers) => {
		run_board_sound_player.loop(file, handlers)
	},
}

// The default ports sounding another voice's WAV: a theme row's `typing` (joshuafolkken/kit#8365).
function voiced(file: () => string | undefined): TypingPorts {
	return { ...DEFAULT_PORTS, file }
}

// An ended loop stays silent, including a clean exit: restarting would reintroduce the gap.
function hold(held: Held, child: Playing, generation: symbol): void {
	if (!held.is_on || held.is_stopped || held.generation !== generation) {
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
	const generation = Symbol('typing playback')

	held.generation = generation

	ports.start(held.file, {
		started: (child) => {
			hold(held, child, generation)
		},
		failed: () => {
			if (held.generation === generation) held.child = undefined
		},
	})
}

function silence(held: Held): void {
	held.child?.kill()
	held.child = undefined
}

function turn(held: Held, ports: TypingPorts, is_on: boolean): void {
	if (is_on === held.is_on) return
	held.is_on = is_on
	if (is_on) begin(held, ports)
	else silence(held)
}

function disarm(held: Held): void {
	held.disarm?.()
	held.disarm = undefined
}

// Re-arms only the stop timer while the letters type: the player keeps sounding, never restarted
// (see `hold`).
function arm(held: Held, ports: TypingPorts, left_ms: number | undefined): void {
	disarm(held)
	if (left_ms === undefined || !held.is_on) return
	held.disarm = (ports.after ?? after)(left_ms, () => {
		held.disarm = undefined
		turn(held, ports, false)
	})
}

function set(held: Held, ports: TypingPorts, is_on: boolean, left_ms: number | undefined): void {
	if (held.is_stopped) return
	turn(held, ports, is_on)
	arm(held, ports, left_ms)
}

// The board's trill, off until a line types; `stop` ends it for good as the board closes.
function typing_sound(ports: TypingPorts = DEFAULT_PORTS): TypingSound {
	const held: Held = {
		is_on: false,
		is_stopped: false,
		child: undefined,
		file: undefined,
		generation: undefined,
		disarm: undefined,
	}

	return {
		set: (is_on, left_ms) => {
			set(held, ports, is_on, left_ms)
		},
		stop: () => {
			held.is_stopped = true
			held.is_on = false
			disarm(held)
			silence(held)
		},
	}
}

const run_board_sound_typing = {
	NAME,
	NOTES,
	TELETYPE,
	TRILL_PAIRS,
	teletype_wav,
	typing_sound,
	voiced,
}

export { run_board_sound_typing }
export type { TypingPorts, TypingSound }
