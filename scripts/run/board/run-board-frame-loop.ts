import { poll } from '#scripts/lib/poll'
import { run_board_cells, type Cells } from './run-board-cells'
import { run_board_cells_ansi } from './run-board-cells-ansi'
import { run_board_cells_diff } from './run-board-cells-diff'
import type { TerminalSize } from './run-board-fit'
import type { Layer } from './run-board-layer'
import { run_board_screen } from './run-board-screen'
import type { BoardPorts } from './run-board-state'
import { run_board_timing } from './run-board-timing'
import { run_board_timing_frames } from './run-board-timing-frames'

// The frames of a live `run:board` between redraws (joshuafolkken/kit#8826): every layer composed onto
// one canvas and the cells that changed since the last frame written in one synchronized write, at the
// first moment a layer changes. A frame that took longer to compose than `THIN_AFTER_MS` leaves its decor
// layers where they were for the next frame, so a slow terminal drops their steps, never the spinners'.

// The screen a live board draws on: the redraw's text, its cells once painted, and the cells on the
// terminal — none until a frame is written over a cleared screen.
interface FrameScreen {
	base: string
	base_cells: Cells | undefined
	front: Cells | undefined
}

// The layers of one second, until when, whether they change at all, and what runs after each frame.
interface FrameRun {
	layers: ReadonlyArray<Layer>
	until_ms: number
	is_still: boolean
	after_frame?: ((at_ms: number) => void) | undefined
	// joshuafolkken/kit#8917: false once the layers no longer show what the board shows (a theme switched
	// in demo mode); the second ends within a check, before another frame, so the redraw comes at once.
	is_current?: (() => boolean) | undefined
}

type FramePorts = Pick<
	BoardPorts,
	'now' | 'sleep' | 'write' | 'write_drawn' | 'time_draw' | 'time_wake' | 'size' | 'drained'
>

// When the last frame was made, the moment its decor was drawn at, and whether it ran over its budget.
interface FrameClock {
	last_ms: number
	decor_ms: number | undefined
	is_thin: boolean
}

const { cells_of, is_sized, copy } = run_board_cells
// joshuafolkken/kit#8825: no frame follows the last sooner than one 60 Hz refresh, the most a terminal
// shows.
const MIN_FRAME_MS = 16
// joshuafolkken/kit#8917: a frame composed slower than one theme tick thins the next one's decor; it
// matches the theme layers' step, so a frame slower than a refresh but within a tick freezes none of them.
const THIN_AFTER_MS = 50
// How often a second that a switch can end checks for one, at most (joshuafolkken/kit#8917).
const CHECK_MS = 50
const DEFAULT_SIZE: TerminalSize = { rows: 24, columns: 80 }
const CLEAR = '\u{1B}[H\u{1B}[2J'

function screen_of(base = ''): FrameScreen {
	return { base, base_cells: undefined, front: undefined }
}

// A new redraw as the base every frame is drawn on; the screen is unchanged until the next frame.
function set_base(screen: FrameScreen, text: string): void {
	screen.base = text
	screen.base_cells = undefined
}

function size_of(ports: Pick<BoardPorts, 'size'>): TerminalSize {
	return ports.size?.() ?? DEFAULT_SIZE
}

// The cells on the terminal for `size`: a cleared screen, and the bytes that clear it, where they are
// unknown or another size.
function front_of(screen: FrameScreen, size: TerminalSize): { front: Cells; prefix: string } {
	if (is_sized(screen.front, size)) return { front: screen.front, prefix: '' }
	screen.front = cells_of(size)

	return { front: screen.front, prefix: CLEAR }
}

// The canvas written over the terminal's cells: only what changed, in one synchronized write; the bytes
// written, none where nothing changed.
function write_frame(ports: FramePorts, screen: FrameScreen, canvas: Cells): number {
	const { front, prefix } = front_of(screen, canvas)
	const bytes = prefix + run_board_cells_diff.diff(canvas, front)

	if (bytes === '') return 0
	const write = ports.write_drawn ?? ports.write
	const text = run_board_screen.synced(bytes)

	write(text)

	return Buffer.byteLength(text)
}

function compose(
	layers: ReadonlyArray<Layer>,
	canvas: Cells,
	at_ms: number,
	decor_ms: number,
): void {
	for (const layer of layers) layer.draw(canvas, layer.is_decor ? decor_ms : at_ms)
}

// One frame at `at_ms`, timed as a turn where `--timing` times draws; a thin frame draws its decor at
// the moment the last was drawn at.
function frame(
	frame_run: FrameRun,
	ports: FramePorts,
	screen: FrameScreen,
	clock: FrameClock,
): void {
	const at_ms = ports.now()
	const decor_ms = clock.is_thin ? (clock.decor_ms ?? at_ms) : at_ms

	run_board_timing.drawn(ports, 'turn', () => {
		const canvas = cells_of(size_of(ports))
		const start_ms = ports.now()

		compose(frame_run.layers, canvas, at_ms, decor_ms)
		const compose_ms = ports.now() - start_ms

		run_board_timing_frames.framed(compose_ms, write_frame(ports, screen, canvas))
	})
	clock.is_thin = ports.now() - at_ms > THIN_AFTER_MS
	clock.decor_ms = decor_ms
	clock.last_ms = at_ms
	frame_run.after_frame?.(at_ms)
}

// The first moment a layer changes after the last frame was made — a change the last frame's write ran
// past is due at once, not skipped (joshuafolkken/kit#8950) — no sooner than a refresh after the last
// frame and no later than `until_ms`.
function wake_of(frame_run: FrameRun, last_ms: number): number {
	const { layers, until_ms } = frame_run
	const next_ms = Math.min(until_ms, ...layers.map((layer) => layer.next_change_ms(last_ms)))

	return Math.min(until_ms, Math.max(next_ms, last_ms + MIN_FRAME_MS))
}

// Sleeps from `now_ms` until `due_ms`, handing the wake's due and actual time to the ports that time
// wakes (joshuafolkken/kit#8902); the time it woke at.
async function sleep_until(ports: FramePorts, now_ms: number, due_ms: number): Promise<number> {
	await ports.sleep(Math.max(0, due_ms - now_ms))
	const woke_ms = ports.now()

	ports.time_wake?.(Math.max(due_ms, now_ms), woke_ms)

	return woke_ms
}

// The second is over: its end reached, or the board shows another look than its layers draw.
function is_over(frame_run: FrameRun, ports: FramePorts): boolean {
	return ports.now() >= frame_run.until_ms || frame_run.is_current?.() === false
}

// The wake, no later than the next check where the second can end early on a switch.
function checked_wake(frame_run: FrameRun, now_ms: number, last_ms: number): number {
	const wake_ms = wake_of(frame_run, last_ms)

	return frame_run.is_current === undefined ? wake_ms : Math.min(wake_ms, now_ms + CHECK_MS)
}

// Waits for the terminal to take the last frame, then draws the next where it is still before
// `until_ms`.
async function next_frame(
	frame_run: FrameRun,
	ports: FramePorts,
	screen: FrameScreen,
	clock: FrameClock,
): Promise<void> {
	const now_ms = ports.now()

	await sleep_until(ports, now_ms, checked_wake(frame_run, now_ms, clock.last_ms))
	await ports.drained?.()
	if (!is_over(frame_run, ports)) frame(frame_run, ports, screen, clock)
}

// A still frame waits out its second, checking for a switch where one can end it.
async function wait_still(frame_run: FrameRun, ports: FramePorts): Promise<void> {
	await poll.poll_until(() => is_over(frame_run, ports), {
		attempts: Infinity,
		interval_ms: 0,
		sleeper: async () => {
			const now_ms = ports.now()

			await sleep_until(ports, now_ms, checked_wake({ ...frame_run, layers: [] }, now_ms, now_ms))
		},
	})
}

// The first frame, then a frame at each change until `until_ms`; a still frame just waits.
async function run(frame_run: FrameRun, ports: FramePorts, screen: FrameScreen): Promise<void> {
	const clock: FrameClock = { last_ms: ports.now(), decor_ms: undefined, is_thin: false }

	frame(frame_run, ports, screen, clock)

	if (frame_run.is_still) {
		await wait_still(frame_run, ports)

		return
	}

	await poll.poll_until(() => is_over(frame_run, ports), {
		attempts: Infinity,
		interval_ms: 0,
		sleeper: async () => {
			await next_frame(frame_run, ports, screen, clock)
		},
	})
}

// The base's cells for `size`, painted once per redraw and size.
function base_cells(screen: FrameScreen, size: TerminalSize): Cells {
	if (is_sized(screen.base_cells, size)) return screen.base_cells
	screen.base_cells = cells_of(size)
	run_board_cells_ansi.paint(screen.base_cells, screen.base)

	return screen.base_cells
}

// The redraw, under every other layer; it changes only with the next redraw.
function base_layer(screen: FrameScreen): Layer {
	return {
		is_decor: false,
		next_change_ms: () => Infinity,
		draw: (canvas) => {
			copy(base_cells(screen, canvas), canvas)
		},
	}
}

// The screen as the reveal left it: the redraw on the terminal.
function revealed(screen: FrameScreen, text: string, size: TerminalSize): void {
	set_base(screen, text)
	screen.front = cells_of(size)
	copy(base_cells(screen, size), screen.front)
}

const run_board_frame_loop = {
	CHECK_MS,
	MIN_FRAME_MS,
	THIN_AFTER_MS,
	base_layer,
	revealed,
	run,
	screen_of,
	set_base,
}

export { run_board_frame_loop }
export type { FramePorts, FrameRun, FrameScreen }
