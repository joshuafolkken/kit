import type { KeyReading } from './run-board-keys'
import type { Random } from './run-board-rain'
import { run_board_reveal_blocks, type Beat } from './run-board-reveal-blocks'
import { run_board_reveal_rain } from './run-board-reveal-rain'
import type { BoardPorts, Pace } from './run-board-state'
import { run_board_theme, type Theme } from './run-board-theme'
import { run_board_theme_defs, type IntroDefinition } from './run-board-theme-defs'
import { run_board_typing } from './run-board-typing'

// The line a live board in a theme types before its first frame, a letter at a time with a block cursor after
// the last letter typed, then holds without the cursor — the first frame's read runs meanwhile, and the
// frame is drawn over the line once both are done. A key skips the rest; the key is spent on the skip,
// not on a fold. Each beat rewrites the whole line, so the screen always matches the beat last written.

const { LINE_MS: REVEAL_LINE_MS, beats_of } = run_board_reveal_blocks
const LINE_START = '\r'
const ERASE_LINE_END = '\u{1B}[K'

// The rain's random source, and whether stdout draws its colors; a test pins both.
interface RainSource {
	random: Random
	is_colored: () => boolean
}

type IntroPorts = Pick<BoardPorts, 'intro_sleep' | 'write' | 'write_drawn' | 'typing_sound'> & {
	rain?: RainSource
}
type Reveal = (frame: string) => Promise<void>

// joshuafolkken/kit#8519: the themes whose first frame is revealed behind the code rain.
const RAIN_THEMES: ReadonlySet<Theme> = new Set<Theme>(['matrix'])
const LIVE_RAIN: RainSource = {
	random: Math.random,
	is_colored: run_board_reveal_rain.is_colored,
}

// The theme's line typed a letter at a time (joshuafolkken/kit#8349: the line and its pauses are the
// theme's row).
function letter_beats({ line, letter_ms }: IntroDefinition): ReadonlyArray<Beat> {
	return Array.from(line, (_letter, index) => ({
		text: `${LINE_START}${run_board_typing.typed(line, line.slice(0, index + 1))}${ERASE_LINE_END}`,
		ms: letter_ms,
	}))
}

// Each beat taken and written, then its pause raced against the skip; a skip takes no further beat,
// so the beats left unwritten stay in `beats` — made one at a time, a skip makes no more.
async function beat_through(
	beats: Iterator<Beat>,
	ports: IntroPorts & { intro_sleep: (ms: number) => Promise<void> },
	skip: { pressed: Promise<undefined>; is_pressed: () => boolean },
): Promise<void> {
	if (skip.is_pressed()) return
	const beat = beats.next()
	if (beat.done === true) return

	ports.write(beat.value.text)
	await Promise.race([ports.intro_sleep(beat.value.ms), skip.pressed])
	await beat_through(beats, ports, skip)
}

// Beats played only where the ports carry their pauses, the beats left unwritten left in `beats`; the
// key listened for goes back to folding once they end.
async function listen(beats: Iterator<Beat>, ports: IntroPorts, keys: KeyReading): Promise<void> {
	const { intro_sleep } = ports
	if (intro_sleep === undefined) return

	const held: { is_pressed: boolean; release: (() => void) | undefined } = {
		is_pressed: false,
		release: undefined,
	}
	const pressed = new Promise<undefined>((resolve) => {
		held.release = keys.intercept?.(() => {
			held.is_pressed = true
			resolve(undefined)
		})
	})
	const skip = { pressed, is_pressed: (): boolean => held.is_pressed }

	try {
		await beat_through(beats, { ...ports, intro_sleep }, skip)
	} finally {
		held.release?.()
	}
}

// The letters typed with the trill sounding (joshuafolkken/kit#8250), which stops however they end —
// typed through or skipped by a key, and whether they typed through. Where the ports carry no pauses
// nothing types, so no trill starts.
async function letters(
	ports: IntroPorts,
	keys: KeyReading,
	intro: IntroDefinition,
): Promise<boolean> {
	const trill = ports.intro_sleep === undefined ? undefined : ports.typing_sound
	const beats = letter_beats(intro).values()

	trill?.set(true)

	try {
		await listen(beats, ports, keys)

		return beats.next().done === true
	} finally {
		trill?.set(false)
	}
}

// The theme's letters, then its hold, silent, unless a key skipped the letters.
async function play(ports: IntroPorts, keys: KeyReading, theme: Theme): Promise<void> {
	const { intro } = run_board_theme_defs.THEME_DEFS[theme]
	const is_typed = await letters(ports, keys, intro)

	if (is_typed) await listen([{ text: '', ms: intro.hold_ms }].values(), ports, keys)
}

// A line's beats, each line after the first led by the line break before it.
function line_beats(line: string, index: number): Array<Beat> {
	const beats = beats_of(line)

	if (index === 0) return beats

	return beats.map((beat, at) => (at === 0 ? { ...beat, text: `\n${beat.text}` } : beat))
}

// joshuafolkken/kit#8224: the first frame, as the theme draws it, written from the top a line at a
// time and each line left to right a block at a time (`run-board-reveal-blocks.ts`), the line's beat
// shared out between its blocks; what a key leaves unwritten is written at once, as is the whole frame
// where the ports carry no pauses. It is drawn once, so it is written past the theme.
async function reveal(
	frame: string,
	ports: IntroPorts,
	keys: KeyReading,
	theme: Theme,
): Promise<void> {
	const write = ports.write_drawn ?? ports.write
	const lines = run_board_theme.marked(theme, frame).split('\n')
	const beats = lines.flatMap((line, index) => line_beats(line, index)).values()

	await listen(beats, { ...ports, write }, keys)
	const rest = [...beats]

	if (rest.length > 0) write(rest.map((beat) => beat.text).join(''))
}

// joshuafolkken/kit#8519: the first frame, as the theme draws it, revealed behind one pass of the code
// rain (`run-board-reveal-rain.ts`), then written whole as every later frame is drawn — at once where a
// key skips the rain, where the ports carry no pauses, or where stdout draws no color.
async function rain(
	frame: string,
	ports: IntroPorts,
	keys: KeyReading,
	theme: Theme,
): Promise<void> {
	const write = ports.write_drawn ?? ports.write
	const drawn = run_board_theme.restyle(theme, frame)
	const { random, is_colored } = ports.rain ?? LIVE_RAIN

	if (is_colored()) {
		await listen(run_board_reveal_rain.beats_of(drawn, random), { ...ports, write }, keys)
	}

	write(drawn)
}

// The theme's own reveal: behind the rain, or a block at a time.
function revealer(theme: Theme): typeof reveal {
	return RAIN_THEMES.has(theme) ? rain : reveal
}

// The first read starts at once, but returns or throws only once the intro is over, so a failed read
// never leaves the line typing over the board's exit; every later read is untouched.
function after<Read>(
	gather: (pace: Pace) => Promise<Read>,
	intro: Promise<void>,
): (pace: Pace) => Promise<Read> {
	let is_first = true

	return async (pace) => {
		if (!is_first) return await gather(pace)
		is_first = false
		const read = gather(pace)

		await Promise.allSettled([read, intro])
		await intro

		return await read
	}
}

// A board in a theme types its line, its first read held behind it, and reveals its first frame as the
// theme does; one in none plays nothing, reads at once and draws the frame whole. Called once the screen
// is entered, since the line starts typing here.
function opening<Read>(
	gather: (pace: Pace) => Promise<Read>,
	ports: IntroPorts,
	keys: KeyReading,
	theme: Theme | undefined,
): { gather: (pace: Pace) => Promise<Read>; reveal: Reveal | undefined } {
	if (theme === undefined) return { gather, reveal: undefined }

	return {
		gather: after(gather, play(ports, keys, theme)),
		reveal: async (frame) => {
			await revealer(theme)(frame, ports, keys, theme)
		},
	}
}

const run_board_intro = {
	ERASE_LINE_END,
	LINE_START,
	REVEAL_LINE_MS,
	after,
	opening,
	play,
	rain,
	reveal,
}

export { run_board_intro }
export type { IntroPorts, Reveal }
