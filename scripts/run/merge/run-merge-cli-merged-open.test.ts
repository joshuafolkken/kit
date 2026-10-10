import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#2769: `run:merge` over a child GitHub merged but left OPEN, and over a cut that
// could not be relaunched — the two paths the park-reason work changed, end to end with the reads and
// side-effect steps mocked.

const read_issue_mock = vi.hoisted(() => vi.fn())
const read_closing_pr_mock = vi.hoisted(() => vi.fn())
const do_merged_mock = vi.hoisted(() => vi.fn())
const do_failed_mock = vi.hoisted(() => vi.fn())
const has_resumable_cut_mock = vi.hoisted(() => vi.fn())
const resume_cut_mock = vi.hoisted(() => vi.fn())
const emit_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: { read_issue: read_issue_mock },
}))

vi.mock('#scripts/issue/issue-closing-pr', () => ({
	issue_closing_pr: { read_closing_pr: read_closing_pr_mock },
}))

vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { emit: emit_mock },
}))

vi.mock('#scripts/lane/lane-ledger', () => ({
	lane_ledger: { record_merge: vi.fn() },
}))

vi.mock('./run-merge-steps', () => ({
	run_merge_steps: {
		CUT_RELAUNCH_CAUSE: 'cut cause',
		ask_next: vi.fn().mockResolvedValue('2039'),
		do_failed: do_failed_mock,
		do_merged: do_merged_mock,
		has_resumable_cut: has_resumable_cut_mock,
		is_over_budget: vi.fn().mockResolvedValue(false),
		refused_carry: vi.fn().mockResolvedValue(undefined),
		resume_cut: resume_cut_mock,
	},
}))
vi.mock('#scripts/run/run-label', () => ({ run_label: { unmark: vi.fn() } }))

const { run_merge_cli } = await import('./run-merge-cli')

const CHILD = '2761'
const PR_URL = 'https://github.com/joshuafolkken/kit/pull/2768'
const OPEN_IN_PROGRESS = { kind: 'state', state: { state: 'OPEN', labels: ['in-progress'] } }

function context(): NonNullable<ReturnType<typeof run_merge_cli.parse>> {
	const ctx = run_merge_cli.parse([CHILD])

	if (ctx === undefined) throw new Error('unparsable test arguments')

	return ctx
}

beforeEach(() => {
	read_issue_mock.mockReset().mockResolvedValue(OPEN_IN_PROGRESS)
	read_closing_pr_mock.mockReset().mockResolvedValue(undefined)
	do_merged_mock.mockReset().mockResolvedValue(undefined)
	do_failed_mock
		.mockReset()
		.mockResolvedValue({ carry: undefined, is_parked: true, is_refused: false, blockers: [] })
	has_resumable_cut_mock.mockReset().mockResolvedValue(false)
	resume_cut_mock.mockReset().mockResolvedValue(false)
	emit_mock.mockReset()
})

describe('run_merge_cli.merge_child — a child merged while its issue stayed OPEN', () => {
	it('handles it as merged with its pull request, never as failed', async () => {
		read_closing_pr_mock.mockResolvedValue(PR_URL)

		const result = await run_merge_cli.merge_child(context())

		expect(result.outcome).toBe('merged')
		expect(do_failed_mock).not.toHaveBeenCalled()
		expect(do_merged_mock).toHaveBeenCalledWith(expect.objectContaining({ merged_pr: PR_URL }))
	})

	it('carries no merged pull request for a child GitHub already closed', async () => {
		read_issue_mock.mockResolvedValue({ kind: 'state', state: { state: 'CLOSED', labels: [] } })
		read_closing_pr_mock.mockResolvedValue(PR_URL)

		const result = await run_merge_cli.merge_child(context())

		expect(result.outcome).toBe('merged')
		expect(read_closing_pr_mock).not.toHaveBeenCalled()
		expect(do_merged_mock).toHaveBeenCalledWith(expect.objectContaining({ merged_pr: undefined }))
	})

	// joshuafolkken/kit#3442: a parent that counted the merge by hand still owes the stream its event.
	it('writes the merge event for a child GitHub already closed', async () => {
		read_issue_mock.mockResolvedValue({ kind: 'state', state: { state: 'CLOSED', labels: [] } })

		await run_merge_cli.merge_child(context())

		expect(emit_mock).toHaveBeenCalledWith('merge', `#${CHILD} merged`)
	})

	it('still parks an OPEN child no merged pull request closes', async () => {
		const result = await run_merge_cli.merge_child(context())

		expect(result.outcome).toBe('failed')
		expect(do_failed_mock).toHaveBeenCalledOnce()
	})
})

describe('run_merge_cli.merge_child — a cut that could not be relaunched', () => {
	it('parks it with the cut cause, so the comment says why', async () => {
		has_resumable_cut_mock.mockResolvedValue(true)

		await run_merge_cli.merge_child(context())

		expect(do_failed_mock).toHaveBeenCalledWith(expect.anything(), 'cut cause')
	})
})
