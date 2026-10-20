import type { EpicChild } from '#scripts/epic/epic-graph'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_gather, type Gatherer, type GatherState } from './run-board-gather'
import { run_board_gather_thread, type GatherWorker } from './run-board-gather-thread'
import type { BoardPlan } from './run-board-layout'
import type { LocalRead } from './run-board-read'
import type { BoardPorts, BoardState } from './run-board-state'
import { run_board_tick } from './run-board-tick'
import type { UsageMark } from './run-board-usage'
import { run_board_usage_board } from './run-board-usage-board'

// joshuafolkken/kit#4267: one redraw — the layout, the frame and its fit — runs on the board's own
// thread between spinner turns, so it is held to a budget over a run the size of a busy day's: eight
// lanes, a thousand processes and six thousand events, about what the stream held on 2026-10-20.

const { LOCAL, START, harness } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const REPO = 'joshuafolkken/kit'
const LANES = 8
const PROCESSES = 1000
const EVENTS = 6000
const EVENTS_PER_ISSUE = 40
const FIRST_ISSUE = 4000
const SECOND_MS = 1000
const STAGES = ['preflight', 'sync', 'gate', 'commit', 'push', 'checks', 'review']
// The best of a few redraws, so a test runner sharing the machine measures the redraw, not its load.
const ROUNDS = 5
// Measured at 7–13ms on an M-series laptop under load (best of five, this fixture, each redraw right
// after a read), at 15–18ms where each read handed the stream over afresh, and at 63–77ms before the
// stream's folds were kept between rereads. The budget leaves a slower machine three times the
// headroom and stays under half the 80ms a spinner frame lasts; a read that misses the kept folds is
// caught by the stream each redraw draws, not by its time.
const FRAME_BUDGET_MS = 40
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
		folded: new Set(),
		paused: new Map(),
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
	// The worker reads the same busy stream again and hands the round over, cloned across the thread.
	reread: () => void
}

// A worker over the busy run, whose rounds the test hands over itself — outside the redraw it times,
// as a live worker's reads are.
function rereading(): Rereading {
	const listeners = new Map<string, (value: unknown) => void>()
	const worker: GatherWorker = {
		on: (event, listener) => listeners.set(event, listener),
		unref: vi.fn(),
	}
	let before: GatherState = run_board_gather.FRESH_GATHER

	return {
		gather: run_board_gather_thread.worker_gatherer(() => worker),
		reread: () => {
			const after = read_at((before.read_ms ?? START) + SECOND_MS)

			listeners.get('message')?.(structuredClone(run_board_gather_thread.post_of(before, after)))
			before = after
		},
	}
}

// The board over the busy run, drawn once — its first frame waits for the worker's first round.
async function first_frame(reread: () => void, gather: Gatherer): Promise<Board> {
	const { ports, read_plan } = harness(BUSY, [])
	const live = { ...ports, gather }

	read_plan.mockResolvedValue(PLAN)
	const first = tick(FRESH_STATE, live)

	reread()

	return { live, state: await first }
}

interface Board {
	live: BoardPorts
	state: BoardState
}

// How long each of `ROUNDS` redraws took, each right after a read — the one that would fold the stream
// again.
async function redraws_spent(): Promise<Redraws> {
	const { gather, reread } = rereading()
	const { live, state: drawn } = await first_frame(reread, gather)
	let state = drawn
	const spent: Array<Redrawn> = []

	for (let round = 0; round < ROUNDS; round += 1) {
		reread()
		const started = performance.now()

		// eslint-disable-next-line no-await-in-loop -- each redraw folds the state the last one left
		state = await tick(state, live, 'background')
		spent.push({ ms: performance.now() - started, events: state.local?.events })
	}

	return { events: drawn.local?.events, spent }
}

interface Redrawn {
	ms: number
	// The stream the redraw drew — the folds over it are kept for as long as it is the same array.
	events: ReadonlyArray<RunEvent> | undefined
}

interface Redraws {
	// The stream the first frame drew.
	events: ReadonlyArray<RunEvent> | undefined
	spent: Array<Redrawn>
}

describe('run_board_tick.tick frame budget', () => {
	it('redraws a busy run read again within the frame budget', async () => {
		const { spent } = await redraws_spent()

		expect(Math.min(...spent.map(({ ms }) => ms))).toBeLessThan(FRAME_BUDGET_MS)
	})

	it('draws the stream it folded first while each read hands over the same stream', async () => {
		const { events, spent } = await redraws_spent()

		expect(events).toHaveLength(EVENTS)
		for (const redrawn of spent) expect(redrawn.events).toBe(events)
	})
})
