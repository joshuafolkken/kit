import { describe, expect, it } from 'vitest'
import { backlog_budget, type BudgetInput } from './backlog-budget'
import { backlog_drive, type OfferRead } from './backlog-drive'
import { backlog_drive_cli } from './backlog-drive-cli'
import { backlog_drive_fixture } from './backlog-drive-fixture'

// joshuafolkken/kit#3691: one interval between two asks for work, running or idle, and a collected
// child is asked about without waiting it out.

const { CONFIG, FIRST_CHILD, SECOND_CHILD, POLL_MS, harness, state } = backlog_drive_fixture
const WATCHED_INTERVALS = 10
const FINISH_AFTER_POLLS = 2
const WINDOW_POLLS = 3

function asks(calls: ReadonlyArray<string>): number {
	return calls.filter((call) => call === 'offer').length
}

describe('backlog_drive.run_loop — idle expiry', () => {
	it('stops at the idle expiry before a later date without a driver window', async () => {
		const { ports } = harness({})
		const start_ms = ports.now().getTime()
		const offered_elapsed_ms: Array<number> = []

		async function offer(): Promise<OfferRead> {
			const input: BudgetInput = {
				answer: 'exhausted',
				merged: 0,
				running: 0,
				started_at_ms: start_ms,
				active_at_ms: start_ms,
				now_ms: ports.now().getTime(),
				max_issues: undefined,
				idle_budget_ms: CONFIG.offer_ms,
			}

			offered_elapsed_ms.push(input.now_ms - start_ms)

			return {
				...backlog_budget.decide(input),
				issues: [],
				retries: 0,
				not_before_ms: start_ms + CONFIG.offer_ms * WATCHED_INTERVALS,
				idle_until_ms: backlog_budget.idle_until_ms(input),
			}
		}

		await backlog_drive.run_loop(state(), CONFIG, { ...ports, offer })

		expect(ports.now().getTime() - start_ms).toBe(CONFIG.offer_ms)
		expect(offered_elapsed_ms).toStrictEqual([0, CONFIG.offer_ms])
	})
})

describe('backlog_drive.run_loop — a stopped dated wait', () => {
	it('keeps the normal drain interval after a merge stops a dated wait', async () => {
		const { ports } = harness({})
		const stopping = backlog_drive.merge_stopped(FIRST_CHILD, {
			...state([SECOND_CHILD]),
			not_before_ms: ports.now().getTime() - 1,
		})
		const config = { ...CONFIG, window_ms: POLL_MS * WINDOW_POLLS }

		const end = await backlog_drive.run_loop(stopping, config, {
			...ports,
			sleep: async (milliseconds) => {
				expect(milliseconds).toBe(POLL_MS)
				await ports.sleep(milliseconds)
			},
		})

		expect(end.reason).toBe('window')
	})
})

describe('backlog_drive.run_loop — a dated wait', () => {
	it.each([1, WATCHED_INTERVALS])(
		'offers exactly at the deadline after %s polling intervals',
		async (intervals) => {
			const delay_ms = CONFIG.offer_ms * intervals + 1
			const { ports, calls } = harness({
				offers: [
					{
						verdict: 'watch',
						issues: [],
						retries: 0,
						not_before_ms: Date.parse(state().active) + delay_ms,
					},
					{ verdict: 'stop', issues: [], retries: 0 },
				],
			})
			const start_ms = ports.now().getTime()

			await backlog_drive.run_loop(state(), CONFIG, ports)

			expect(ports.now().getTime() - start_ms).toBe(delay_ms)
			expect(asks(calls)).toBe(2)
		},
	)

	it('wakes before the normal interval when the deadline is nearer', async () => {
		const { ports, calls } = harness({
			offers: [
				{ verdict: 'watch', issues: [], retries: 0, not_before_ms: Date.parse(state().active) + 1 },
				{ verdict: 'stop', issues: [], retries: 0 },
			],
		})
		const start_ms = ports.now().getTime()

		await backlog_drive.run_loop(state(), CONFIG, ports)

		expect(ports.now().getTime() - start_ms).toBe(1)
		expect(asks(calls)).toBe(2)
	})
})

describe('backlog_drive.run_loop — a passed dated wait', () => {
	it('asks once per interval while the offer keeps a passed deadline', async () => {
		const { ports, calls } = harness({})
		const passed_ms = ports.now().getTime() - 1

		async function offer(): Promise<OfferRead> {
			calls.push('offer')

			return { verdict: 'watch', issues: [], retries: 0, not_before_ms: passed_ms }
		}

		const window_ms = CONFIG.offer_ms * WATCHED_INTERVALS

		await backlog_drive.run_loop(state(), { ...CONFIG, window_ms }, { ...ports, offer })

		expect(asks(calls)).toBe(WATCHED_INTERVALS + 1)
	})
})

describe('backlog_drive.run_loop — the ask interval', () => {
	it('hands the loop the interval the budget names', () => {
		const config = backlog_drive_cli.loop_config(undefined)

		expect(config.offer_ms).toBe(backlog_budget.OFFER_INTERVAL_MS)
	})

	it('asks once per interval through an idle watch', async () => {
		const { ports, calls } = harness({})
		const window_ms = backlog_budget.OFFER_INTERVAL_MS * WATCHED_INTERVALS

		await backlog_drive.run_loop(state(), { ...CONFIG, window_ms }, ports)

		expect(asks(calls)).toBe(WATCHED_INTERVALS + 1)
	})

	it('asks once per interval while a child is still running', async () => {
		const { ports, calls } = harness({})
		const window_ms = backlog_budget.OFFER_INTERVAL_MS * WATCHED_INTERVALS

		await backlog_drive.run_loop(state([FIRST_CHILD]), { ...CONFIG, window_ms }, ports)

		expect(asks(calls)).toBe(WATCHED_INTERVALS + 1)
	})

	// joshuafolkken/kit#6718: stretching the interval must not delay the re-offer after a merge.
	it('asks at once after a child is collected inside the interval', async () => {
		const { ports, calls } = harness({})
		const finishes_at_ms = ports.now().getTime() + POLL_MS * FINISH_AFTER_POLLS

		expect(POLL_MS * WINDOW_POLLS).toBeLessThan(backlog_budget.OFFER_INTERVAL_MS)

		function is_finished(): boolean {
			return ports.now().getTime() >= finishes_at_ms && !calls.includes(`merge ${FIRST_CHILD}`)
		}

		await backlog_drive.run_loop(
			state([FIRST_CHILD]),
			{ ...CONFIG, window_ms: POLL_MS * WINDOW_POLLS },
			{ ...ports, is_finished },
		)

		expect(calls).toStrictEqual(['offer', `merge ${FIRST_CHILD}`, 'offer'])
	})
})

// joshuafolkken/kit#6788: an issue `run:add` hands the run, and a named issue with no lane running,
// are asked about without waiting out the three minutes.
// joshuafolkken/kit#6861: a `lane:limit` raise is asked about the same way, once per raise.
describe('backlog_drive.run_loop — a run:add or a lane:limit raise', () => {
	const next_poll_ms = POLL_MS * FINISH_AFTER_POLLS

	it.each([
		{ name: 'run:add', script: { added_at_ms: next_poll_ms - 1 } },
		{ name: 'a lane:limit raise', script: { raised_at_ms: next_poll_ms - 1 } },
	])('asks once at the next poll after $name, not after the interval', async ({ script }) => {
		// The #6707 timeline: the first ask waits, and the event is written between two polls.
		const { ports, calls } = harness(script)
		const start_ms = ports.now().getTime()
		const asked_ms: Array<number> = []
		const window_ms = POLL_MS * WINDOW_POLLS

		await backlog_drive.run_loop(
			state(),
			{ ...CONFIG, window_ms },
			{
				...ports,
				offer: async (asked) => {
					asked_ms.push(ports.now().getTime() - start_ms)

					return await ports.offer(asked)
				},
			},
		)

		expect(asks(calls)).toBe(2)
		expect(asked_ms).toStrictEqual([0, next_poll_ms])
	})

	// A lowered or reset limit writes no event, so the next ask waits out the interval.
	it('asks only once inside the interval with no raise', async () => {
		const { ports, calls } = harness({})

		await backlog_drive.run_loop(state(), { ...CONFIG, window_ms: POLL_MS * WINDOW_POLLS }, ports)

		expect(asks(calls)).toBe(1)
	})
})

describe('backlog_drive.run_loop — a named issue with no lane', () => {
	it('asks at the short interval while no lane runs and a named issue is left', async () => {
		const { ports, calls } = harness({ is_named_left: true })
		const window_ms = CONFIG.idle_offer_ms * WATCHED_INTERVALS

		await backlog_drive.run_loop(state(), { ...CONFIG, window_ms }, ports)

		expect(asks(calls)).toBe(WATCHED_INTERVALS + 1)
	})

	it('keeps the full interval while a lane runs, a named issue left or not', async () => {
		const { ports, calls } = harness({ is_named_left: true })
		const window_ms = CONFIG.offer_ms * WATCHED_INTERVALS

		await backlog_drive.run_loop(state([FIRST_CHILD]), { ...CONFIG, window_ms }, ports)

		expect(asks(calls)).toBe(WATCHED_INTERVALS + 1)
	})

	it('hands the loop the short interval the budget names', () => {
		const config = backlog_drive_cli.loop_config(undefined)

		expect(config.idle_offer_ms).toBe(backlog_budget.IDLE_OFFER_INTERVAL_MS)
		expect(config.idle_offer_ms).toBeLessThan(config.offer_ms)
	})
})
