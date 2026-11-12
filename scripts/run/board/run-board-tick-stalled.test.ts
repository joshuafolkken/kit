import { RUN_LANE_LABEL, RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_gather } from './run-board-gather'
import type { BoardPlan } from './run-board-layout'
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
const LIVE_IDLE: LocalRead = { ...LOCAL, roots: { supervisor: 1 } }

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

const STALLED = 6425
const BLOCKER = 6474
const REPO = 'joshuafolkken/kit'

// An untouched `run:stalled` child whose native blocked-by `BLOCKER` is open, or closed.
function blocked_plan(open: ReadonlyArray<number>): BoardPlan {
	const labels = [RUN_LANE_LABEL, RUN_STALLED_LABEL]
	const child = {
		number: STALLED,
		repo: REPO,
		state: 'OPEN' as const,
		labels,
		blocked_by: [{ repo: REPO, number: BLOCKER }],
	}

	return {
		waves: { waves: [[child]], unreached: [] },
		tracked: new Map(),
		context: { repo: REPO, titles: new Map([[STALLED, 'blocked']]), open_numbers: new Set(open) },
		labels: new Map([[STALLED, labels]]),
	}
}

// The same child once this run launched and parked it: its row comes from the stream, not the plan.
const TOUCHED: LocalRead = {
	...LIVE_IDLE,
	events: [
		{
			pos: 1,
			at: new Date(START).toISOString(),
			kind: run_event_stream.EVENT_KIND.PARK,
			text: `#${String(STALLED)} parked (run:stalled: session unfinished)`,
		},
	],
}
const RETRY = `→ resume: pnpm josh run:add ${String(STALLED)} --retry`
const CASES = [
	{ name: 'untouched', local: LIVE_IDLE, retry: RETRY },
	{ name: 'parked by this run', local: TOUCHED, retry: `${RETRY} (session unfinished)` },
]
const FORM_CASES = CASES.flatMap((item) =>
	(['screen', 'chat'] as const).map((form) => ({ ...item, form })),
)

describe('run_board_tick stalled child with an open blocker', () => {
	it.each(FORM_CASES)(
		'waits on the blocker instead of the retry: $name in $form (ac-dad5a00c)',
		async ({ local, form }) => {
			const { ports, frames } = harness(local, [blocked_plan([STALLED, BLOCKER])])

			await tick(FRESH_STATE, { ...ports, form })

			expect(frames.at(-1)).toContain(`waiting on #${String(BLOCKER)}`)
			expect(frames.at(-1)).not.toContain('--retry')
		},
	)

	it.each(CASES)('offers the retry once the blocker closes: $name', async ({ local, retry }) => {
		const { ports, frames } = harness(local, [blocked_plan([STALLED])])

		await tick(FRESH_STATE, ports)

		expect(frames.at(-1)).toContain(retry)
	})
})
