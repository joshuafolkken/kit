import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#3017: a child that parked itself has its `in-progress` dropped, as a failed child's
// is — left on, it outlived the `needs-decision` a person lifted and held the backlog.

const read_issue_mock = vi.hoisted(() => vi.fn())
const unmark_mock = vi.hoisted(() => vi.fn())
const record_merge_mock = vi.hoisted(() => vi.fn())
const do_failed_mock = vi.hoisted(() => vi.fn())
const emit_mock = vi.hoisted(() => vi.fn())
const events_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: { read_issue: read_issue_mock },
}))

vi.mock('#scripts/issue/issue-closing-pr', () => ({
	issue_closing_pr: { read_closing_pr: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('#scripts/issue/issue-merged', () => ({
	issue_merged: { read_merged: vi.fn().mockResolvedValue(false) },
}))

vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { emit: emit_mock, current_events: events_mock },
}))

vi.mock('#scripts/lane/lane-ledger', () => ({
	lane_ledger: { record_merge: record_merge_mock },
}))

vi.mock('./run-merge-steps', () => ({
	run_merge_steps: {
		ask_next: vi.fn().mockResolvedValue('2039'),
		do_failed: do_failed_mock,
		do_merged: vi.fn().mockResolvedValue(undefined),
		has_resumable_cut: vi.fn().mockResolvedValue(false),
		is_over_budget: vi.fn().mockResolvedValue(false),
		refused_carry: vi.fn().mockResolvedValue(undefined),
		resume_cut: vi.fn().mockResolvedValue(false),
	},
}))
vi.mock('#scripts/run/run-label', () => ({ run_label: { unmark: unmark_mock } }))

const { run_merge_cli } = await import('./run-merge-cli')

const CHILD = '2987'
const IN_PROGRESS = 'in-progress'
const NEEDS_DECISION = 'needs-decision'
const CLOSED_STATE = { kind: 'state', state: { state: 'CLOSED', labels: [] } }

function context(): NonNullable<ReturnType<typeof run_merge_cli.parse>> {
	const ctx = run_merge_cli.parse([CHILD])

	if (ctx === undefined) throw new Error('unparsable test arguments')

	return ctx
}

function open_with(labels: ReadonlyArray<string>): unknown {
	return { kind: 'state', state: { state: 'OPEN', labels } }
}

beforeEach(() => {
	read_issue_mock.mockReset()
	unmark_mock.mockReset().mockResolvedValue(true)
	record_merge_mock.mockReset().mockResolvedValue(undefined)
	do_failed_mock.mockReset()
	emit_mock.mockReset().mockResolvedValue(undefined)
	events_mock.mockReset().mockResolvedValue([])
})

// joshuafolkken/kit#3908: a child a person withdrew is settled by `lane:withdraw`, so `run:merge` offers
// the next child and counts, parks and records nothing — whatever GitHub's state reads.
describe('run_merge_cli.merge_child — a child a person withdrew', () => {
	const WITHDRAW_EVENT = {
		pos: 1,
		at: '2026-10-16T00:00:00.000Z',
		kind: 'withdraw',
		text: `#${CHILD} withdrawn by a person: x`,
	}

	it.each([
		['OPEN', open_with([IN_PROGRESS])],
		['CLOSED', CLOSED_STATE],
	])('offers the next child for a withdrawn %s issue', async (_label, state) => {
		read_issue_mock.mockResolvedValue(state)
		events_mock.mockResolvedValue([WITHDRAW_EVENT])

		const result = await run_merge_cli.merge_child(context())

		expect(result).toStrictEqual({ outcome: 'withdrawn', token: '2039', code: 0, is_offer: true })
		expect(do_failed_mock).not.toHaveBeenCalled()
		expect(record_merge_mock).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#3502: a child released to wait on an open blocker is settled without a count, so
// the next child is offered and the failure guard is never read.
describe('run_merge_cli.merge_child — a child waiting on an open blocker', () => {
	it('offers the next child and puts the wait on the stream', async () => {
		read_issue_mock.mockResolvedValue(open_with([IN_PROGRESS]))
		do_failed_mock.mockResolvedValue({
			carry: undefined,
			is_parked: false,
			is_refused: false,
			blockers: ['#3501'],
		})

		const result = await run_merge_cli.merge_child(context())

		expect(result).toStrictEqual({ outcome: 'failed', token: '2039', code: 0, is_offer: true })
		expect(emit_mock).toHaveBeenCalledWith('park', `#${CHILD} waiting on #3501`)
	})
})

describe('run_merge_cli.merge_child — in-progress on a settled child', () => {
	it.each([NEEDS_DECISION, 'already-done'])(
		'drops in-progress from a child parked with %s',
		async (label) => {
			read_issue_mock.mockResolvedValue(open_with([IN_PROGRESS, label]))

			const result = await run_merge_cli.merge_child(context())

			expect(result.outcome).toBe('parked')
			expect(unmark_mock).toHaveBeenCalledWith(CHILD)
		},
	)

	it('leaves the label of a merged child to the merge step', async () => {
		read_issue_mock.mockResolvedValue(CLOSED_STATE)

		const result = await run_merge_cli.merge_child(context())

		expect(result.outcome).toBe('merged')
		expect(unmark_mock).not.toHaveBeenCalled()
	})

	// joshuafolkken/kit#3355: the lane-limit measurement counts merges from the ledger.
	it('records a merged child in the lane ledger', async () => {
		read_issue_mock.mockResolvedValue(CLOSED_STATE)

		await run_merge_cli.merge_child(context())

		expect(record_merge_mock).toHaveBeenCalledWith(Number(CHILD))
	})

	it('records nothing for a parked child', async () => {
		read_issue_mock.mockResolvedValue(open_with([IN_PROGRESS, NEEDS_DECISION]))

		await run_merge_cli.merge_child(context())

		expect(record_merge_mock).not.toHaveBeenCalled()
	})
})
