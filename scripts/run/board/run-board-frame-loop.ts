import { poll } from '#scripts/lib/poll'
import { run_board_cells, type Cells } from './run-board-cells'
import { run_board_cells_ansi } from './run-board-cells-ansi'
import { run_board_cells_diff } from './run-board-cells-diff'
import type { TerminalSize } from './run-board-fit'
import type { Layer } from './run-board-layer'
import { run_board_screen } from './run-board-screen'
import type { BoardPorts } from './run-board-state'
import { run_board_timing } from './run-board-timing'

// The frames of a live `run:board` between redraws (joshuafolkken/kit#8826): every layer composed onto
// one canvas and the cells that changed since the last frame written in one synchronized write, at the
// first moment a layer changes. A frame that took longer to compose than `MIN_FRAME_MS` leaves its decor
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
// shows; a frame composed slower than that thins the next one's decor.
const MIN_FRAME_MS = 16
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

// The canvas written over the terminal's cells: only what changed, in one synchronized write.
function write_frame(ports: FramePorts, screen: FrameScreen, canvas: Cells): void {
	const { front, prefix } = front_of(screen, canvas)
	const bytes = prefix + run_board_cells_diff.diff(canvas, front)

	if (bytes === '') return
	const write = ports.write_drawn ?? ports.write

	write(run_board_screen.synced(bytes))
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

		compose(frame_run.layers, canvas, at_ms, decor_ms)
		write_frame(ports, screen, canvas)
	})
	clock.is_thin = ports.now() - at_ms > MIN_FRAME_MS
	clock.decor_ms = decor_ms
	clock.last_ms = at_ms
	frame_run.after_frame?.(at_ms)
}

// The first moment a layer changes, no sooner than a refresh after the last frame and no later than
// `until_ms`.
function wake_of(frame_run: FrameRun, now_ms: number, last_ms: number): number {
	const { layers, until_ms } = frame_run
	const next_ms = Math.min(until_ms, ...layers.map((layer) => layer.next_change_ms(now_ms)))

	return Math.min(until_ms, Math.max(next_ms, last_ms + MIN_FRAME_MS))
}

// Sleeps from `now_ms` until `due_ms`, handing the wake's due and actual time to the ports that time
// wakes (joshuafolkken/kit#8902); the time it woke at.
async function sleep_until(ports: FramePorts, now_ms: number, due_ms: number): Promise<number> {
	await ports.sleep(due_ms - now_ms)
	const woke_ms = ports.now()

	ports.time_wake?.(due_ms, woke_ms)

	return woke_ms
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

	await sleep_until(ports, now_ms, wake_of(frame_run, now_ms, clock.last_ms))
	await ports.drained?.()
	if (ports.now() < frame_run.until_ms) frame(frame_run, ports, screen, clock)
}

// The first frame, then a frame at each change until `until_ms`; a still frame just waits.
async function run(frame_run: FrameRun, ports: FramePorts, screen: FrameScreen): Promise<void> {
	const clock: FrameClock = { last_ms: ports.now(), decor_ms: undefined, is_thin: false }

	frame(frame_run, ports, screen, clock)

	if (frame_run.is_still) {
		await sleep_until(ports, ports.now(), frame_run.until_ms)

		return
	}

	await poll.poll_until(() => ports.now() >= frame_run.until_ms, {
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
	MIN_FRAME_MS,
	base_layer,
	revealed,
	run,
	screen_of,
	set_base,
	size_of,
}

export { run_board_frame_loop }
export type { FramePorts, FrameRun, FrameScreen }
