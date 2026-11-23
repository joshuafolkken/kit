import { run_board_beat_pace, type Join, type Schedule } from './run-board-beat-pace'
import { run_board_jump_screen } from './run-board-jump-screen'
import type { KeyReading } from './run-board-keys'
import { run_board_labels, type Paint } from './run-board-labels'
import type { Random } from './run-board-rain'
import { run_board_reveal_blocks, type Beat } from './run-board-reveal-blocks'
import { run_board_reveal_rain } from './run-board-reveal-rain'
import { run_board_screen } from './run-board-screen'
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

// The rain's random source, and whether stdout draws its colors; a test pins both.
interface RainSource {
	random: Random
	is_colored: () => boolean
}

type IntroPorts = Pick<
	BoardPorts,
	'icons' | 'intro_sleep' | 'intro_now' | 'write' | 'write_drawn' | 'typing_sound' | 'size'
> & {
	rain?: RainSource
}
type Reveal = (frame: string) => Promise<void>

// joshuafolkken/kit#8519: the themes whose first frame is revealed behind the code rain.
const RAIN_THEMES: ReadonlySet<Theme> = new Set<Theme>(['matrix'])
// joshuafolkken/kit#8677: the themes whose first frame arrives out of the time jump.
const ARRIVE_THEMES: ReadonlySet<Theme> = new Set<Theme>(['bttf'])
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

// The key that skips the beats: pressed once it comes, released once they end.
interface Skip {
	pressed: Promise<undefined>
	is_pressed: () => boolean
	release: () => void
}

// The beats played, as they are due (`run-board-beat-pace.ts`), and how a late one is carried.
interface Playback {
	beats: Iterator<Beat>
	skip: Skip
	schedule: Schedule
	join: Join
}

function taken(beats: Iterator<Beat>): Beat | undefined {
	const beat = beats.next()

	return beat.done === true ? undefined : beat.value
}

type PausedPorts = IntroPorts & { intro_sleep: (ms: number) => Promise<void> }

// The beat, joined after what is carried, written, then what is left of its pause raced against the
// skip; one already past its end is not written but carried into the next write. What is carried next.
async function written(
	beat: Beat,
	playback: Playback,
	ports: PausedPorts,
	carried: string,
): Promise<string> {
	const { schedule, join, skip } = playback
	const end = schedule.end(beat.ms)
	const text = join(carried, beat.text)

	if (schedule.left(end) < 0) return text
	ports.write(text)
	const left = Math.max(0, schedule.left(end))

	await Promise.race([ports.intro_sleep(left), skip.pressed])

	return ''
}

// Each beat taken and written as it is due, and what is carried when the beats end written then. A skip
// takes no further beat, so the beats left unwritten stay in `beats` — made one at a time, a skip makes
// no more.
async function beat_through(playback: Playback, ports: PausedPorts, carried = ''): Promise<void> {
	const beat = playback.skip.is_pressed() ? undefined : taken(playback.beats)

	if (beat !== undefined) {
		await beat_through(playback, ports, await written(beat, playback, ports, carried))
	} else if (carried !== '') {
		ports.write(carried)
	}
}

// The key listened for, which goes back to folding once released.
function skipper(keys: KeyReading): Skip {
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

	return { pressed, is_pressed: () => held.is_pressed, release: () => held.release?.() }
}

// Beats played only where the ports carry their pauses, the beats left unwritten left in `beats`; the
// key listened for goes back to folding once they end. A late beat is carried as `join` says — a
// whole rewrite by default. Whether all of them played, no key skipping them.
async function listen(
	beats: Iterator<Beat>,
	ports: IntroPorts,
	keys: KeyReading,
	join: Join = run_board_beat_pace.rewritten,
): Promise<boolean> {
	const { intro_sleep } = ports
	if (intro_sleep === undefined) return false
	const skip = skipper(keys)
	const schedule = run_board_beat_pace.scheduled(ports.intro_now)

	try {
		await beat_through({ beats, skip, schedule, join }, { ...ports, intro_sleep })
	} finally {
		skip.release()
	}

	return !skip.is_pressed()
}

// Letters typed with the trill sounding (joshuafolkken/kit#8250), which stops however they end — typed
// through or skipped by a key, and whether they typed through. Where the ports carry no pauses nothing
// types, so no trill starts.
async function letters(
	beats: ReadonlyArray<Beat>,
	ports: IntroPorts,
	keys: KeyReading,
): Promise<boolean> {
	const trill = ports.intro_sleep === undefined ? undefined : ports.typing_sound

	trill?.set(true)

	try {
		return await listen(beats.values(), ports, keys)
	} finally {
		trill?.set(false)
	}
}

// The line rewritten as `text` in `paint`; no text erases it.
function shown(paint: Paint | undefined, text: string): string {
	return `${LINE_START}${run_board_labels.painted(paint, text)}${ERASE_LINE_END}`
}

// The lead lines' pace and look: the theme's letter pause and its leads.
interface LeadPace {
	letter_ms: number
	leads: IntroLeads
}

// joshuafolkken/kit#8441: a lead line typed a letter at a time with the cursor after every letter, as
// the approved demo draws it.
function lead_letters(line: string, { letter_ms, leads }: LeadPace): Array<Beat> {
	return Array.from(line, (_letter, index) => ({
		text: shown(leads.paint, `${line.slice(0, index + 1)}${run_board_typing.CURSOR}`),
		ms: letter_ms,
	}))
}

// A typed lead line held with the cursor, then erased and followed by its gap.
function lead_rest(leads: IntroLeads): Array<Beat> {
	return [
		{ text: '', ms: leads.hold_ms },
		{ text: shown(undefined, ''), ms: leads.gap_ms },
	]
}

// The lead lines in turn, each one's letters with the trill sounding (joshuafolkken/kit#8365) and its
// hold and gap silent; whether all of them played, no key ending them.
async function leads_played(
	lines: ReadonlyArray<string>,
	ports: IntroPorts,
	keys: KeyReading,
	pace: LeadPace,
): Promise<boolean> {
	const [lead, ...rest] = lines
	if (lead === undefined) return true

	if (
		!(await letters(lead_letters(lead, pace), ports, keys)) ||
		!(await listen(lead_rest(pace.leads).values(), ports, keys))
	) {
		return false
	}

	return await leads_played(rest, ports, keys, pace)
}

// The lead lines, then the theme's line shown at once and held; a key ends the whole of it. Where
// stdout draws no color nothing plays.
async function lead_in(
	ports: IntroPorts,
	keys: KeyReading,
	intro: IntroDefinition,
	leads: IntroLeads,
): Promise<void> {
	const line = shown(leads.paint, intro.line)

	if (line === shown(undefined, intro.line)) return
	const is_played = await leads_played(leads.lines, ports, keys, {
		letter_ms: intro.letter_ms,
		leads,
	})

	if (is_played) await listen([{ text: line, ms: intro.hold_ms }].values(), ports, keys)
}

// The theme's letters, then its typed-end sound once (joshuafolkken/kit#8697) and its hold, silent,
// unless a key skipped the letters.
async function type_in(ports: IntroPorts, keys: KeyReading, intro: IntroDefinition): Promise<void> {
	const is_typed = await letters(letter_beats(intro), ports, keys)

	if (!is_typed) return
	ports.typing_sound?.typed?.()
	await listen([{ text: '', ms: intro.hold_ms }].values(), ports, keys)
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
	const lines = run_board_theme.marked(theme, frame, ports.icons).split('\n')
	const beats = lines.flatMap((line, index) => line_beats(line, index)).values()

	await listen(beats, { ...ports, write }, keys, run_board_beat_pace.appended)
	const rest = [...beats]

	if (rest.length > 0) write(rest.map((beat) => beat.text).join(''))
}

// The beats a first frame, as the theme draws it, is revealed behind.
type BeatsOf = (drawn: string, ports: IntroPorts, random: Random) => Iterator<Beat>

// The first frame, as the theme draws it, revealed behind `cover`'s beats, then written whole as
// every later frame is drawn, in one synchronized write (joshuafolkken/kit#8732) — at once where a key
// skips the beats, where the ports carry no pauses, or where stdout draws no color.
function behind(cover: BeatsOf): typeof reveal {
	return async (frame, ports, keys, theme) => {
		const write = ports.write_drawn ?? ports.write
		const drawn = run_board_theme.restyle(theme, frame, ports.icons)
		const { random, is_colored } = ports.rain ?? LIVE_RAIN

		if (is_colored()) await listen(cover(drawn, ports, random), { ...ports, write }, keys)
		write(run_board_screen.synced(drawn))
	}
}

// joshuafolkken/kit#8519: the first frame revealed behind one pass of the code rain
// (`run-board-reveal-rain.ts`).
const rain = behind((drawn, ports, random) =>
	run_board_reveal_rain.beats_of(drawn, random, { size: ports.size?.() }),
)

// joshuafolkken/kit#8677: the bttf first frame arriving out of the time jump — black, three flashes,
// then the thaw (`run-board-jump-screen.ts`).
const arrive = behind((drawn, ports) => run_board_jump_screen.arrive_beats(drawn, ports.size?.()))

// The theme's own reveal: behind the rain, arriving out of the jump, or a block at a time.
function revealer(theme: Theme): typeof reveal {
	if (RAIN_THEMES.has(theme)) return rain

	return ARRIVE_THEMES.has(theme) ? arrive : reveal
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
	ARRIVE_THEMES,
	ERASE_LINE_END,
	LINE_START,
	LIVE_RAIN,
	RAIN_THEMES,
	REVEAL_LINE_MS,
	after,
	arrive,
	listen,
	opening,
	play,
	rain,
	reveal,
}

export { run_board_intro }
export type { IntroPorts, Reveal }
