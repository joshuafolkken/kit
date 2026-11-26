import { run_board_cells, type Cells } from './run-board-cells'
import { run_board_cells_ansi } from './run-board-cells-ansi'
import type { TerminalSize } from './run-board-fit'
import { run_board_frame_fixture } from './run-board-frame-fixture'
import type { FrameScreen } from './run-board-frame-loop'
import type { MotionFrame, MotionRun } from './run-board-motion-check-fixture'
import type { SpinPorts, Turning } from './run-board-spin-turn'
import { run_board_theme_events } from './run-board-theme-events'
import type { DemoKey } from './run-board-theme-host-sample'
import { run_board_theme_layout } from './run-board-theme-layout'
import { run_board_theme_registry } from './run-board-theme-registry'
import { run_board_theme_roles } from './run-board-theme-roles'
import { run_board_theme_run, type ThemeRun, type ThemeValue } from './run-board-theme-run'
import { run_board_theme_stress_fixture, type StressBoard } from './run-board-theme-stress-fixture'
import { run_board_type_rows } from './run-board-type-rows'

// joshuafolkken/kit#8936: a theme's scene replayed through the real frame loop on a stress board, each
// frame as the terminal took it — its writes, when, and how many cells they changed — for the motion
// check (`run-board-motion-check-fixture.ts`).

type Scene = 'opening' | 'ending' | 'idle' | DemoKey

// The opening, the ending, the idle board and the demo's events.
const SCENES: ReadonlyArray<Scene> = ['opening', 'ending', 'idle', 'a', 'i', 'n', 'p', 'r']
const START_MS = 1_000_000
const SECONDS = 2

// What is replayed: a theme (none: ''), on a board, in a scene, on a terminal taking `write_ms` a write.
interface Replay {
	value: ThemeValue
	board: StressBoard
	scene: Scene
	write_ms: number
}

const { cells_of, copy } = run_board_cells
const { end_part, play_part, run_of, tick_at } = run_board_theme_run

function copy_of(cells: Cells): Cells {
	const to = cells_of({ rows: cells.rows, columns: cells.columns })

	copy(cells, to)

	return to
}

// The theme run in `scene`: its opening as a fresh run starts it, its ending, or idle with the demo's
// event `scene` playing.
function run_in(scene: Scene, value: ThemeValue, row_text: string): ThemeRun {
	const run = run_of(value, run_board_theme_registry.factory_of)

	if (scene === 'opening') return run
	if (scene === 'ending') play_part(run, 'ending', START_MS)
	else end_part(run)
	if (scene === 'ending' || scene === 'idle') return run
	run.demo = {
		timeline: run_board_theme_events.demo_timeline(scene, row_text, tick_at(run, START_MS)),
		entered: value,
	}

	return run
}

// The ports `spin_to_second` writes to, with the index of the write each sleep ends a frame at.
function recorded(
	write_ms: number,
): ReturnType<typeof run_board_frame_fixture.spin_ports> & { marks: Array<number> } {
	const spun = run_board_frame_fixture.spin_ports(START_MS, write_ms)
	const marks: Array<number> = []
	const { sleep } = spun.ports

	spun.ports.sleep = async (ms: number) => {
		marks.push(spun.writes.length)
		await sleep(ms)
	}

	return { ...spun, marks }
}

// How many cells painting `writes` onto `terminal` changes.
function changed_by(terminal: Cells, writes: ReadonlyArray<string>): number {
	const before = copy_of(terminal)

	for (const write of writes) run_board_cells_ansi.paint(terminal, write)

	return [...terminal.chars.keys()].filter(
		(index) =>
			terminal.chars[index] !== before.chars[index] ||
			terminal.styles[index] !== before.styles[index],
	).length
}

// The writes split into frames at the marks, each with when it was made and the cells it changed.
function frames_of(spun: ReturnType<typeof recorded>, cells: Cells): Array<MotionFrame> {
	const ends = [...spun.marks, spun.writes.length]
	const terminal = copy_of(cells)

	return ends.map((end, index) => {
		const group = spun.writes.slice(ends[index - 1] ?? 0, end)
		const writes = group.map(({ raw }) => raw)

		return { at_ms: group[0]?.at_ms ?? 0, writes, changed: changed_by(terminal, writes) }
	})
}

function ports_of(
	spun: ReturnType<typeof recorded>,
	value: ThemeValue,
	run: ThemeRun,
	size: TerminalSize,
): SpinPorts {
	return {
		...spun.ports,
		size: () => size,
		theme: value === '' ? undefined : value,
		theme_run: run,
	}
}

// One second spun after another, `left` of them, a frame begun at each.
async function spin_seconds(
	turning: Turning,
	spun: ReturnType<typeof recorded>,
	screen: FrameScreen,
	left: number,
): Promise<void> {
	if (left === 0) return
	spun.marks.push(spun.writes.length)
	await run_board_frame_fixture.spin_to_second(turning, spun.ports, screen)
	await spin_seconds(turning, spun, screen, left - 1)
}

// The frames `SECONDS` seconds of `replay` write.
async function replay_frames(replay: Replay): Promise<Array<MotionFrame>> {
	const { cells, view, size } = run_board_theme_stress_fixture.stress_board(replay.board)
	const layout = run_board_theme_layout.layout_of(view, run_board_theme_roles.grid_of(cells), size)
	const run = run_in(replay.scene, replay.value, layout?.row_text ?? '')
	const spun = recorded(replay.write_ms)
	const turning: Turning = { ...view, typing: run_board_type_rows.NO_TYPING }
	const screen: FrameScreen = { base: '', base_cells: cells, front: copy_of(cells) }

	spun.ports = ports_of(spun, replay.value, run, size)
	await spin_seconds(turning, spun, screen, SECONDS)

	return frames_of(spun, cells)
}

function label_of(replay: Omit<Replay, 'write_ms'>): string {
	const { columns, rows } = replay.board
	const theme = replay.value === '' ? 'none' : replay.value

	return `${theme} ${String(columns)}x${String(rows)} ${replay.scene}`
}

// `replay` on a terminal taking `write_ms` a write, labelled, with when each frame was due: when the same
// replay made it on a terminal taking no time.
async function motion_run(replay: Omit<Replay, 'write_ms'>, write_ms: number): Promise<MotionRun> {
	const due = await replay_frames({ ...replay, write_ms: 0 })
	const frames = await replay_frames({ ...replay, write_ms })
	const label = label_of(replay)

	return {
		label,
		frames,
		due_ms: due.filter(({ writes }) => writes.length > 0).map(({ at_ms }) => at_ms),
	}
}

const run_board_motion_fixture = { SCENES, motion_run }

export { run_board_motion_fixture }
export type { Scene }
