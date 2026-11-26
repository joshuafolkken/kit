import type { BoardStore } from './run-board-fold-store'
import type { KeyInput } from './run-board-keys'
import { run_board_option, type OptionSpec } from './run-board-option'
import { run_board_sound_typing, type TypingSound } from './run-board-sound-typing'
import type { BoardPorts } from './run-board-state'
import type { Theme } from './run-board-theme'
import { run_board_theme_sound } from './run-board-theme-sound'

// joshuafolkken/kit#8915: `--sound on|off` sets one launch's sound — a board run where nobody sees it
// (a pty a measurement records) launches it off. It never reads or writes the saved switch
// (`board.json`'s `sound`), so the next launch without the flag keeps the person's own.

type SoundName = 'on' | 'off'

interface SoundChoice {
	// `undefined` where no flag is given: the saved switch, as before.
	is_on: boolean | undefined
	argv: Array<string>
}

const SOUND_OPTION: OptionSpec<SoundName> = {
	flag: '--sound',
	noun: 'sound',
	names: ['on', 'off'],
}

// The launch's sound and the arguments left without its flag; undefined where the flag names neither
// `on` nor `off`, or nothing — refused with the usage, as a bad `--theme` is.
function split(argv: ReadonlyArray<string>): SoundChoice | undefined {
	// The spec names no variable, so the flag alone sets it.
	const chosen = run_board_option.choose(argv, process.env, SOUND_OPTION)

	if (chosen === undefined) return undefined
	const is_on = chosen.name === undefined ? undefined : chosen.name === 'on'

	return { is_on, argv: chosen.argv }
}

// The trill in the theme row's voice at its letter pace (joshuafolkken/kit#8365) — the four works the
// demo added in the wargames teletype's (joshuafolkken/kit#8917); a board in no theme keeps the default,
// which no draw sounds (`run-board-live.ts` → `trill_of`).
function typing_sound_of(theme: Theme | undefined): TypingSound {
	if (theme === undefined) return run_board_sound_typing.typing_sound()

	return run_board_sound_typing.typing_sound(
		run_board_sound_typing.voiced(run_board_theme_sound.voice_of(theme)),
	)
}

// The saved switch held at the launch's sound: `s` still flips it on the board, but neither the
// launch reads the saved one nor a flip saves; the folds pass through.
function held(store: KeyInput['store'], is_on: boolean): BoardStore {
	return {
		load: () => store?.load() ?? new Set(),
		save: (folded) => store?.save(folded),
		load_sound: () => is_on,
		save_sound: () => {
			// The launch's sound is never saved.
		},
	}
}

// The ports under the launch's sound: none given → as they are; `off` also drops the cue player and
// the trill, so even an `s` flip mid-board starts no sound.
function sounded(ports: BoardPorts, is_on: boolean | undefined): BoardPorts {
	if (is_on === undefined) return ports
	const keys = ports.keys && { ...ports.keys, store: held(ports.keys.store, is_on) }

	if (is_on) return { ...ports, keys }

	return { ...ports, keys, cue: undefined, typing_sound: undefined }
}

const run_board_sound_option = { split, sounded, typing_sound_of }

export { run_board_sound_option }
