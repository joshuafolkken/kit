import type { KeyReading } from './run-board-keys'
import { run_board_labels, type Paint } from './run-board-labels'
import { run_board_reveal_blocks, type Beat } from './run-board-reveal-blocks'
import type { BoardPorts, Pace } from './run-board-state'
import { run_board_theme, type Theme } from './run-board-theme'
import { run_board_theme_defs, type IntroDefinition, type IntroLeads } from './run-board-theme-defs'
import { run_board_typing } from './run-board-typing'

// The line a live board in a theme types before its first frame, a letter at a time with a block cursor after
// the last letter typed, then holds without the cursor — the first frame's read runs meanwhile, and the
// frame is drawn over the line once both are done. A theme with lead lines types and erases each first,
// then shows its line at once (joshuafolkken/kit#8441). A key skips the rest; the key is spent on the
// skip, not on a fold. Each beat rewrites the whole line, so the screen always matches the beat last
// written.

const { LINE_MS: REVEAL_LINE_MS, beats_of } = run_board_reveal_blocks
const LINE_START = '\r'
const ERASE_LINE_END = '\u{1B}[K'

type IntroPorts = Pick<BoardPorts, 'intro_sleep' | 'write' | 'write_drawn' | 'typing_sound'>
type Reveal = (frame: string) => Promise<void>

// The theme's line typed a letter at a time (joshuafolkken/kit#8349: the line and its pauses are the
// theme's row).
function letter_beats({ line, letter_ms }: IntroDefinition): ReadonlyArray<Beat> {
	return Array.from(line, (_letter, index) => ({
		text: `${LINE_START}${run_board_typing.typed(line, line.slice(0, index + 1))}${ERASE_LINE_END}`,
		ms: letter_ms,
	}))
}

// Each beat written, then its pause raced against the skip; a skip writes no further beat, and the
// beats left unwritten are handed back.
async function beat_through(
	beats: ReadonlyArray<Beat>,
	ports: IntroPorts & { intro_sleep: (ms: number) => Promise<void> },
	skip: { pressed: Promise<undefined>; is_pressed: () => boolean },
): Promise<ReadonlyArray<Beat>> {
	const [beat, ...rest] = beats
	if (beat === undefined || skip.is_pressed()) return beats

	ports.write(beat.text)
	await Promise.race([ports.intro_sleep(beat.ms), skip.pressed])

	return await beat_through(rest, ports, skip)
}

// Beats played only where the ports carry their pauses, the beats left unwritten handed back; the key
// listened for goes back to folding once they end.
async function listen(
	beats: ReadonlyArray<Beat>,
	ports: IntroPorts,
	keys: KeyReading,
): Promise<ReadonlyArray<Beat>> {
	const { intro_sleep } = ports
	if (intro_sleep === undefined) return beats

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
		return await beat_through(beats, { ...ports, intro_sleep }, skip)
	} finally {
		held.release?.()
	}
}

// The letters typed with the trill sounding (joshuafolkken/kit#8250), which stops however they end —
// typed through or skipped by a key. Where the ports carry no pauses nothing types, so no trill starts.
async function letters(
	ports: IntroPorts,
	keys: KeyReading,
	intro: IntroDefinition,
): Promise<ReadonlyArray<Beat>> {
	const trill = ports.intro_sleep === undefined ? undefined : ports.typing_sound

	trill?.set(true)

	try {
		return await listen(letter_beats(intro), ports, keys)
	} finally {
		trill?.set(false)
	}
}

// The line rewritten as `text` in `paint`; no text erases it.
function shown(paint: Paint | undefined, text: string): string {
	return `${LINE_START}${run_board_labels.painted(paint, text)}${ERASE_LINE_END}`
}

// joshuafolkken/kit#8441: a lead line typed a letter at a time with the cursor after every letter, as
// the approved demo draws it, held with the cursor, then erased and followed by its gap.
function lead_beats(line: string, letter_ms: number, leads: IntroLeads): Array<Beat> {
	const typing = Array.from(line, (_letter, index) => ({
		text: shown(leads.paint, `${line.slice(0, index + 1)}${run_board_typing.CURSOR}`),
		ms: letter_ms,
	}))

	return [
		...typing,
		{ text: '', ms: leads.hold_ms },
		{ text: shown(undefined, ''), ms: leads.gap_ms },
	]
}

// The lead lines, then the theme's line shown at once and held; a key ends the whole of it. No trill
// sounds, and where stdout draws no color nothing plays.
async function lead_in(
	ports: IntroPorts,
	keys: KeyReading,
	intro: IntroDefinition,
	leads: IntroLeads,
): Promise<void> {
	const line = shown(leads.paint, intro.line)

	if (line === shown(undefined, intro.line)) return
	const typed = leads.lines.flatMap((lead) => lead_beats(lead, intro.letter_ms, leads))

	await listen([...typed, { text: line, ms: intro.hold_ms }], ports, keys)
}

// The theme's letters, then its hold, silent, unless a key skipped the letters.
async function type_in(ports: IntroPorts, keys: KeyReading, intro: IntroDefinition): Promise<void> {
	const rest = await letters(ports, keys, intro)

	if (rest.length === 0) await listen([{ text: '', ms: intro.hold_ms }], ports, keys)
}

// The theme's lead lines where it has them (joshuafolkken/kit#8441), else its typed line.
async function play(ports: IntroPorts, keys: KeyReading, theme: Theme): Promise<void> {
	const { intro }: { intro: IntroDefinition } = run_board_theme_defs.THEME_DEFS[theme]

	await (intro.leads === undefined
		? type_in(ports, keys, intro)
		: lead_in(ports, keys, intro, intro.leads))
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
	const beats = lines.flatMap((line, index) => line_beats(line, index))
	const rest = await listen(beats, { ...ports, write }, keys)

	if (rest.length > 0) write(rest.map((beat) => beat.text).join(''))
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

// A board in a theme types its line, its first read held behind it, and reveals its first frame a block at
// a time; one in none plays nothing, reads at once and draws the frame whole. Called once the screen is
// entered, since the line starts typing here.
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
			await reveal(frame, ports, keys, theme)
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
	reveal,
}

export { run_board_intro }
export type { IntroPorts, Reveal }
