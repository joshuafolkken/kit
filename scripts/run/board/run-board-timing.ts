import { lane_stats } from '#scripts/lane/lane-stats'
import { launch_timing } from '#scripts/lane/launch-timing'
import { run_board_heap, type HeapProbes, type HeapWatch } from './run-board-heap'
import { run_board_screen } from './run-board-screen'
import { run_board_stall, type StallProbes, type StallWatch } from './run-board-stall'
import type { BoardPorts, DrawKind, DrawTimer } from './run-board-state'
import { run_board_timing_frames, type FrameStats } from './run-board-timing-frames'

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
const SPIN_WAKE_ROW = 'spin wake lag'
const DRAW_KINDS: ReadonlyArray<DrawKind> = ['tick', 'turn']
const REDRAW_KINDS: ReadonlyArray<DrawKind> = ['receive', 'view', 'reveal', 'sound']

// Each draw's time in ms, by its kind (joshuafolkken/kit#8126).
type Draws = Record<DrawKind, Array<number>>

type Row = [string, string]

// A kind's report row, from its samples and their median.
type KindName = (kind: DrawKind, samples: ReadonlyArray<number>, median: number) => Row

// The timer a worker round received is timed on, from when a board under `--timing` starts timing its
// draws until its report is said (joshuafolkken/kit#8825).
const timing: { receive?: DrawTimer | undefined } = {}

// The main thread's heap read and the heap's own sampling timer, apart from the stall probe's.
type HeapTimer = Omit<HeapProbes, 'worker'>

// The stall probes with the heap's; where none are handed, the process's heap on the stall probes' timer.
type TimingProbes = StallProbes & { heap?: HeapTimer }

// The clock the marks are read on and the probes the draws are watched with.
interface TimingReads {
	now?: (() => number) | undefined
	probes?: TimingProbes | undefined
}

// The stalls, the heaps and how late each spinner wake ran past its due time (joshuafolkken/kit#8902),
// and each frame's compose time and bytes (joshuafolkken/kit#8917).
interface Watching {
	stalls: StallWatch
	heap: HeapWatch
	wakes: Array<number>
	frames: FrameStats
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

// How many draws of a kind, the longest and the median, in ms to a tenth.
function summary(samples: ReadonlyArray<number>, median: number): string {
	const max = run_board_stall.longest(samples)

	return `max ${max.toFixed(1)} · median ${median.toFixed(1)} (n ${String(samples.length)})`
}

function total(samples: ReadonlyArray<number>): number {
	return samples.reduce((sum, ms) => sum + ms, 0)
}

// A row per kind timed, named by `name`; a kind never timed has no median and no row. A redraw
// section says its total ahead, the time it held the redraw stage in all.
function kind_rows(draws: Draws, kinds: ReadonlyArray<DrawKind>, name: KindName): Array<Row> {
	return kinds.flatMap((kind): Array<Row> => {
		const median = lane_stats.median(draws[kind])

		return median === undefined ? [] : [name(kind, draws[kind], median)]
	})
}

function draw_row(kind: DrawKind, samples: ReadonlyArray<number>, median: number): Row {
	return [`${kind} draw`, summary(samples, median)]
}

function redraw_row(kind: DrawKind, samples: ReadonlyArray<number>, median: number): Row {
	return [`redraw ${kind}`, `total ${total(samples).toFixed(1)} · ${summary(samples, median)}`]
}

function draw_rows(draws: Draws | undefined): Array<Row> {
	if (draws === undefined) return []

	return [...kind_rows(draws, DRAW_KINDS, draw_row), ...kind_rows(draws, REDRAW_KINDS, redraw_row)]
}

// The launch phases, then — on a live board under `--timing` — each kind of draw it timed and the redraw
// stage's sections outside its draw (joshuafolkken/kit#8825), the main-thread stalls and wake lag it
// watched (joshuafolkken/kit#8148) and the heaps it sampled (joshuafolkken/kit#8339).
function report(
	draws?: Draws,
	stall_rows: ReadonlyArray<Row> = [],
	heap_rows: ReadonlyArray<Row> = [],
): string {
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
		run_board_timing_frames.stop()
		timing.receive = undefined
		const wake_rows = run_board_stall.lag_rows(SPIN_WAKE_ROW, watching.wakes)
		const frame_rows = run_board_timing_frames.rows(watching.frames)

		ports.write(
			report(draws, [...frame_rows, ...watching.stalls.rows(), ...wake_rows], watching.heap.rows()),
		)
	}
}

// The stalls and the heaps, watched from when a live board takes its screen.
function watch(ports: BoardPorts, probes: TimingProbes): Watching {
	const timer = probes.heap ?? { main: run_board_heap.main, every: probes.every }
	const heap = run_board_heap.watch({ ...timer, worker: ports.worker_heap })

	return {
		stalls: run_board_stall.watch(probes),
		heap,
		wakes: [],
		frames: run_board_timing_frames.watch(),
	}
}

// Times each draw into `draws`, by its kind — its own time, less the sections timed inside it (a cue
// sounded within the tick draw counts as `sound`, never in the tick too; joshuafolkken/kit#8825).
function draw_timer(draws: Draws, now: () => number): DrawTimer {
	const nested = { ms: 0 }

	return function time<T>(kind: DrawKind, draw: () => T): T {
		const start = now()
		const outer = nested.ms

		nested.ms = 0

		try {
			return draw()
		} finally {
			const elapsed = now() - start

			draws[kind].push(elapsed - nested.ms)
			nested.ms = outer + elapsed
		}
	}
}

// The cue's sound prepared, timed as the redraw's `sound`; no cue where the ports sound none.
function timed_cue(cue: BoardPorts['cue'], time: DrawTimer): BoardPorts['cue'] {
	if (cue === undefined) return undefined

	return (name) => {
		time('sound', () => {
			cue(name)
		})
	}
}

function no_draws(): Draws {
	return { tick: [], turn: [], receive: [], view: [], reveal: [], sound: [] }
}

// Each draw timed from here on — a worker round received among them, through `received` — the stalls
// and the spinners' wake lateness watched from when a live board takes its screen — `--once` never does —
// and the report said with them after the screen is left.
function draw_ports(
	ports: BoardPorts,
	now: () => number,
	probes: TimingProbes,
): Pick<BoardPorts, 'cue' | 'enter_stage' | 'on_exit' | 'time_draw' | 'time_wake'> {
	const draws = no_draws()
	const watched: { watching?: Watching } = {}
	const time = draw_timer(draws, now)

	timing.receive = time

	return {
		cue: timed_cue(ports.cue, time),
		enter_stage: (stage) => {
			watched.watching?.stalls.enter(stage)
		},
		on_exit: (leave) => {
			const watching = watch(ports, probes)

			watched.watching = watching
			ports.on_exit(reporting(ports, leave, draws, watching))
		},
		time_draw: time,
		time_wake: (due_ms, woke_ms) => {
			watched.watching?.wakes.push(Math.max(0, woke_ms - due_ms))
		},
	}
}

// Runs `draw`, timed where the ports time draws.
function drawn<T>(ports: Pick<BoardPorts, 'time_draw'>, kind: DrawKind, draw: () => T): T {
	return ports.time_draw === undefined ? draw() : ports.time_draw(kind, draw)
}

// Hands a worker round to `receive`, timed as the redraw's `receive` while a board under `--timing` is
// up; the worker's listener holds no ports to time it through.
function received<A extends Array<unknown>>(receive: (...args: A) => void, ...args: A): void {
	drawn({ time_draw: timing.receive }, 'receive', () => {
		receive(...args)
	})
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
// report said after the screen is left. Without `--timing` they are the ports as they came; `now` and
// `probes` default to the process's clock and probes.
function timed(
	ports: BoardPorts,
	is_timing: boolean,
	{
		now = performance.now.bind(performance),
		probes = run_board_stall.PROCESS_PROBES,
	}: TimingReads = {},
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
	SPIN_WAKE_ROW,
	TIMING_FLAG,
	drawn,
	received,
	report,
	say,
	split,
	timed,
}

export { run_board_timing }
