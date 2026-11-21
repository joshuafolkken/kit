import { lane_stats } from '#scripts/lane/lane-stats'
import { launch_timing } from '#scripts/lane/launch-timing'
import { run_board_heap, type HeapProbes, type HeapWatch } from './run-board-heap'
import { run_board_screen } from './run-board-screen'
import { run_board_stall, type Stall, type StallProbes, type StallWatch } from './run-board-stall'
import type { BoardPorts, DrawKind, DrawTimer } from './run-board-state'

// `josh run:board --timing` (joshuafolkken/kit#7929): what the first board waited on, said once the
// board is done — after the frame `--once` draws, or after a live board leaves its screen. Each phase
// is `launch_timing`'s: the launcher's rebuild and core wait, the reads `read_local` and `resample`
// timed (on the worker for a live board, handed over with its first round), the worker's first answer,
// and when the first read came back and the first frame was written, counted from the process start.
// joshuafolkken/kit#8218 adds the code load, when the screen was entered, and the plan read's steps and
// `gh` calls (`run-board-plan.ts`, `backlog-plan-read.ts`).

const TIMING_FLAG = '--timing'
const FIRST_READ_PHASE = 'first read at'
const FIRST_FRAME_PHASE = 'first frame at'
const SCREEN_ENTER_PHASE = 'screen enter at'
const CODE_LOAD_PHASE = 'code load'
const SCREEN_ENTER = run_board_screen.screen_of('live').enter
const HEADING = 'run:board timing (ms):'
const DRAW_KINDS: ReadonlyArray<DrawKind> = ['tick', 'turn']

// Each draw's time in ms, by its kind (joshuafolkken/kit#8126).
type Draws = Record<DrawKind, Array<number>>

// The main thread's heap read and the heap's own sampling timer, apart from the stall probe's.
type HeapTimer = Omit<HeapProbes, 'worker'>

// The stall probes with the heap's; where none are handed, the process's heap on the stall probes' timer.
type TimingProbes = StallProbes & { heap?: HeapTimer }

interface Watching {
	stalls: StallWatch
	heap: HeapWatch
}

interface TimingArgv {
	argv: Array<string>
	is_timing: boolean
}

function split(argv: ReadonlyArray<string>): TimingArgv {
	const rest = argv.filter((argument) => argument !== TIMING_FLAG)

	return { argv: rest, is_timing: rest.length < argv.length }
}

function launched(): Array<[string, number | undefined]> {
	return [
		['rebuild', launch_timing.rebuild_ms()],
		['core wait', launch_timing.core_wait_ms()],
	]
}

function phase_rows(): Array<[string, string]> {
	const named = launched().filter((entry): entry is [string, number] => entry[1] !== undefined)
	const phases = launch_timing.phases().map(({ name, ms }): [string, number] => [name, ms])

	return [...named, ...phases].map(([name, ms]) => [name, String(Math.round(ms))])
}

// A loop, not `Math.max(...samples)`: a board left up for hours times more turns than one call spreads.
function longest(samples: ReadonlyArray<number>): number {
	let max = 0

	for (const ms of samples) max = Math.max(max, ms)

	return max
}

// How many draws of a kind, the longest and the median, in ms to a tenth.
function summary(samples: ReadonlyArray<number>, median: number): string {
	return `max ${longest(samples).toFixed(1)} · median ${median.toFixed(1)} (n ${String(samples.length)})`
}

// A row per kind drawn; a kind never drawn has no median and no row.
function draw_rows(draws: Draws | undefined): Array<[string, string]> {
	if (draws === undefined) return []

	return DRAW_KINDS.flatMap((kind): Array<[string, string]> => {
		const median = lane_stats.median(draws[kind])

		return median === undefined ? [] : [[`${kind} draw`, summary(draws[kind], median)]]
	})
}

// The launch phases, then — on a live board under `--timing` — each kind of draw it timed, the
// main-thread stalls it watched (joshuafolkken/kit#8148) and the heaps it sampled (joshuafolkken/kit#8339).
function report(
	draws?: Draws,
	stalls?: ReadonlyArray<Stall>,
	heap_rows: ReadonlyArray<[string, string]> = [],
): string {
	const stall_rows = stalls === undefined ? [] : run_board_stall.rows(stalls)
	const rows = [...phase_rows(), ...draw_rows(draws), ...stall_rows, ...heap_rows]
	const width = Math.max(0, ...rows.map(([name]) => name.length))
	const lines = rows.map(([name, value]) => `  ${name.padEnd(width)}  ${value}`)

	return `${[HEADING, ...lines].join('\n')}\n`
}

function reporting(
	ports: BoardPorts,
	leave: () => void,
	draws: Draws,
	watching: Watching,
): () => void {
	return () => {
		leave()
		watching.stalls.stop()
		watching.heap.stop()
		ports.write(report(draws, watching.stalls.stalls(), watching.heap.rows()))
	}
}

// The stalls and the heaps, watched from when a live board takes its screen.
function watch(ports: BoardPorts, probes: TimingProbes): Watching {
	const timer = probes.heap ?? { main: run_board_heap.main, every: probes.every }
	const heap = run_board_heap.watch({ ...timer, worker: ports.worker_heap })

	return { stalls: run_board_stall.watch(probes), heap }
}

// Times each draw into `draws`, by its kind.
function draw_timer(draws: Draws, now: () => number): DrawTimer {
	return function time<T>(kind: DrawKind, draw: () => T): T {
		const start = now()
		const result = draw()

		draws[kind].push(now() - start)

		return result
	}
}

// Each draw timed from here on, the stalls watched from when a live board takes its screen — `--once`
// never does — and the report said with them after the screen is left.
function draw_ports(
	ports: BoardPorts,
	now: () => number,
	probes: TimingProbes,
): Pick<BoardPorts, 'enter_stage' | 'on_exit' | 'time_draw'> {
	const draws: Draws = { tick: [], turn: [] }
	const watched: { watching?: Watching } = {}

	return {
		enter_stage: (stage) => {
			watched.watching?.stalls.enter(stage)
		},
		on_exit: (leave) => {
			const watching = watch(ports, probes)

			watched.watching = watching
			ports.on_exit(reporting(ports, leave, draws, watching))
		},
		time_draw: draw_timer(draws, now),
	}
}

// Runs `draw`, timed where the ports time draws.
function drawn<T>(ports: Pick<BoardPorts, 'time_draw'>, kind: DrawKind, draw: () => T): T {
	return ports.time_draw === undefined ? draw() : ports.time_draw(kind, draw)
}

// How long the dispatcher took to load this command's code, taken where the board starts
// (joshuafolkken/kit#8218); none when it was not launched through the dispatcher.
function mark_code_load(now: () => number): void {
	const dispatched = launch_timing.dispatched_ms()

	if (dispatched !== undefined) launch_timing.mark(CODE_LOAD_PHASE, now() - dispatched)
}

// The frame written, marked as the screen entered or — once the first read is back — the first frame.
function marked_write(
	ports: BoardPorts,
	now: () => number,
	has_read: () => boolean,
): BoardPorts['write'] {
	return (frame) => {
		ports.write(frame)
		if (frame === SCREEN_ENTER) launch_timing.mark(SCREEN_ENTER_PHASE, now())
		else if (has_read()) launch_timing.mark(FIRST_FRAME_PHASE, now())
	}
}

// The ports with the code load, the screen entered, the first read and the first frame marked, and the
// report said after the screen is left. Without `--timing` they are the ports as they came.
function timed(
	ports: BoardPorts,
	is_timing: boolean,
	now: () => number = performance.now.bind(performance),
	probes: TimingProbes = run_board_stall.PROCESS_PROBES,
): BoardPorts {
	if (!is_timing) return ports
	let has_read = false

	mark_code_load(now)

	return {
		...ports,
		...draw_ports(ports, now, probes),
		gather: async (pace) => {
			const read = await ports.gather(pace)

			launch_timing.mark(FIRST_READ_PHASE, now())
			has_read = true

			return read
		},
		write: marked_write(ports, now, () => has_read),
	}
}

// The report a single frame says after it, where `--timing` asked for one.
function say(ports: BoardPorts, is_timing: boolean): void {
	if (is_timing) ports.write(report())
}

const run_board_timing = {
	CODE_LOAD_PHASE,
	FIRST_FRAME_PHASE,
	FIRST_READ_PHASE,
	SCREEN_ENTER_PHASE,
	TIMING_FLAG,
	drawn,
	report,
	say,
	split,
	timed,
}

export { run_board_timing }
