import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_gather } from './run-board-gather'
import type { LocalRead } from './run-board-read'
import { run_board_tick } from './run-board-tick'

const { LOCAL, START, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const { LOCAL_READ_MS } = run_board_gather
const EVENTS = [
	{
		pos: 1,
		at: new Date(START).toISOString(),
		kind: run_event_stream.EVENT_KIND.PARK,
		text: '#1 parked (run:stalled: review failed)',
	},
]
const LIVE: LocalRead = { ...LOCAL, events: EVENTS, roots: { supervisor: 1 } }
const LIVE_RETRY = '→ resume: pnpm josh run:add 1 --retry (review failed)'

describe('run_board_tick stalled retry', () => {
	it.each([true, false])(
		'uses the live supervisor with plan loaded %s (ac-e2571bf1)',
		async (has_plan) => {
			const plans = has_plan ? [plan_titled('stalled')] : [undefined]
			const { ports, frames } = harness(LIVE, plans)

			await tick(FRESH_STATE, ports)

			expect(frames.at(-1)).toContain(LIVE_RETRY)
		},
	)

	it('uses the live parent when the supervisor is absent', async () => {
		const local = { ...LIVE, roots: { parent: 1 } }
		const { ports, frames } = harness(local, [plan_titled('stalled')])

		await tick(FRESH_STATE, ports)

		expect(frames.at(-1)).toContain(LIVE_RETRY)
	})

	it.each<Partial<LocalRead>>([{ roots: {} }, { ended_ms: START }, { is_stranded: true }])(
		'switches the same event to standalone after the run loses liveness: %s',
		async (stopped) => {
			const { ports, frames, read_local, clock } = harness(LIVE, [plan_titled('stalled')])
			const first = await tick(FRESH_STATE, ports)

			read_local.mockResolvedValue({ ...LIVE, ...stopped })
			clock.now_ms += LOCAL_READ_MS
			await tick(first, ports)

			expect(frames.at(-1)).toContain('→ resume: fullrun #1 (review failed)')
		},
	)
})
