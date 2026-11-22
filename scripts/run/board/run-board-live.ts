import { poll } from '#scripts/lib/poll'
import { run_board_exit_rain } from './run-board-exit-rain'
import { run_board_fold } from './run-board-fold'
import { run_board_header } from './run-board-header'
import { run_board_intro, type Reveal } from './run-board-intro'
import { run_board_keys, type KeyReading } from './run-board-keys'
import { run_board_labels } from './run-board-labels'
import { run_board_screen, type Screen } from './run-board-screen'
import type { TypingSound } from './run-board-sound-typing'
import { run_board_spin } from './run-board-spin'
import type { BoardPorts, BoardState } from './run-board-state'
import { run_board_theme, type Theme } from './run-board-theme'
import { run_board_theme_defs, type LiveDefinition } from './run-board-theme-defs'
import { run_board_tick } from './run-board-tick'

// The live `josh run:board` loop: the alternate screen entered and left, the first frame drawn (or
// revealed), and a frame redrawn on every second with its spinners turned between. `run-board-cli.ts`
// chooses the board and hands a live one here.

const TRAILING_NEWLINE = /\n$/u
const REDRAW_WORD = 'redraw'
const { FRESH_STATE, tick } = run_board_tick
const { WORDS } = run_board_labels
const { live_of } = run_board_theme_defs
const { gated, quitter } = run_board_exit_rain
const SCREEN = run_board_screen.screen_of('live')

// How a frame reaches the screen: the bytes put around its text, and where they are written.
interface Framing {
	wrap: (text: string) => string
	sink: (bytes: string) => void
}

// The text of the last frame drawn, none before the first.
interface LastFrame {
	text: string | undefined
}

type Step = (state: BoardState) => Promise<BoardState>

// Told of a tick that threw.
type Failed = (cause: unknown) => void

// What the redraws start from: the first frame's reveal, where the last frame drawn is kept for the
// failure warning and the exit wipe, and who is told of a failed tick.
interface Start {
	reveal: Reveal | undefined
	last: LastFrame
	failed?: Failed | undefined
}

// Every frame starts from the top of the alternate screen, erasing what the last one left below it, and
// ends on the line that says closing the screen leaves the run going — only a screen a person can
// close says it, and it is the first line to give way to a short pane. Nothing follows the last line,
// so a frame that fills the pane never scrolls the header off the top.
// The keys are named under it where a person can type them.
function framed(ports: BoardPorts, framing: Framing): BoardPorts {
	const keys = ports.folded === undefined ? [] : [run_board_fold.KEYS_LINE]

	return {
		...ports,
		footer: ['', WORDS.keeps_running, ...keys],
		write: (frame) => {
			framing.sink(framing.wrap(frame.replace(TRAILING_NEWLINE, '')))
		},
	}
}

// A redrawn frame: the theme restyles the board's own lines, then the screen's control bytes go in
// front of them and the whole is written past the theme, so no line the theme reads starts with an
// erase (joshuafolkken/kit#8401).
function on_screen(ports: BoardPorts, screen: Screen): Framing {
	const { icons, theme } = ports

	return {
		wrap: (text) => screen.frame(run_board_theme.restyle(theme, text, icons)),
		sink: ports.write_drawn ?? ports.write,
	}
}

// Leaves the alternate screen once, whichever path gets there first: a second leave would restore the
// cursor saved on entering and draw over whatever was printed after the first. The terminal leaves raw
// mode with it.
function leaver(ports: BoardPorts, screen: Screen, keys: KeyReading): () => void {
	let has_left = false

	return () => {
		if (has_left) return
		has_left = true
		keys.stop?.()
		ports.typing_sound?.stop()
		ports.write(screen.leave)
	}
}

// The trill reaches the draws only where the theme sounds it, and sounds only while the sound switch is
// on (joshuafolkken/kit#8250); `stop` stays the board's, called as it leaves.
function trill_of(
	ports: BoardPorts,
	keys: KeyReading,
	live: LiveDefinition,
): TypingSound | undefined {
	const typing = ports.typing_sound

	if (typing === undefined || !live.trill) return undefined

	return {
		set: (is_on, left_ms) => {
			typing.set(is_on && (keys.sound?.() ?? true), left_ms)
		},
		stop: typing.stop,
	}
}

// A tick whose frame is held off the screen, then revealed before it returns, so no spinner turns until
// every line is out. The held frame is left unstyled: the reveal restyles it once, keeping the marks it
// types the title by.
async function revealed_tick(
	state: BoardState,
	ports: BoardPorts,
	wrap: (text: string) => string,
	reveal: Reveal,
): Promise<BoardState> {
	const held: Array<string> = []
	const holding = framed(ports, {
		wrap,
		sink: (frame) => {
			held.push(frame)
		},
	})
	const next = await tick(state, holding, 'background')

	await reveal(held.join(''))

	return next
}

// The last frame's text a framing wrapped, kept to draw again over a failed tick.
function remembered(framing: Framing, last: LastFrame): Framing {
	return {
		wrap: (text) => {
			last.text = text

			return framing.wrap(text)
		},
		sink: framing.sink,
	}
}

// The last frame with its last line — the footer's, the first to give way to a short pane — given to
// the warning, so the frame keeps its height and never scrolls.
function warned(text: string, warning: string): string {
	return [...text.split('\n').slice(0, -1), warning].join('\n')
}

// The first line of what a failure says.
function reason_of(error: unknown): string {
	const [first = ''] = (error instanceof Error ? error.message : String(error)).split('\n', 1)

	return first
}

// A failed tick is told to `failed` (`run-board-exit-record.ts`), and the last frame drawn is drawn
// again with the failure said as a failed read is (`run-board-header.ts`), until a tick draws again.
function on_failure(ports: BoardPorts, framing: Framing, last: LastFrame, failed?: Failed): Failed {
	return (error) => {
		failed?.(error)
		if (last.text === undefined) return
		const warning = run_board_header.warning_of(REDRAW_WORD, ports.now(), reason_of(error))

		framing.sink(framing.wrap(warned(last.text, warning ?? '')))
	}
}

// A tick that throws is survived (joshuafolkken/kit#8381): `fail` is told, and the state before it is
// kept, so the board goes on to the next second with its spinners where they were.
function surviving(step: Step, fail: Failed): Step {
	return async (state) => {
		try {
			return await step(state)
		} catch (error) {
			fail(error)

			return state
		}
	}
}

// A tick drawing each frame, the plan read in the background so the first is drawn without waiting on
// GitHub. Where the board reveals, the first frame is revealed; every later one is written as drawn.
function ticker(ports: BoardPorts, screen: Screen, start: Start): Step {
	const { last, failed } = start
	let opening = start.reveal
	const framing = on_screen(ports, screen)
	const drawing = framed(ports, remembered(framing, last))
	// The revealed frame is kept too, so a board closed before its second frame has one to wipe.
	const held_wrap = remembered({ wrap: screen.held, sink: framing.sink }, last).wrap

	return surviving(
		async (state) => {
			const revealing = opening

			opening = undefined

			if (revealing === undefined) return await tick(state, drawing, 'background')

			return await revealed_tick(state, ports, held_wrap, revealing)
		},
		on_failure(ports, framing, last, failed),
	)
}

// A frame on the second, its spinners turned until the next: the turns are
// written past the frame's own control bytes, each to its spot on the screen the frame drew. The frames
// `--chat` and `--once` answer from are recorded on the worker thread (`run-board-gather-record.ts`),
// so this thread only draws. Each stage is marked as it is entered, for `--timing`'s stalls.
async function redraw_forever(ports: BoardPorts, screen: Screen, start: Start): Promise<void> {
	const step = ticker(ports, screen, start)
	let state = FRESH_STATE

	await poll.wait_for(
		async () => {
			ports.enter_stage?.('redraw')
			// eslint-disable-next-line require-atomic-updates -- poll awaits each callback before starting the next tick
			state = await step(state)
		},
		{
			interval_ms: run_board_spin.REDRAW_MS,
			sleeper: async () => {
				ports.enter_stage?.('turn')
				await run_board_spin.spin_to_second(state, ports)
			},
		},
	)
}

// The ports the live board draws through: the folds, the sound switch and the cue it gates read off the
// keys, and, where the theme's definition chooses them, the rows typed and the trill sounded while they
// type.
function live_ports(ports: BoardPorts, keys: KeyReading, live: LiveDefinition): BoardPorts {
	return {
		...ports,
		folded: keys.folded,
		sound: keys.sound,
		cue: keys.cue ?? ports.cue,
		types_rows: live.types_rows,
		typing_sound: trill_of(ports, keys, live),
	}
}

// The keys read with Ctrl-C's first press wiping the last frame drawn (`run-board-exit-rain.ts`), and
// the ports the redraws write through, shut once the wipe begins, and where the last frame is kept.
function exiting(
	ports: BoardPorts,
	theme: Theme | undefined,
): { keys: KeyReading; drawn: BoardPorts; last: LastFrame } {
	const last: LastFrame = { text: undefined }
	const exit = run_board_exit_rain.exit_of()
	const keys = run_board_keys.read_keys(quitter(ports.keys, exit), {
		cue: ports.cue,
		trill: ports.typing_sound,
	})

	exit.wipe = async () => {
		await run_board_exit_rain.wipe(last.text, ports, keys, theme)
	}

	return { keys, drawn: gated(ports, exit.gate), last }
}

// A signal leaves through `on_exit`; a failure outside the redraws leaves before its error is printed, so
// the error lands on the normal screen rather than vanishing with the alternate one, and a failed redraw
// is told to `failed` and drawn on past (`surviving`). Only a board in a theme types
// its opening line, reveals its first frame a block at a time and types each row that appears after it;
// one in none draws it whole at once. The board arrives without its theme and is themed here, where
// each frame is restyled before its screen control bytes are added (`on_screen`).
// Ctrl-C's first press wipes the last frame where the theme rains (`exiting`).
async function watch(board: BoardPorts, theme: Theme | undefined, failed?: Failed): Promise<void> {
	const ports = run_board_theme.themed(board, theme)
	const { keys, drawn, last } = exiting(ports, theme)
	const leave = leaver(ports, SCREEN, keys)
	const live = live_ports(drawn, keys, live_of(theme))

	ports.write(SCREEN.enter)
	ports.on_exit(leave)
	const { gather, reveal } = run_board_intro.opening(ports.gather, live, keys, theme)

	try {
		await redraw_forever({ ...live, gather, opened_ms: ports.now() }, SCREEN, {
			reveal,
			last,
			failed,
		})
	} finally {
		leave()
	}
}

const run_board_live = { live_of, trill_of, watch }

export { run_board_live }
