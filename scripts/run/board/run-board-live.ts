import { poll } from '#scripts/lib/poll'
import { run_board_fold } from './run-board-fold'
import { run_board_frame_loop, type FrameScreen } from './run-board-frame-loop'
import { run_board_header } from './run-board-header'
import { run_board_icons } from './run-board-icons'
import { run_board_keys, type KeyReading } from './run-board-keys'
import { run_board_labels } from './run-board-labels'
import { run_board_live_sound, type Shown } from './run-board-live-sound'
import { run_board_paint } from './run-board-paint'
import { run_board_repaint } from './run-board-repaint'
import { run_board_screen, type Joint, type Screen } from './run-board-screen'
import type { TypingSound } from './run-board-sound-typing'
import { run_board_spin } from './run-board-spin'
import type { BoardPorts, BoardState } from './run-board-state'
import { run_board_theme, type Theme } from './run-board-theme'
import { run_board_theme_demo_sound } from './run-board-theme-demo-sound'
import { run_board_theme_keys } from './run-board-theme-keys'
import { run_board_theme_registry } from './run-board-theme-registry'
import { run_board_theme_run, type ThemeRun } from './run-board-theme-run'
import { run_board_theme_sound } from './run-board-theme-sound'
import { run_board_tick } from './run-board-tick'
import { run_board_tick_draw } from './run-board-tick-draw'
import { run_board_type_rows, type Typing } from './run-board-type-rows'

// The live `josh run:board` loop: the alternate screen entered and left, and a frame redrawn on every
// second with its spinners turned between. `run-board-cli.ts` chooses the board and hands a live one
// here. A board in a theme is drawn by the theme host (joshuafolkken/kit#8917): its run opens and closes
// it with the theme's own opening and ending, and a terminal without 24-bit color draws the board in no
// theme instead.

const TRAILING_NEWLINE = /\n$/u
const REDRAW_WORD = 'redraw'
const { FRESH_STATE, tick } = run_board_tick
const { WORDS } = run_board_labels
const { is_sounding, scored, switched_end, typed_end_of, warm } = run_board_live_sound
const SCREEN = run_board_screen.screen_of('live')
// The theme a board launched in none draws its base look as, once demo mode switches it to a work: every
// work reads the same base look back (`run-board-theme-defs.ts` → `BASE_LOOK`).
const BASE_THEME: Theme = 'wopr'

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

// What the redraws start from: where the last frame drawn is kept for the failure warning, who is told
// of a failed tick, and the typing the rows start from.
interface Start {
	last: LastFrame
	failed?: Failed | undefined
	typing: Typing
}

// The ports a second is drawn through: the themed ones, and — where a theme run can show no theme, as
// demo mode's `0` does (Issue 4-4) — the board's own in no theme, its base palette following the theme
// shown.
interface Looks {
	themed: BoardPorts
	plain: BoardPorts
}

// Where each look's frames are written, so a failure is drawn in the look its second shows.
interface Framings {
	themed: Framing
	plain: Framing
}

// The frame loop writes only the cells that changed from what it drew last (#8826), the first frame
// from the top of the alternate screen; it ends on the line that says closing the screen leaves the
// run going — only a screen a person can close says it, and it gives way first to a short pane.
// Nothing follows the last line, so a frame that fills the pane never scrolls the header off the top.
// The keys are named under it where a person can type them. What the tick would write over its frame
// is left to the frame loop's layers, so the terminal gets one write per frame (joshuafolkken/kit#8826).
function framed(ports: BoardPorts, framing: Framing): BoardPorts {
	const keys = ports.folded === undefined ? [] : [run_board_fold.KEYS_LINE]

	return {
		...ports,
		footer: ['', WORDS.keeps_running, ...keys],
		write: (frame) => {
			framing.sink(framing.wrap(frame.replace(TRAILING_NEWLINE, '')))
		},
		write_drawn: () => {
			// drawn by the frame loop's layers
		},
	}
}

// A redrawn frame: the theme restyles the board's own lines, then the screen's control bytes go in
// front of them, so no line the theme reads starts with an erase (joshuafolkken/kit#8401). The whole is
// the base the next frames draw on (joshuafolkken/kit#8826), written by the first of them.
function on_screen(ports: BoardPorts, screen: Screen, frame_screen: FrameScreen): Framing {
	const { icons, theme } = ports

	return {
		wrap: (text) => screen.frame(run_board_theme.restyle(theme, text, icons)),
		sink: (bytes) => {
			run_board_frame_loop.set_base(frame_screen, bytes)
		},
	}
}

// Leaves the alternate screen once, whichever path gets there first: a second leave would restore the
// cursor saved on entering and draw over whatever was printed after the first. The terminal leaves raw
// mode with it, and whatever the joint still holds is written before it.
function leaver(ports: BoardPorts, screen: Screen, keys: KeyReading, joint: Joint): () => void {
	let has_left = false

	return () => {
		if (has_left) return
		has_left = true
		// Every player the board started ends with it: a detached one plays on otherwise (joshuafolkken/kit#8917),
		// even where a step fails, and the terminal takes what is left at once (joshuafolkken/kit#9027).
		run_board_live_sound.leave_with(ports.typing_sound, [
			() => keys.stop?.(),
			() => {
				ports.settle?.()
				joint.flush()
			},
			() => {
				ports.write(screen.leave)
			},
		])
	}
}

// The board themed, its writes through a joint (`run_board_screen.jointed`).
function themed_joint(
	board: BoardPorts,
	theme: Theme | undefined,
): { ports: BoardPorts; joint: Joint } {
	const joint = run_board_screen.joint_of(board.write)

	return { ports: run_board_theme.themed(run_board_screen.jointed(board, joint), theme), joint }
}

// The theme a theme run shows this moment, none while it shows none; no reader without a run.
function shown_of(run: ThemeRun | undefined): Shown | undefined {
	if (run === undefined) return undefined

	return () => (run.value === '' ? undefined : run.value)
}

// The theme `shown` names, the trill put in its voice each time it changes (Issue 4-4: demo mode's
// switch), so the trill sounds the theme on screen, not the one launched.
function voicer(typing: TypingSound, shown: Shown): Shown {
	const voice = { theme: shown() }

	return () => {
		const theme = shown()

		if (theme !== undefined && theme !== voice.theme) {
			typing.revoice?.(run_board_theme_sound.voice_of(theme))
			warm(theme)
			voice.theme = theme
		}

		return theme
	}
}

// The trill reaches the draws only of a board a theme run draws, sounds only while a theme is shown and
// the sound switch is on (joshuafolkken/kit#8250), and in the shown theme's voice; `stop` stays the
// board's, called as it leaves. `typed_end` sounds, under the same switch, as the opening's line types
// through (joshuafolkken/kit#8697); an event's and a part's own sounds, the typed end of a ROW or a
// PROGRESS among them, sound from the shown theme's score (joshuafolkken/kit#8917).
function trill_of(
	ports: Pick<BoardPorts, 'typing_sound'>,
	keys: KeyReading,
	shown: Shown | undefined,
	typed_end?: () => void,
): TypingSound | undefined {
	const typing = ports.typing_sound

	if (typing === undefined || shown === undefined) return undefined

	const typed = switched_end(keys, typed_end)
	const voiced = voicer(typing, shown)

	run_board_live_sound.heard(typing)
	warm(shown())

	return {
		set: (is_on, left_ms) => {
			const is_shown = voiced() !== undefined

			typing.set(is_on && is_shown && is_sounding(keys), left_ms)
		},
		stop: typing.stop,
		typed,
		...scored(keys, shown),
	}
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

// The ports this second is drawn through: the plain ones while the theme run shows no theme, or on a
// board that draws no lamps at all — a terminal without a theme's colors — whose frame was drawn in no
// theme (`run-board-tick-draw.ts`). A folded section or a short pane keeps the theme
// (joshuafolkken/kit#8917).
function current(looks: Looks): BoardPorts {
	const run = looks.themed.theme_run

	if (run === undefined) return looks.themed
	if (!run_board_theme_run.is_drawn(run)) return looks.plain

	return run_board_tick_draw.has_lamps(looks.themed) ? looks.themed : looks.plain
}

// A failed tick is told to `failed` (`run-board-exit-record.ts`), and the last frame drawn is drawn
// again with the failure said as a failed read is (`run-board-header.ts`), until a tick draws again —
// in the look the second is drawn in, so a run showing no theme warns in none (joshuafolkken/kit#8917).
function on_failure(looks: Looks, framings: Framings, last: LastFrame, failed?: Failed): Failed {
	return (error) => {
		failed?.(error)
		if (last.text === undefined) return
		const ports = current(looks)
		const framing = ports === looks.plain ? framings.plain : framings.themed
		const warning = run_board_header.warning_of(REDRAW_WORD, ports.now(), reason_of(error))

		framing.sink(framing.wrap(warned(last.text, warning ?? '')))
	}
}

// The ports a tick draws through: a themed second's carry the plain ones its frame falls back on.
function tick_ports(looks: Looks): BoardPorts {
	const ports = current(looks)

	return ports === looks.themed && ports.theme_run !== undefined
		? { ...ports, plain_ports: looks.plain }
		: ports
}

// The ports a look draws its frames through, each frame restyled in its own theme.
function drawing_of(
	ports: BoardPorts,
	screen: Screen,
	start: Start,
	frame_screen: FrameScreen,
): BoardPorts {
	return framed(ports, remembered(on_screen(ports, screen, frame_screen), start.last))
}

// A tick drawing each frame, the plan read in the background so the first is drawn without waiting on
// GitHub, in the look the theme run shows this second.
function ticker(looks: Looks, screen: Screen, start: Start, frame_screen: FrameScreen): Step {
	const themed = drawing_of(looks.themed, screen, start, frame_screen)
	const plain = drawing_of(looks.plain, screen, start, frame_screen)
	const framings = {
		themed: on_screen(looks.themed, screen, frame_screen),
		plain: on_screen(looks.plain, screen, frame_screen),
	}

	return surviving(
		async (state) => await tick(state, tick_ports({ themed, plain }), 'background'),
		on_failure(looks, framings, start.last, start.failed),
	)
}

// A frame on the second, its spinners turned until the next: the turns are
// written past the frame's own control bytes, each to its spot on the screen the frame drew. The frames
// `--chat` and `--once` answer from are recorded on the worker thread (`run-board-gather-record.ts`),
// so this thread only draws. Each stage is marked as it is entered, for `--timing`'s stalls.
async function redraw_forever(looks: Looks, screen: Screen, start: Start): Promise<void> {
	const frame_screen = run_board_frame_loop.screen_of()
	const step = ticker(looks, screen, start, frame_screen)
	let state: BoardState = { ...FRESH_STATE, typing: start.typing }
	const { themed } = looks

	await poll.wait_for(
		async () => {
			themed.enter_stage?.('redraw')
			// eslint-disable-next-line require-atomic-updates -- poll awaits each callback before starting the next tick
			state = await step(state)
		},
		{
			interval_ms: run_board_spin.REDRAW_MS,
			sleeper: async () => {
				themed.enter_stage?.('turn')
				await run_board_spin.spin_to_second(state, current(looks), frame_screen)
			},
		},
	)
}

// The ports the live board draws through: the folds, the sound switch and the cue it gates read off the
// keys, and on a board a theme run draws the rows typed — by its theme layer — and the trill and the
// typed end sounded while they type, in the theme shown.
function live_ports(ports: BoardPorts, keys: KeyReading, theme_run?: ThemeRun): BoardPorts {
	const shown = shown_of(theme_run)

	return {
		...ports,
		folded: keys.folded,
		sound: keys.sound,
		cue: run_board_theme_demo_sound.muted(keys.cue ?? ports.cue, theme_run),
		types_rows: theme_run !== undefined,
		is_live: true,
		typing_sound: trill_of(ports, keys, shown, () => {
			typed_end_of(shown?.())()
		}),
		theme_run,
	}
}

// The icons the board in no theme draws: no theme's own (emoji) where the launch took its theme's
// default, the ones named where `--icons` or `JOSH_BOARD_ICONS` named others (joshuafolkken/kit#8917).
function plain_icons(ports: Pick<BoardPorts, 'icons' | 'theme'>): BoardPorts['icons'] {
	const { icons, theme } = ports

	return icons === run_board_icons.default_of(theme) ? run_board_icons.default_of(undefined) : icons
}

// The board in no theme a theme run draws while it shows none: its rows untyped, its frame restyled in
// no theme.
function plain_of(ports: BoardPorts): BoardPorts {
	const icons = plain_icons(ports)

	return {
		...ports,
		theme: undefined,
		icons,
		types_rows: false,
		restyle: (text) => run_board_theme.restyle(undefined, text, icons),
	}
}

// The colors the board's terminal draws: the ports' where they say (a replay draws 24-bit color), else
// stdout's.
function board_depth(board: Pick<BoardPorts, 'color_depth'>): number {
	return board.color_depth?.() ?? run_board_paint.color_depth()
}

// joshuafolkken/kit#8939: the board asks its redraws of one repaint, the theme run's where it has one.
function repainted(ports: BoardPorts, run: ThemeRun | undefined): BoardPorts {
	return { ...ports, repaint: run?.repaint ?? run_board_repaint.repaint_of() }
}

// The board's keys: the theme run's own where it has one; else the folds and the sound switch, each
// asking a redraw.
function keys_of(ports: BoardPorts, run: ThemeRun | undefined): KeyReading {
	if (run !== undefined) return run_board_theme_keys.read_theme_keys(ports, run).keys

	return run_board_keys.read_keys(ports.keys, {
		cue: ports.cue,
		trill: ports.typing_sound,
		redraw: () => {
			run_board_repaint.request(ports.repaint)
		},
	})
}

// The board as it opens: its theme run where one draws it, its themed ports and joint, and its keys.
interface Opened {
	run: ThemeRun | undefined
	ports: BoardPorts
	joint: Joint
	keys: KeyReading
}

// joshuafolkken/kit#8917: a board a theme run draws is drawn in the base look its theme host reads back
// (`run-board-theme-roles.ts`), its keys and exit the theme run's own — one launched in no theme too,
// shown in none until demo mode switches it to a work (Issue 4-4), its base look then laid out as the
// first work's. One without — a terminal without 24-bit color (Issue 4-3) — is the board in no theme,
// Ctrl-C leaving at once.
function opened(board: BoardPorts, theme: Theme | undefined): Opened {
	const run = run_board_theme_registry.run_of(theme, board.is_tty ? board_depth(board) : 0)
	const joined = themed_joint(board, run === undefined ? undefined : (theme ?? BASE_THEME))
	const ports = repainted(joined.ports, run)

	return { run, ports, joint: joined.joint, keys: keys_of(ports, run) }
}

// A signal leaves through `on_exit`; a failure outside the redraws leaves before its error is printed, so
// the error lands on the normal screen rather than vanishing with the alternate one, and a failed redraw
// is told to `failed` and drawn on past (`surviving`). The board arrives without its theme and is themed
// here, where each frame is restyled before its screen control bytes are added (`on_screen`).
async function watch(board: BoardPorts, theme: Theme | undefined, failed?: Failed): Promise<void> {
	const { run, ports, joint, keys } = opened(board, theme)
	const leave = leaver(ports, SCREEN, keys, joint)
	const themed = { ...live_ports(ports, keys, run), opened_ms: ports.now() }

	ports.write(SCREEN.enter)
	ports.on_exit(leave)

	try {
		await run_board_live_sound.ready(themed, keys, shown_of(run))
		await redraw_forever({ themed, plain: plain_of(themed) }, SCREEN, {
			last: { text: undefined },
			failed,
			typing: run_board_type_rows.NO_TYPING,
		})
	} finally {
		leave()
	}
}

const run_board_live = { trill_of, typed_end_of, watch }

export { run_board_live }
