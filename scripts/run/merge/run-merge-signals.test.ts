import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#3908: the readings `run:merge` takes beside a returned child's GitHub state — a
// person's withdrawal among them — and the outcome they decide.

const events_mock = vi.hoisted(() => vi.fn())
const closing_pr_mock = vi.hoisted(() => vi.fn())
const merged_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { current_events: events_mock },
}))

vi.mock('#scripts/issue/issue-closing-pr', () => ({
	issue_closing_pr: { read_closing_pr: closing_pr_mock },
}))

vi.mock('#scripts/issue/issue-merged', () => ({
	issue_merged: { read_merged: merged_mock },
}))

vi.mock('./run-merge-steps', () => ({
	run_merge_steps: { has_resumable_cut: vi.fn().mockResolvedValue(false) },
}))

vi.mock('./run-merge-ship', () => ({
	run_merge_ship: { is_unanswered: vi.fn().mockResolvedValue(false) },
}))

const { run_merge_signals } = await import('./run-merge-signals')

const CHILD = '3908'
const CONTEXT = { child: CHILD, output: undefined }
const OPEN_READ = { kind: 'state', state: { state: 'OPEN', labels: [] } } as const
const CLOSED_READ = { kind: 'state', state: { state: 'CLOSED', labels: [] } } as const
const UNREAD = { kind: 'unreadable' } as const
const LAUNCH = 'child-launch'
const WITHDRAW = 'withdraw'

function event(pos: number, kind: string): unknown {
	return { pos, at: '2026-10-16T00:00:00.000Z', kind, text: `#${CHILD} ${kind}` }
}

type Context = Parameters<typeof run_merge_signals.read_signals>[0]
type Read = Parameters<typeof run_merge_signals.read_signals>[1]

async function signals_of(read: unknown): Promise<unknown> {
	return await run_merge_signals.read_signals(CONTEXT as Context, read as Read)
}

beforeEach(() => {
	events_mock.mockReset().mockResolvedValue([])
	closing_pr_mock.mockReset().mockResolvedValue(undefined)
	merged_mock.mockReset().mockResolvedValue(false)
})

describe('run_merge_signals.read_signals — the readings beside the GitHub state', () => {
	it('reads a withdrawal that is the newest word on the child', async () => {
		events_mock.mockResolvedValue([event(1, LAUNCH), event(2, WITHDRAW)])

		expect(await signals_of(OPEN_READ)).toMatchObject({
			is_outage: false,
			is_cut: false,
			is_withdrawn: true,
		})
	})

	it('does not read a withdrawal a later launch superseded', async () => {
		events_mock.mockResolvedValue([event(1, WITHDRAW), event(2, LAUNCH)])

		expect(await signals_of(OPEN_READ)).toMatchObject({ is_withdrawn: false })
	})

	it('reads a withdrawn child closed as not planned as withdrawn', async () => {
		events_mock.mockResolvedValue([event(1, LAUNCH), event(2, WITHDRAW)])

		expect(await signals_of(CLOSED_READ)).toMatchObject({ is_withdrawn: true })
		expect(merged_mock).toHaveBeenCalledWith(CHILD)
	})

	it('does not read a withdrawal on a child that merged before it was stopped', async () => {
		events_mock.mockResolvedValue([event(1, LAUNCH), event(2, WITHDRAW)])
		merged_mock.mockResolvedValue(true)

		expect(await signals_of(CLOSED_READ)).toMatchObject({ is_withdrawn: false })
	})

	it('reads the merged closing pull request of an open child', async () => {
		closing_pr_mock.mockResolvedValue('3920')

		expect(await signals_of(OPEN_READ)).toMatchObject({ merged_pr: '3920' })
	})

	it('skips the timeline when the state could not be read', async () => {
		await signals_of(UNREAD)

		expect(closing_pr_mock).not.toHaveBeenCalled()
	})
})

describe('run_merge_signals.outcome_of — the outcome the readings decide', () => {
	it('settles an unread child a person withdrew', () => {
		const outcome = run_merge_signals.outcome_of(UNREAD, {
			is_outage: false,
			is_cut: false,
			is_withdrawn: true,
		})

		expect(outcome).toBe('withdrawn')
	})
})
