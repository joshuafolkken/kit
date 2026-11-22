import type { TerminalSize } from './run-board-fit'
import type { Icons } from './run-board-icons'
import { run_board_intro, type IntroPorts } from './run-board-intro'
import type { KeyInput, KeyReading } from './run-board-keys'
import { run_board_rain, type RainCell, type Random } from './run-board-rain'
import type { Beat } from './run-board-reveal-blocks'
import { run_board_reveal_rain } from './run-board-reveal-rain'
import type { TypingSound } from './run-board-sound-typing'
import type { BoardPorts } from './run-board-state'
import { run_board_theme, type Theme } from './run-board-theme'

// joshuafolkken/kit#8355: the matrix board wiped by the code rain as it closes — the reveal's rain
// (`run-board-reveal-rain.ts`) run the other way, the board still shown where the rain has not reached
// and blank where it has passed, then the whole screen erased before the alternate screen is left.
// Only Ctrl-C's first press waits for it: a key ends it at once, and a second Ctrl-C or a signal leaves
// without it, so the terminal is always put back.

// Whether the board's own redraws and spinner turns still reach the screen.
interface Gate {
	is_open: boolean
}

// What Ctrl-C's first press does before it quits; `wipe` is set once the keys it listens on are read.
interface Exit {
	gate: Gate
	wipe: () => Promise<void>
}

type Write = (text: string) => void

const ESC = '\u{1B}'
const ERASE_BELOW = `${ESC}[J`
const AHEAD: RainCell = { kind: 'ahead' }
const BEHIND: RainCell = { kind: 'behind' }
const CLEARED: Beat = {
	text: `${run_board_reveal_rain.CURSOR_HOME}${ERASE_BELOW}`,
	ms: run_board_rain.RAIN_MS,
}
const { LIVE_RAIN, RAIN_THEMES } = run_board_intro

// A wipe cell as the reveal reads it: the board shows until the rain reaches it, and is gone behind it.
function wiping(cell: RainCell): RainCell {
	if (cell.kind === 'ahead') return BEHIND
	if (cell.kind === 'behind') return AHEAD

	return cell
}

// Every frame of the wipe over the terminal, in the wipe's own scene, the last the screen erased whole.
function* beats_of(frame: string, random: Random, size?: TerminalSize): Generator<Beat> {
	yield* run_board_reveal_rain.beats_of(frame, random, {
		read: wiping,
		size,
		scene: run_board_rain.WIPE,
	})
	yield CLEARED
}

// The last frame drawn as the theme drew it, where the theme rains; none elsewhere.
function drawn_of(
	frame: string | undefined,
	theme: Theme | undefined,
	icons: Icons | undefined,
): string | undefined {
	if (frame === undefined || theme === undefined || !RAIN_THEMES.has(theme)) return undefined

	return run_board_theme.restyle(theme, frame, icons)
}

// The ports writing past the theme, as the board's own frames are.
function drawing(ports: IntroPorts): IntroPorts {
	return { ...ports, write: ports.write_drawn ?? ports.write }
}

// The last frame wiped, a key ending it at once; nothing plays without a frame, a rain theme, color or
// the ports' pauses.
async function wipe(
	frame: string | undefined,
	ports: IntroPorts,
	keys: KeyReading,
	theme: Theme | undefined,
): Promise<void> {
	const drawn = drawn_of(frame, theme, ports.icons)
	const { random, is_colored } = ports.rain ?? LIVE_RAIN
	if (drawn === undefined || !is_colored()) return

	await run_board_intro.listen(beats_of(drawn, random, ports.size?.()), drawing(ports), keys)
}

// Nothing to wipe until the live board says how.
async function unset(): Promise<void> {
	await Promise.resolve()
}

function exit_of(): Exit {
	return { gate: { is_open: true }, wipe: unset }
}

function shut(write: Write, gate: Gate): Write {
	return (text) => {
		if (gate.is_open) write(text)
	}
}

// The trill silenced once the wipe begins: the spinner's next turn sets it off, rows no longer drawn.
function hushed(sound: TypingSound, gate: Gate): TypingSound {
	return {
		set: (is_on, left_ms, ended) => {
			sound.set(is_on && gate.is_open, left_ms, ended)
		},
		stop: sound.stop,
	}
}

// The board's ports with their writes dropped and their trill silenced once the wipe begins, so no
// redraw lands over it.
function gated(ports: BoardPorts, gate: Gate): BoardPorts {
	const { write_drawn, typing_sound } = ports

	return {
		...ports,
		write: shut(ports.write, gate),
		...(typing_sound !== undefined && { typing_sound: hushed(typing_sound, gate) }),
		...(write_drawn !== undefined && { write_drawn: shut(write_drawn, gate) }),
	}
}

async function quit(exit: Exit, interrupt: () => void): Promise<void> {
	exit.gate.is_open = false

	try {
		await exit.wipe()
	} finally {
		interrupt()
	}
}

// Ctrl-C's first press wipes the board and quits once the wipe ends; a second quits at once.
function quitter(input: KeyInput | undefined, exit: Exit): KeyInput | undefined {
	if (input === undefined) return undefined
	let is_quitting = false

	return {
		...input,
		interrupt: () => {
			const is_first = !is_quitting

			is_quitting = true
			if (is_first) void quit(exit, input.interrupt)
			else input.interrupt()
		},
	}
}

const run_board_exit_rain = { beats_of, exit_of, gated, quitter, wipe }

export { run_board_exit_rain }
