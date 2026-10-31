import { lane_ledger, type LedgerEntry } from '#scripts/lane/lane-ledger'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it, vi } from 'vitest'
import { backlog_stalled } from './backlog-stalled'
import { backlog_stalled_detect, type DetectPorts } from './backlog-stalled-detect'

const THRESHOLD_MS = 600_000
const NOW_MS = Date.parse('2026-09-22T12:20:00.000Z')
const TARGET = 'josh-run-events-owner-repo.jsonl'
const IDLE_LAUNCH_ISO = '2026-09-22T12:00:00.000Z'
const RECENT_LAUNCH_ISO = '2026-09-22T12:19:00.000Z'
const OPENED_ISO = '2026-09-22T12:05:00.000Z'
const READY = 4
const FREE = 5

function launch(at: string): RunEvent {
	return { pos: 0, at, kind: run_event_stream.EVENT_KIND.CHILD_LAUNCH, text: '' }
}

function mark(at: string, is_offerable: boolean): LedgerEntry {
	return { kind: lane_ledger.KIND.OFFERABLE, at, is_offerable }
}

// Work and a free lane become observable together after the launch, so their age starts there.
const OPEN_EPISODE: ReadonlyArray<LedgerEntry> = [mark(OPENED_ISO, true)]

function ports(overrides: Partial<DetectPorts>): DetectPorts {
	return {
		resolve_target: async () => TARGET,
		read_events: () => [launch(IDLE_LAUNCH_ISO)],
		now_ms: () => NOW_MS,
		free_lane_count: async () => FREE,
		ready_count: async () => READY,
		read_ledger: async () => OPEN_EPISODE,
		mark_offerable: vi.fn<DetectPorts['mark_offerable']>(),
		emit_stall: async () => true,
		...overrides,
	}
}

describe('backlog_stalled_detect.detect_and_report', () => {
	it('reports a stall once work and a free lane have waited together past the threshold', async () => {
		const emit_stall = vi.fn(async () => true)

		const verdict = await backlog_stalled_detect.detect_and_report(
			ports({ emit_stall }),
			THRESHOLD_MS,
		)

		expect(verdict).toBe(backlog_stalled.STALLED)
		expect(emit_stall).toHaveBeenCalledOnce()
	})
})

describe('backlog_stalled_detect.detect_and_report hold reason', () => {
	it('names a memory hold on the stall it reports', async () => {
		const held: LedgerEntry = { kind: lane_ledger.KIND.HELD, at: OPENED_ISO, reason: 'memory' }
		const emit_stall = vi.fn(async (_text: string) => true)

		await backlog_stalled_detect.detect_and_report(
			ports({ read_ledger: async () => [...OPEN_EPISODE, held], emit_stall }),
			THRESHOLD_MS,
		)

		expect(emit_stall).toHaveBeenCalledWith(expect.stringContaining('(held: memory)'))
	})

	// joshuafolkken/kit#4015: a stall resolves at the next dispatch, so it reaches nobody off-screen.
	// Credentials are stubbed so a send would reach `fetch` rather than fail at the missing config first.
	it('sends no Telegram on a stall', async () => {
		vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token')
		vi.stubEnv('TELEGRAM_CHAT_ID', 'chat-id')
		vi.stubEnv('JOSH_NOTIFY', undefined)
		const fetch_spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))

		await backlog_stalled_detect.detect_and_report(ports({}), THRESHOLD_MS)

		expect(fetch_spy).not.toHaveBeenCalled()
		fetch_spy.mockRestore()
		vi.unstubAllEnvs()
	})

	it('is unreadable, with no side effects, when the stream target will not resolve', async () => {
		const emit_stall = vi.fn(async () => true)

		const verdict = await backlog_stalled_detect.detect_and_report(
			ports({ resolve_target: async () => undefined, emit_stall }),
			THRESHOLD_MS,
		)

		expect(verdict).toBe(backlog_stalled.UNREADABLE)
		expect(emit_stall).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4349: the three false stalls of 10-17..10-21, each long past the last launch.
describe('backlog_stalled_detect.detect_and_report ages from when work met a free lane', () => {
	it('reports no stall when work was filed after a stretch with none, and opens the episode', async () => {
		const mark_offerable = vi.fn<DetectPorts['mark_offerable']>()

		const verdict = await backlog_stalled_detect.detect_and_report(
			ports({ read_ledger: async () => [], mark_offerable }),
			THRESHOLD_MS,
		)

		expect(verdict).toBe(backlog_stalled.OK)
		expect(mark_offerable).toHaveBeenCalledWith(true)
	})

	it('reports no stall while a long child runs with no ready work', async () => {
		const mark_offerable = vi.fn<DetectPorts['mark_offerable']>()

		const verdict = await backlog_stalled_detect.detect_and_report(
			ports({ ready_count: async () => 0, read_ledger: async () => [], mark_offerable }),
			THRESHOLD_MS,
		)

		expect(verdict).toBe(backlog_stalled.OK)
		expect(mark_offerable).not.toHaveBeenCalled()
	})

	it('reports no stall right after a released driver restarts', async () => {
		const restarted: ReadonlyArray<LedgerEntry> = [
			mark('2026-09-22T12:02:00.000Z', false),
			{ kind: lane_ledger.KIND.HELD, at: '2026-09-22T12:03:00.000Z', reason: 'offer:wait' },
			{ kind: lane_ledger.KIND.RELEASED, at: RECENT_LAUNCH_ISO },
		]

		const verdict = await backlog_stalled_detect.detect_and_report(
			ports({ read_ledger: async () => restarted }),
			THRESHOLD_MS,
		)

		expect(verdict).toBe(backlog_stalled.OK)
	})
})

describe('backlog_stalled_detect.detect_and_report bounds the episode', () => {
	it('ignores an episode a later launch ended', async () => {
		const verdict = await backlog_stalled_detect.detect_and_report(
			ports({ read_ledger: async () => [mark('2026-09-22T11:00:00.000Z', true)] }),
			THRESHOLD_MS,
		)

		expect(verdict).toBe(backlog_stalled.OK)
	})

	it('closes the open episode once the work is gone', async () => {
		const mark_offerable = vi.fn<DetectPorts['mark_offerable']>()

		const verdict = await backlog_stalled_detect.detect_and_report(
			ports({ ready_count: async () => 0, mark_offerable }),
			THRESHOLD_MS,
		)

		expect(verdict).toBe(backlog_stalled.OK)
		expect(mark_offerable).toHaveBeenCalledWith(false)
	})
})

// The watcher's minute probe opens the episode before the dispatch-age gate would let a stop see it.
describe('backlog_stalled_detect.observe_offerable', () => {
	it('opens the episode inside the dispatch-age gate', async () => {
		const mark_offerable = vi.fn<DetectPorts['mark_offerable']>()
		const recent = ports({
			read_events: () => [launch(RECENT_LAUNCH_ISO)],
			read_ledger: async () => [],
			mark_offerable,
		})

		await backlog_stalled_detect.observe_offerable(true, recent)

		expect(mark_offerable).toHaveBeenCalledWith(true)
	})

	it('records nothing while the observation is unchanged', async () => {
		const mark_offerable = vi.fn<DetectPorts['mark_offerable']>()

		await backlog_stalled_detect.observe_offerable(true, ports({ mark_offerable }))

		expect(mark_offerable).not.toHaveBeenCalled()
	})

	it('drops a failed ledger read rather than raising into the watcher', async () => {
		const failing = ports({
			read_ledger: async () => {
				throw new Error('unreadable')
			},
		})

		await expect(backlog_stalled_detect.observe_offerable(true, failing)).resolves.toBeUndefined()
	})
})

describe('backlog_stalled_detect.detect_and_report short-circuits the costly read', () => {
	it('does not read the backlog when the run is not yet idle', async () => {
		const ready_count = vi.fn(async () => READY)

		const verdict = await backlog_stalled_detect.detect_and_report(
			ports({ read_events: () => [launch(RECENT_LAUNCH_ISO)], ready_count }),
			THRESHOLD_MS,
		)

		expect(verdict).toBe(backlog_stalled.OK)
		expect(ready_count).not.toHaveBeenCalled()
	})

	it('does not read the backlog when every lane is full', async () => {
		const ready_count = vi.fn(async () => READY)

		const verdict = await backlog_stalled_detect.detect_and_report(
			ports({ free_lane_count: async () => 0, ready_count }),
			THRESHOLD_MS,
		)

		expect(verdict).toBe(backlog_stalled.OK)
		expect(ready_count).not.toHaveBeenCalled()
	})
})
