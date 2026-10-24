import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_merge, type ChildOutcome } from './run-merge'

// joshuafolkken/kit#3908: the readings `run:merge` takes beside a returned child's GitHub state — a
// person's withdrawal among them — and the outcome they decide.

const events_mock = vi.hoisted(() => vi.fn())
const closing_pr_mock = vi.hoisted(() => vi.fn())
const merged_mock = vi.hoisted(() => vi.fn())
const restart_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { current_events: events_mock },
}))

vi.mock('#scripts/issue/issue-closing-pr', () => ({
	issue_closing_pr: { read_closing_pr: closing_pr_mock },
}))

vi.mock('#scripts/issue/issue-merged', () => ({
	issue_merged: { read_merge_state: merged_mock },
}))

vi.mock('./run-merge-steps', () => ({
	run_merge_steps: { has_resumable_cut: vi.fn().mockResolvedValue(false) },
}))

vi.mock('./run-merge-ship', () => ({
	run_merge_ship: { is_unanswered: vi.fn().mockResolvedValue(false) },
}))

vi.mock('./run-merge-restart', () => ({
	run_merge_restart: { is_host_restart: restart_mock },
}))

const { run_merge_signals } = await import('./run-merge-signals')

const CHILD = '3908'
const CONTEXT = { child: CHILD, output: undefined }
const OPEN_READ = {
	kind: 'state',
	state: { state: 'OPEN', labels: [], is_human_review: false },
} as const
const CLOSED_READ = {
	kind: 'state',
	state: { state: 'CLOSED', labels: [], is_human_review: false },
} as const
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
	restart_mock.mockReset().mockResolvedValue(false)
})

// joshuafolkken/kit#4540: six children a host restart killed were each counted a failure, and the
// third tripped the failure guard.
const RESTARTED = ['4497', '4509', '4513', '4516']

async function outcome_of_child(child: string): Promise<ChildOutcome> {
	const context = { ...CONTEXT, child }
	const signals = await run_merge_signals.read_signals(context as Context, OPEN_READ)

	return run_merge_signals.outcome_of(OPEN_READ, signals)
}

// The failures the children's outcomes add to the carry record, in the order `run:merge` reads them.
async function failures_of(children: ReadonlyArray<string>): Promise<number> {
	const outcomes = await Promise.all(children.map(async (child) => await outcome_of_child(child)))

	return outcomes.filter((outcome) => run_merge.change_of(outcome)?.failures !== undefined).length
}

describe('run_merge_signals — children a host restart killed', () => {
	it('reads a killed child as an outage left out of the run-wide streak', async () => {
		restart_mock.mockResolvedValue(true)

		expect(await signals_of(OPEN_READ)).toMatchObject({ is_outage: true, is_streak_exempt: true })
	})

	it('does not trip the failure guard however many the restart killed', async () => {
		restart_mock.mockResolvedValue(true)

		expect(run_merge.is_guard_tripped(await failures_of(RESTARTED))).toBe(false)
	})

	it('still counts a child that ended itself a failure', async () => {
		expect(await failures_of(RESTARTED)).toBe(RESTARTED.length)
	})
})

// joshuafolkken/kit#4765: a child re-dispatched up to the cap was parked as its ship's stop alone.
describe('run_merge_signals — a child the re-dispatch cap stopped', () => {
	const OUTAGES = Array.from({ length: run_merge.CONSECUTIVE_OUTAGE_LIMIT }, (_, index) =>
		event(index, 'outage'),
	)
	const RELAUNCH_FAILED = {
		...(event(OUTAGES.length, 'relaunch-failed') as object),
		text: `#${CHILD} could not be relaunched: the broker refused it`,
	}

	it('reads a capped child as failed with the cap, the count and the last relaunch failure', async () => {
		restart_mock.mockResolvedValue(true)
		events_mock.mockResolvedValue([...OUTAGES, RELAUNCH_FAILED])

		const signals = (await signals_of(OPEN_READ)) as { is_outage: boolean; capped_note: string }

		expect(signals.is_outage).toBe(false)
		expect(signals.capped_note).toContain('re-dispatch cap (3) after 3 re-dispatches')
		expect(signals.capped_note).toContain(RELAUNCH_FAILED.text)
	})

	it('leaves a child under the cap re-dispatchable with no cap line', async () => {
		restart_mock.mockResolvedValue(true)
		events_mock.mockResolvedValue(OUTAGES.slice(1))

		const signals = await signals_of(OPEN_READ)

		expect(signals).toMatchObject({ is_outage: true })
		expect(signals).not.toHaveProperty('capped_note')
	})
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

	it('reads the merged closing pull request of an open child', async () => {
		closing_pr_mock.mockResolvedValue('3920')

		expect(await signals_of(OPEN_READ)).toMatchObject({ merged_pr: '3920' })
	})

	it('skips the timeline when the state could not be read', async () => {
		await signals_of(UNREAD)

		expect(closing_pr_mock).not.toHaveBeenCalled()
	})
})

describe('run_merge_signals.read_signals — a closed withdrawn child', () => {
	beforeEach(() => {
		events_mock.mockResolvedValue([event(1, LAUNCH), event(2, WITHDRAW)])
	})

	it('reads a withdrawn child closed as not planned as withdrawn', async () => {
		expect(await signals_of(CLOSED_READ)).toMatchObject({ is_withdrawn: true })
		expect(merged_mock).toHaveBeenCalledWith(CHILD)
	})

	it('does not read a withdrawal on a child that merged before it was stopped', async () => {
		merged_mock.mockResolvedValue(true)

		expect(await signals_of(CLOSED_READ)).toMatchObject({ is_withdrawn: false })
	})

	it('leaves the withdrawal unset when its timeline could not be read', async () => {
		merged_mock.mockResolvedValue(undefined)

		expect(await signals_of(CLOSED_READ)).toMatchObject({ is_withdrawn: undefined })
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

	it('asks again about a withdrawn child whose merge could not be read', () => {
		const outcome = run_merge_signals.outcome_of(CLOSED_READ, { is_outage: false, is_cut: false })

		expect(outcome).toBe('unresolved')
	})
})
