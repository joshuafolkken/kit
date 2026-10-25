import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#4916: a child whose issue closed without a merge — not planned, or with no merged
// pull request — is collected as withdrawn: no merge event, no ledger row, no overrun or baseline
// investigation, and its lane is withdrawn through `lane:withdraw`'s path.

const emit_mock = vi.hoisted(() => vi.fn())
const record_merge_mock = vi.hoisted(() => vi.fn())
const investigate_mock = vi.hoisted(() => vi.fn())
const baseline_mock = vi.hoisted(() => vi.fn())
const do_merged_mock = vi.hoisted(() => vi.fn())
const merge_state_mock = vi.hoisted(() => vi.fn())
const withdraw_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: {
		read_issue: vi
			.fn()
			.mockResolvedValue({ kind: 'state', state: { state: 'CLOSED', labels: [] } }),
	},
}))
vi.mock('#scripts/issue/issue-closing-pr')
vi.mock('#scripts/issue/issue-merged', () => ({
	issue_merged: { read_merge_state: merge_state_mock },
}))
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: {
		emit: emit_mock,
		current_events: vi.fn().mockResolvedValue([]),
		invocation_or_all_events: vi.fn().mockResolvedValue([]),
	},
}))
vi.mock('#scripts/lane/lane-ledger', () => ({ lane_ledger: { record_merge: record_merge_mock } }))
vi.mock('#scripts/lane/lane-overrun', () => ({ lane_overrun: { investigate: investigate_mock } }))
vi.mock('#scripts/lane/lane-baseline', () => ({ lane_baseline: { investigate: baseline_mock } }))
vi.mock('#scripts/lane/lane-withdraw', () => ({
	lane_withdraw: { withdraw: withdraw_mock, describe: vi.fn().mockReturnValue('withdrawn') },
}))
vi.mock('./run-merge-steps', () => ({
	run_merge_steps: {
		ask_next: vi.fn().mockResolvedValue('2039'),
		do_merged: do_merged_mock,
		has_resumable_cut: vi.fn().mockResolvedValue(false),
		is_over_budget: vi.fn().mockResolvedValue(false),
		refused_carry: vi.fn().mockResolvedValue(undefined),
	},
}))
vi.mock('#scripts/run/run-label', () => ({ run_label: { unmark: vi.fn() } }))

const { run_merge_cli } = await import('./run-merge-cli')

const CHILD = '4906'

function context(): NonNullable<ReturnType<typeof run_merge_cli.parse>> {
	const ctx = run_merge_cli.parse([CHILD])

	if (ctx === undefined) throw new Error('unparsable test arguments')

	return ctx
}

beforeEach(() => {
	emit_mock.mockReset().mockResolvedValue(undefined)
	record_merge_mock.mockReset().mockResolvedValue(undefined)
	investigate_mock.mockReset().mockResolvedValue(undefined)
	baseline_mock.mockReset().mockResolvedValue(undefined)
	do_merged_mock.mockReset().mockResolvedValue(undefined)
	merge_state_mock.mockReset().mockResolvedValue(false)
	withdraw_mock.mockReset().mockResolvedValue({ kind: 'closed' })
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('run_merge_cli.merge_child — a child whose issue closed without a merge', () => {
	it('is collected as withdrawn and offers the next child', async () => {
		const result = await run_merge_cli.merge_child(context())

		expect(result).toStrictEqual({ outcome: 'withdrawn', token: '2039', code: 0, is_offer: true })
	})

	it('writes no merge event, no ledger row and asks no investigation', async () => {
		await run_merge_cli.merge_child(context())

		expect(do_merged_mock).not.toHaveBeenCalled()
		expect(emit_mock).not.toHaveBeenCalled()
		expect(record_merge_mock).not.toHaveBeenCalled()
		expect(investigate_mock).not.toHaveBeenCalled()
		expect(baseline_mock).not.toHaveBeenCalled()
	})

	it('withdraws its lane through lane:withdraw', async () => {
		await run_merge_cli.merge_child(context())

		expect(withdraw_mock).toHaveBeenCalledWith(CHILD, expect.any(String), 'merge')
	})

	it('asks to retry, offering no child, when the withdrawal could not read it', async () => {
		withdraw_mock.mockResolvedValue({ kind: 'unreadable' })

		const result = await run_merge_cli.merge_child(context())

		expect(result).toStrictEqual({ outcome: 'withdrawn', token: 'retry', code: 1, is_offer: false })
	})

	it('still merges a child a merge closed', async () => {
		merge_state_mock.mockResolvedValue(true)

		const result = await run_merge_cli.merge_child(context())

		expect(result.outcome).toBe('merged')
		expect(do_merged_mock).toHaveBeenCalled()
		expect(withdraw_mock).not.toHaveBeenCalled()
	})
})
