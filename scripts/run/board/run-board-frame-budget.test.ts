import type { EpicChild } from '#scripts/epic/epic-graph'
import { lane_stats } from '#scripts/lane/lane-stats'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import string_width from 'string-width'
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { run_board_drop_screen } from './run-board-drop-screen'
import { run_board_exit_rain } from './run-board-exit-rain'
import { run_board_fixture } from './run-board-fixture'
import { run_board_gather, type Gatherer, type GatherState } from './run-board-gather'
import {
	run_board_gather_thread,
	type GatherPost,
	type GatherWorker,
} from './run-board-gather-thread'
import { run_board_labels } from './run-board-labels'
import type { BoardPlan } from './run-board-layout'
import { run_board_rain, type Random } from './run-board-rain'
import { run_board_rain_drop } from './run-board-rain-drop'
import type { LocalRead } from './run-board-read'
import { run_board_render_stress_fixture } from './run-board-render-stress-fixture'
import type { Beat } from './run-board-reveal-blocks'
import { run_board_reveal_rain } from './run-board-reveal-rain'
import { run_board_spin } from './run-board-spin'
import type { BoardPorts, BoardState } from './run-board-state'
import { run_board_tick } from './run-board-tick'
import { run_board_type_rows, type TypingSpan } from './run-board-type-rows'
import type { UsageMark } from './run-board-usage'
import { run_board_usage_board } from './run-board-usage-board'

vi.mock('string-width', async (original) => {
	const actual = await original<{ default: typeof string_width }>()

	return { default: vi.fn(actual.default) }
})

// joshuafolkken/kit#4267: one redraw — the layout, the frame and its fit — runs on the board's own
// thread between spinner turns, so it is held to a budget over a run the size of a busy day's: eight
// lanes, a thousand processes and six thousand events, about what the stream held on 2026-10-20.
// joshuafolkken/kit#5161: the budget counts the events a redraw reads, not the time it takes, so a
// shared CI runner's load cannot fail it. Every fold over the stream reads each event's issue once.
// joshuafolkken/kit#8160: the worker assembles the frame, so a redraw reads none of the stream.

const { FIRST_ROUND, LOCAL, START, harness } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const REPO = 'joshuafolkken/kit'
const LANES = 8
const PROCESSES = 1000
const EVENTS = 6000
const EVENTS_PER_ISSUE = 40
const FIRST_ISSUE = 4000
const SECOND_MS = 1000
const STAGES = ['preflight', 'sync', 'gate', 'commit', 'push', 'checks', 'review']
const ROUNDS = 3
// The pane the live board was profiled in (joshuafolkken/kit#5185).
const PANE = { rows: 50, columns: 160 }
const HALF = 0.5
const ISSUES = EVENTS / EVENTS_PER_ISSUE
const LIVE = Array.from({ length: LANES }, (_, index) => FIRST_ISSUE + ISSUES - LANES + index)

// One issue's events, as a lane writes them from its dispatch to its merge; a live lane's has no merge.
function event_of(pos: number): RunEvent {
	const number = FIRST_ISSUE + Math.floor(pos / EVENTS_PER_ISSUE)
	const issue = `#${String(number)}`
	const step = pos % EVENTS_PER_ISSUE
	const stage = STAGES[step % STAGES.length] ?? 'gate'
	const steps = new Map<number, [string, string]>([
		[0, ['setup', `dispatching ${issue}`]],
		[1, ['child-launch', `${issue} dispatched`]],
		[2, ['lane-phase', `${issue} implement`]],
	])

	if (!LIVE.includes(number)) steps.set(EVENTS_PER_ISSUE - 1, ['merge', `${issue} merged`])

	const [kind, text] = steps.get(step) ?? ['ship-stage', `${issue} ${stage} start ${stage}`]

	return { pos, at: new Date(START + pos * SECOND_MS).toISOString(), kind, text }
}

function child(number: number): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels: [], blocked_by: [] }
}

const NUMBERS = Array.from({ length: ISSUES }, (_, index) => FIRST_ISSUE + index)
const PLAN: BoardPlan = {
	waves: { waves: [NUMBERS.map((number) => child(number))], unreached: [] },
	tracked: new Map(),
	context: {
		repo: REPO,
		titles: new Map(NUMBERS.map((number) => [number, `Issue ${String(number)}`])),
		open_numbers: undefined,
	},
	labels: new Map(),
}
const BUSY: LocalRead = {
	...LOCAL,
	events: Array.from({ length: EVENTS }, (_, pos) => event_of(pos)),
	lanes: LIVE.map(String),
}

function mark(at_ms: number, cpu_ms: number): UsageMark {
	const pids = Array.from({ length: PROCESSES }, (_, index) => index + 1)

	return {
		at_ms,
		processes: new Map(
			pids.map((pid) => [pid, { cpu_ms, memory_bytes: 100, compressed_bytes: 0 }]),
		),
		lanes: new Map(pids.map((pid) => [pid, LIVE.map(String)[pid % (LANES + 1)]])),
		names: new Map(pids.map((pid) => [pid, pid % 2 === 0 ? 'node' : 'claude'])),
		parents: new Map(),
		unread: new Set(),
		folded: new Set(),
		cores: LANES,
		total_bytes: PROCESSES * SECOND_MS,
	}
}

const USAGES = run_board_usage_board.board_usage_of(mark(0, 0), mark(SECOND_MS, SECOND_MS), BUSY)

// What the worker holds for the busy run, read at `read_ms`.
function read_at(read_ms: number): GatherState {
	return { ...run_board_gather.FRESH_GATHER, local: structuredClone(BUSY), read_ms, usages: USAGES }
}

interface Rereading {
	gather: Gatherer
	// The worker reads the same busy stream again and hands the round's frame over, cloned across the
	// thread.
	reread: () => void
}

// A round as the worker hands it over: the frame it assembled over the busy run and its plan.
function handed(read: GatherState): GatherPost {
	const data = { ...FIRST_ROUND.data, ...run_board_gather.read_of(read), plan: PLAN }

	return run_board_gather_thread.post_of(FIRST_ROUND.board, read, data, read.read_ms ?? START).post
}

// A worker over the busy run, whose rounds the test hands over itself — outside the redraw it counts,
// as a live worker's reads are.
function rereading(): Rereading {
	const listeners = new Map<string, (value: unknown) => void>()
	const worker: GatherWorker = {
		on: (event, listener) => listeners.set(event, listener),
		unref: vi.fn(),
	}
	let read_ms = START

	return {
		gather: run_board_gather_thread.worker_gatherer(() => worker),
		reread: () => {
			read_ms += SECOND_MS
			const post = structuredClone(handed(read_at(read_ms)))

			listeners.get('message')?.(post)
		},
	}
}

// The board over the busy run, drawn once — its first frame waits for the worker's first round.
async function first_frame(reread: () => void, gather: Gatherer): Promise<Board> {
	const { ports, frames } = harness(BUSY, [])
	const live = { ...ports, gather }
	const first = tick(FRESH_STATE, live)

	reread()

	return { live, state: await first, frames }
}

interface Board {
	live: BoardPorts
	state: BoardState
	// The frames the board wrote, fitted to its pane once it has one.
	frames: Array<string>
}

interface Redrawing {
	live: BoardPorts
	reread: () => void
	// What the redraw is counted by — each event's issue read, or each width measured — from the read
	// before it.
	reads: MockInstance<typeof run_event_scope.issue_named> | MockInstance<typeof string_width>
}

// One redraw right after a read — the one that would fold the stream again.
async function redraw(state: BoardState, redrawing: Redrawing): Promise<BoardState> {
	redrawing.reread()
	redrawing.reads.mockClear()

	return await tick(state, redrawing.live, 'background')
}

interface Redrawn {
	reads: number
	// The run's read the redraw's state holds — none, as the worker keeps it (joshuafolkken/kit#8160).
	local: LocalRead | undefined
}

// How many events each of `ROUNDS` redraws read, each right after the worker handed a round over.
async function redraws_read(): Promise<Array<Redrawn>> {
	const { gather, reread } = rereading()
	const { live, state: drawn } = await first_frame(reread, gather)
	const redrawing = { live, reread, reads: vi.spyOn(run_event_scope, 'issue_named') }
	let state = drawn
	const spent: Array<Redrawn> = []

	for (let round = 0; round < ROUNDS; round += 1) {
		// eslint-disable-next-line no-await-in-loop -- each redraw draws over the state the last one left
		state = await redraw(state, redrawing)
		spent.push({ reads: redrawing.reads.mock.calls.length, local: state.local })
	}

	return spent
}

interface Measured {
	// The lines `string-width` measured over one redraw fitted to the pane.
	measured: number
	// The lines of the frame that redraw wrote.
	lines: number
}

// joshuafolkken/kit#5185: a redraw fitted to a pane the size of a live one, right after another in the
// same pane as a live board's once a second, its widths counted.
async function fitted_redraw(): Promise<Measured> {
	const { gather, reread } = rereading()
	const { live, state, frames } = await first_frame(reread, gather)
	const sized = { ...live, size: () => PANE }
	const before = await redraw(state, { live: sized, reread, reads: vi.mocked(string_width) })

	await redraw(before, { live: sized, reread, reads: vi.mocked(string_width) })

	const measured = vi.mocked(string_width).mock.calls.length

	return { measured, lines: frames.at(-1)?.split('\n').length ?? 0 }
}

afterEach(() => vi.restoreAllMocks())

describe('run_board_tick.tick frame budget', () => {
	it('redraws a busy run read again reading none of its stream on the board’s thread', async () => {
		const spent = await redraws_read()

		expect(spent).toHaveLength(ROUNDS)
		for (const redrawn of spent) expect(redrawn).toStrictEqual({ reads: 0, local: undefined })
	})

	it('measures no more widths in a redraw fitted to the pane than its frame has lines', async () => {
		const { measured, lines } = await fitted_redraw()

		expect(lines).toBeGreaterThanOrEqual(PANE.rows)
		expect(measured).toBeLessThanOrEqual(lines)
	})
})

// joshuafolkken/kit#8126: a tick drawn on the board's thread longer than a spinner interval stalls the
// spinner, so the stress frame's draw, from its render to `spun`, is held under one; the median of a
// few draws keeps one slow draw on a loaded runner from failing it.
const DRAWS = 5

function draw_ms(): number {
	const started = performance.now()
	const lines = run_board_render_stress_fixture.lines_on(PANE.columns, PANE.rows)

	run_board_spin.spun(lines, run_board_labels.spinner_of(0), { size: PANE })

	return performance.now() - started
}

describe('run_board_spin.spun draw budget', () => {
	it('draws the stress frame from its render to its spun lines within a spinner interval', () => {
		const spent = Array.from({ length: DRAWS }, () => draw_ms())

		expect(lane_stats.median(spent)).toBeLessThan(run_board_labels.SPINNER_INTERVAL_MS)
	})
})

// joshuafolkken/kit#8367: the matrix board keeps the stress frame's cells on each redraw and writes the
// drops' cells on every step between, so both are held under one drop step.
// joshuafolkken/kit#8369: a pour adds four drops a step, so the step is held under one too while it pours.
// joshuafolkken/kit#8629: a deja vu rains a hundred and twenty drops over the text in its second.
function drop_ms(
	at_ms: number,
	pours: ReadonlyArray<TypingSpan> = [],
	deja_starts: ReadonlyArray<number> = [],
): number {
	const started = performance.now()
	const lines = run_board_render_stress_fixture.lines_on(PANE.columns, PANE.rows)
	const screen = run_board_drop_screen.screen_of(
		{ lines, spots: [] },
		run_board_type_rows.NO_TYPING,
		PANE,
	)
	const deja = deja_starts.map((start) => run_board_rain_drop.deja_span(start))
	const poured = run_board_rain_drop.poured(screen, pours, at_ms, deja)

	run_board_rain_drop.drop_bytes(poured, at_ms, at_ms - run_board_rain_drop.DROP_MS)

	return performance.now() - started
}

describe('run_board_rain_drop draw budget', () => {
	it('keeps the stress frame’s cells and writes a drop step within one step', () => {
		const spent = Array.from({ length: DRAWS }, (_, index) => drop_ms(START + index * SECOND_MS))

		expect(lane_stats.median(spent)).toBeLessThan(run_board_rain_drop.DROP_MS)
	})

	it('writes a pouring step within one step, the pour on long enough to fill the board', () => {
		const spent = Array.from({ length: DRAWS }, (_, index) => {
			const at_ms = START + index * SECOND_MS

			return drop_ms(at_ms, [{ from_ms: at_ms - 10 * SECOND_MS, to_ms: at_ms + SECOND_MS }])
		})

		expect(lane_stats.median(spent)).toBeLessThan(run_board_rain_drop.DROP_MS)
	})

	// joshuafolkken/kit#8627: a poured drop's head sums its hurried steps in closed form, so the
	// frames after the typing ends stay within one step too.
	it('writes a step within one step while the poured drops hurry after the typing', () => {
		const spent = Array.from({ length: DRAWS }, (_, index) => {
			const at_ms = START + index * SECOND_MS

			return drop_ms(at_ms, [{ from_ms: at_ms - 10 * SECOND_MS, to_ms: at_ms - SECOND_MS }])
		})

		expect(lane_stats.median(spent)).toBeLessThan(run_board_rain_drop.DROP_MS)
	})

	it('writes a step within one step as a deja vu’s last drops enter, every drop on screen', () => {
		const spent = Array.from({ length: DRAWS }, (_, index) => {
			const at_ms = START + index * SECOND_MS

			return drop_ms(at_ms, [], [at_ms - SECOND_MS + run_board_rain_drop.DROP_MS])
		})

		expect(lane_stats.median(spent)).toBeLessThan(run_board_rain_drop.DROP_MS)
	})
})

// joshuafolkken/kit#8626: the reveal's and the wipe's tails run one to two screens long, so a whole pass
// over the stress frame is held to one `RAIN_MS` a frame on average.
type Pass = (frame: string, random: Random) => Iterable<Beat>

function beat_ms(pass: Pass): number {
	const frame = run_board_render_stress_fixture.lines_on(PANE.columns, PANE.rows).join('\n')
	const started = performance.now()
	const beats = [...pass(frame, () => HALF)]

	return (performance.now() - started) / beats.length
}

describe('run_board_rain draw budget', () => {
	it.each<[string, Pass]>([
		['reveal', (frame, random) => run_board_reveal_rain.beats_of(frame, random, { size: PANE })],
		['wipe', (frame, random) => run_board_exit_rain.beats_of(frame, random, PANE)],
	])('draws each %s frame over the stress frame within one rain frame', (_name, pass) => {
		expect(beat_ms(pass)).toBeLessThan(run_board_rain.RAIN_MS)
	})
})
