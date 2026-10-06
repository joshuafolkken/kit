import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#3017: a child that parked itself has its `in-progress` dropped, as a failed child's
// is — left on, it outlived the `needs-decision` a person lifted and held the backlog.

const read_issue_mock = vi.hoisted(() => vi.fn())
const remove_in_progress_mock = vi.hoisted(() => vi.fn())
const record_merge_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: { read_issue: read_issue_mock },
}))

vi.mock('#scripts/issue/issue-closing-pr', () => ({
	issue_closing_pr: { read_closing_pr: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { emit: vi.fn() },
}))

vi.mock('#scripts/lane/lane-ledger', () => ({
	lane_ledger: { record_merge: record_merge_mock },
}))

vi.mock('./run-merge-steps', () => ({
	run_merge_steps: {
		ask_next: vi.fn().mockResolvedValue('2039'),
		do_failed: vi.fn(),
		do_merged: vi.fn().mockResolvedValue(undefined),
		has_resumable_cut: vi.fn().mockResolvedValue(false),
		is_over_budget: vi.fn().mockResolvedValue(false),
		refused_carry: vi.fn().mockResolvedValue(undefined),
		remove_in_progress: remove_in_progress_mock,
		resume_cut: vi.fn().mockResolvedValue(false),
	},
}))

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
	remove_in_progress_mock.mockReset().mockResolvedValue(undefined)
	record_merge_mock.mockReset().mockResolvedValue(undefined)
})

describe('run_merge_cli.merge_child — in-progress on a settled child', () => {
	it.each([NEEDS_DECISION, 'already-done'])(
		'drops in-progress from a child parked with %s',
		async (label) => {
			read_issue_mock.mockResolvedValue(open_with([IN_PROGRESS, label]))

			const result = await run_merge_cli.merge_child(context())

			expect(result.outcome).toBe('parked')
			expect(remove_in_progress_mock).toHaveBeenCalledWith(CHILD)
		},
	)

	it('leaves the label of a merged child to the merge step', async () => {
		read_issue_mock.mockResolvedValue(CLOSED_STATE)

		const result = await run_merge_cli.merge_child(context())

		expect(result.outcome).toBe('merged')
		expect(remove_in_progress_mock).not.toHaveBeenCalled()
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
