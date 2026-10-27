import type { EpicChild } from '#scripts/epic/epic-graph'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_gather, type Gatherer, type GatherState } from './run-board-gather'
import {
	run_board_gather_thread,
	type GatherPost,
	type GatherWorker,
} from './run-board-gather-thread'
import type { BoardPlan } from './run-board-layout'
import type { LocalRead } from './run-board-read'
import type { BoardPorts, BoardState } from './run-board-state'
import { run_board_tick } from './run-board-tick'
import type { UsageMark } from './run-board-usage'
import { run_board_usage_board } from './run-board-usage-board'

// joshuafolkken/kit#4267: one redraw — the layout, the frame and its fit — runs on the board's own
// thread between spinner turns, so it is held to a budget over a run the size of a busy day's: eight
// lanes, a thousand processes and six thousand events, about what the stream held on 2026-10-20.
// joshuafolkken/kit#5161: the budget counts the events a redraw reads, not the time it takes, so a
// shared CI runner's load cannot fail it.

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
const ROUNDS = 3
// Every fold over the stream reads each event's issue once, so the issues a redraw reads count the
// events it folds. A redraw that keeps the stream's folds read one, and one that folds the stream
// again read 18,294 (three folds of six thousand), so a redraw is held under one fold of the stream.
const READ_BUDGET = EVENTS
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
	// The worker reads the same busy stream again and hands the round over, cloned across the thread.
	reread: () => void
}

// A round as the worker hands it over; `is_afresh` hands the stream over whole each read, as a worker
// that lost the kept stream would, so the board folds it again.
function handed(before: GatherState, after: GatherState, is_afresh: boolean): GatherPost {
	const post = run_board_gather_thread.post_of(before, after)

	if (!is_afresh || post.local === undefined) return post

	return { ...post, local: { value: after.local } }
}

// A worker over the busy run, whose rounds the test hands over itself — outside the redraw it counts,
// as a live worker's reads are.
function rereading(is_afresh: boolean): Rereading {
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

			listeners.get('message')?.(structuredClone(handed(before, after, is_afresh)))
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

interface Redrawing {
	live: BoardPorts
	reread: () => void
	// Each event's issue read, counted from the read before the redraw.
	reads: MockInstance<typeof run_event_scope.issue_named>
}

// One redraw right after a read — the one that would fold the stream again.
async function redraw(state: BoardState, redrawing: Redrawing): Promise<BoardState> {
	redrawing.reread()
	redrawing.reads.mockClear()

	return await tick(state, redrawing.live, 'background')
}

// How many events each of `ROUNDS` redraws read.
async function redraws_read(is_afresh = false): Promise<Redraws> {
	const { gather, reread } = rereading(is_afresh)
	const { live, state: drawn } = await first_frame(reread, gather)
	const redrawing = { live, reread, reads: vi.spyOn(run_event_scope, 'issue_named') }
	let state = drawn
	const spent: Array<Redrawn> = []

	for (let round = 0; round < ROUNDS; round += 1) {
		// eslint-disable-next-line no-await-in-loop -- each redraw folds the state the last one left
		state = await redraw(state, redrawing)
		spent.push({ reads: redrawing.reads.mock.calls.length, events: state.local?.events })
	}

	return { events: drawn.local?.events, spent }
}

interface Redrawn {
	reads: number
	// The stream the redraw drew — the folds over it are kept for as long as it is the same array.
	events: ReadonlyArray<RunEvent> | undefined
}

interface Redraws {
	// The stream the first frame drew.
	events: ReadonlyArray<RunEvent> | undefined
	spent: Array<Redrawn>
}

function most_read({ spent }: Redraws): number {
	return Math.max(...spent.map(({ reads }) => reads))
}

afterEach(() => vi.restoreAllMocks())

describe('run_board_tick.tick frame budget', () => {
	it('redraws a busy run read again reading less than one fold of its stream', async () => {
		expect(most_read(await redraws_read())).toBeLessThan(READ_BUDGET)
	})

	it('draws the stream it folded first while each read hands over the same stream', async () => {
		const { events, spent } = await redraws_read()

		expect(events).toHaveLength(EVENTS)
		for (const redrawn of spent) expect(redrawn.events).toBe(events)
	})

	it('reads past the budget on every redraw when each read hands the stream over afresh', async () => {
		const { spent } = await redraws_read(true)

		for (const { reads } of spent) expect(reads).toBeGreaterThanOrEqual(READ_BUDGET)
	})
})
