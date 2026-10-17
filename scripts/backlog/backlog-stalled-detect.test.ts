import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it, vi } from 'vitest'
import { backlog_stalled } from './backlog-stalled'
import { backlog_stalled_detect, type DetectPorts } from './backlog-stalled-detect'

const THRESHOLD_MS = 600_000
const NOW_MS = Date.parse('2026-09-22T12:20:00.000Z')
const TARGET = 'josh-run-events-owner-repo.jsonl'
const IDLE_LAUNCH_ISO = '2026-09-22T12:00:00.000Z'
const RECENT_LAUNCH_ISO = '2026-09-22T12:19:00.000Z'
const READY = 4
const FREE = 5

function launch(at: string): RunEvent {
	return { pos: 0, at, kind: run_event_stream.EVENT_KIND.CHILD_LAUNCH, text: '' }
}

function ports(overrides: Partial<DetectPorts>): DetectPorts {
	return {
		resolve_target: async () => TARGET,
		read_events: () => [launch(IDLE_LAUNCH_ISO)],
		now_ms: () => NOW_MS,
		free_lane_count: async () => FREE,
		ready_count: async () => READY,
		emit_stall: async () => true,
		...overrides,
	}
}

describe('backlog_stalled_detect.detect_and_report', () => {
	it('reports a stall and leaves the marker when idle with a free lane', async () => {
		const emit_stall = vi.fn(async () => true)

		const verdict = await backlog_stalled_detect.detect_and_report(
			ports({ emit_stall }),
			THRESHOLD_MS,
		)

		expect(verdict).toBe(backlog_stalled.STALLED)
		expect(emit_stall).toHaveBeenCalledOnce()
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
