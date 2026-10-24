import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_ending } from '#scripts/run/run-ending'
import { beforeEach, expect, it, vi } from 'vitest'
import { run_merge_driver } from './run-merge-driver'
import { run_merge_restart } from './run-merge-restart'
import { run_merge_ship } from './run-merge-ship'

// A child interrupted by its environment — its session killed inside a turn, or its ship stopped with
// no relaunch to fix it — is re-dispatched as an outage child is, never parked or counted against the
// failure guard, up to a bound past which it is parked.

const do_failed_mock = vi.hoisted(() => vi.fn())
const do_outage_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: {
		read_issue: vi.fn().mockResolvedValue({
			kind: 'state',
			state: { state: 'OPEN', labels: ['in-progress'] },
		}),
	},
}))

vi.mock('#scripts/issue/issue-closing-pr', () => ({
	issue_closing_pr: { read_closing_pr: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('#scripts/run/run-ending')

vi.mock('./run-merge-ship', () => ({ run_merge_ship: { is_unanswered: vi.fn() } }))

vi.mock('./run-merge-restart', () => ({ run_merge_restart: { is_host_restart: vi.fn() } }))

vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { emit: vi.fn(), current_events: vi.fn() },
}))

vi.mock('./run-merge-steps', () => ({
	run_merge_steps: {
		ask_next: vi.fn().mockResolvedValue('2039'),
		do_failed: do_failed_mock,
		do_outage: do_outage_mock,
		has_resumable_cut: vi.fn().mockResolvedValue(false),
		is_over_budget: vi.fn().mockResolvedValue(false),
	},
}))

vi.mock('#scripts/run/run-label', () => ({ run_label: { unmark: vi.fn() } }))

const { run_merge_cli } = await import('./run-merge-cli')

const CHILD = '3867'
const OUTPUT = '/Users/runner/.kit-lanes/3867/transcript.log'
const FAILED = { carry: { failures: 1 }, is_parked: true, is_refused: false, waits: [] }
const OUTAGE = { pos: 1, at: '2026-10-15T00:00:00.000Z', kind: 'outage', text: `#${CHILD} outage` }

async function merge_child(): Promise<void> {
	const ctx = run_merge_cli.parse([CHILD, '--output', OUTPUT])

	if (ctx === undefined) throw new Error('unparsable test arguments')

	await run_merge_cli.merge_child(ctx)
}

beforeEach(() => {
	vi.mocked(run_ending.ended_mid_turn).mockReturnValue(false)
	vi.mocked(run_merge_ship.is_unanswered).mockResolvedValue(false)
	vi.mocked(run_merge_restart.is_host_restart).mockResolvedValue(false)
	vi.mocked(run_event_stream_emit.current_events).mockResolvedValue([])
	do_outage_mock.mockReset().mockResolvedValue({ carry: { outages: 1 }, is_refused: false })
	do_failed_mock.mockReset().mockResolvedValue(FAILED)
})

it('re-dispatches a child killed inside a turn instead of parking it', async () => {
	vi.mocked(run_ending.ended_mid_turn).mockReturnValue(true)
	await merge_child()

	expect(do_outage_mock).toHaveBeenCalledOnce()
	expect(do_failed_mock).not.toHaveBeenCalled()
})

it('re-dispatches a child whose ship stopped with no relaunch to fix it', async () => {
	vi.mocked(run_merge_ship.is_unanswered).mockResolvedValue(true)
	await merge_child()

	expect(do_outage_mock).toHaveBeenCalledOnce()
	expect(do_outage_mock).toHaveBeenCalledWith(expect.objectContaining({ is_streak_exempt: true }))
})

// joshuafolkken/kit#4540: a restart cleared the transcript, so only the lane's dispatch time tells.
it('re-dispatches a child the host restart killed without adding to the streak', async () => {
	vi.mocked(run_merge_restart.is_host_restart).mockResolvedValue(true)
	vi.mocked(run_ending.ended_mid_turn).mockReturnValue(true)
	await merge_child()

	expect(do_failed_mock).not.toHaveBeenCalled()
	expect(do_outage_mock).toHaveBeenCalledWith(expect.objectContaining({ is_streak_exempt: true }))
})

// joshuafolkken/kit#3974: a child that reached the API is not booked as the environment being down.
it('books a child killed inside a turn as an outage the streak counts', async () => {
	vi.mocked(run_ending.ended_mid_turn).mockReturnValue(true)
	vi.mocked(run_merge_ship.is_unanswered).mockResolvedValue(true)
	await merge_child()

	expect(do_outage_mock).toHaveBeenCalledWith(expect.objectContaining({ is_streak_exempt: false }))
})

it('parks a child once it has been re-dispatched as an outage three times', async () => {
	vi.mocked(run_ending.ended_mid_turn).mockReturnValue(true)
	vi.mocked(run_event_stream_emit.current_events).mockResolvedValue([OUTAGE, OUTAGE, OUTAGE])
	await merge_child()

	expect(do_failed_mock).toHaveBeenCalledOnce()
	expect(do_outage_mock).not.toHaveBeenCalled()
})

it('parks a child that ended on its own', async () => {
	await merge_child()

	expect(do_failed_mock).toHaveBeenCalledOnce()
})

// joshuafolkken/kit#4102: `backlog:drive` branches on the outcome `run` prints under `--driver`.
it('prints the whole result as the line the driver reads back under --driver', async () => {
	const info = vi.spyOn(console, 'info').mockImplementation(vi.fn())

	await run_merge_cli.run([CHILD, '--output', OUTPUT, run_merge_driver.DRIVER_FLAG])

	const line: unknown = info.mock.lastCall?.at(0)

	expect(run_merge_driver.read(String(line))).toMatchObject({ outcome: 'failed' })
})
