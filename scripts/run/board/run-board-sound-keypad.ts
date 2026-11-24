import { run_board_sound_dtmf } from './run-board-sound-dtmf'
import { run_board_sound_wav } from './run-board-sound-wav'

// joshuafolkken/kit#8698: the bttf theme's typing sound — the time-circuit keypad looped while the
// opening and the header's notice and now rows type. A beep every `LETTERS_PER_BEEP` letters, keyed
// as the opening line's beats on a phone keypad; the WAV holds the line's beats once and loops. The
// values are the ones the user heard and approved (the Issue's demo, scene `1 ENTER`).

const NAME = 'keypad'
// The bttf opening line: the theme row's `intro.line` reads it here, so the typed line and the
// keypad's beats stay one source (the theme table imports this module, so it cannot read the table).
const LINE = "Roads? Where we're going, we don't need roads."
const LETTERS_PER_BEEP = 2
const BEEP_MS = 42
// A letter's key on a phone keypad.
const LETTER_KEYS: Readonly<Record<string, string>> = {
	abc: '2',
	def: '3',
	ghi: '4',
	jkl: '5',
	mno: '6',
	pqrs: '7',
	tuv: '8',
	wxyz: '9',
}

// A symbol's key: `?` is `#`, any other symbol `*`; a space has none.
function symbol_key(symbol: string): string | undefined {
	if (/\s/u.test(symbol)) return undefined

	return symbol === '?' ? '#' : '*'
}

// The key a character presses: a digit itself, a letter its phone-keypad digit, else its symbol key.
function key_of(character: string): string | undefined {
	const lower = character.toLowerCase()

	if (/\d/u.test(lower)) return lower

	const group = Object.entries(LETTER_KEYS).find(([letters]) => letters.includes(lower))

	return group === undefined ? symbol_key(character) : group[1]
}

function is_key(key: string | undefined): key is string {
	return key !== undefined
}

// The key of each beat — every `LETTERS_PER_BEEP`-th character, a beat on a space taking the next key.
function beat_keys(line: string = LINE): Array<string> {
	const keys = Array.from(line, key_of)
	const beats = Math.ceil(keys.length / LETTERS_PER_BEEP)

	return Array.from({ length: beats }, (_, beat) =>
		keys.slice(beat * LETTERS_PER_BEEP).find(is_key),
	).filter(is_key)
}

// One unit: the key's beep, then silence to the unit's end; a unit shorter than the beep cuts it off.
function unit_of(key: string, unit_ms: number): Array<number> {
	const beep = run_board_sound_dtmf.beep(key, BEEP_MS)

	return run_board_sound_dtmf.silence(unit_ms).map((_, index) => beep[index] ?? 0)
}

// The line's beats, a unit of `LETTERS_PER_BEEP` letters each, as 16-bit samples.
function typing_samples(letter_ms: number): Int16Array {
	const unit_ms = letter_ms * LETTERS_PER_BEEP

	return run_board_sound_dtmf.pcm(beat_keys().flatMap((key) => unit_of(key, unit_ms)))
}

// The typing WAV's path at the theme's letter pace; `undefined` when it cannot be written.
function typing_wav(letter_ms: number, directory?: string): string | undefined {
	return run_board_sound_wav.resolved_samples(
		{
			name: NAME,
			key: String(letter_ms),
			sample_rate: run_board_sound_dtmf.SAMPLE_RATE,
			render: () => typing_samples(letter_ms),
		},
		directory,
	)
}

const run_board_sound_keypad = {
	BEEP_MS,
	LETTERS_PER_BEEP,
	LINE,
	beat_keys,
	key_of,
	typing_samples,
	typing_wav,
}

export { run_board_sound_keypad }
