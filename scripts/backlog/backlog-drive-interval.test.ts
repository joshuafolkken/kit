import { describe, expect, it } from 'vitest'
import { backlog_budget } from './backlog-budget'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_cli } from './backlog-drive-cli'
import { backlog_drive_fixture } from './backlog-drive-fixture'

// joshuafolkken/kit#3691: one interval between two asks for work, running or idle, and a collected
// child is asked about without waiting it out.

const { CONFIG, FIRST_CHILD, POLL_MS, harness, state } = backlog_drive_fixture
const WATCHED_INTERVALS = 10
const FINISH_AFTER_POLLS = 2
const WINDOW_POLLS = 3

function asks(calls: ReadonlyArray<string>): number {
	return calls.filter((call) => call === 'offer').length
}

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

	it('asks at once after a child is collected inside the interval', async () => {
		const { ports, calls } = harness({})
		const finishes_at_ms = ports.now().getTime() + POLL_MS * FINISH_AFTER_POLLS

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
