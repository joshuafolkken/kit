import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_merge_steps_fixture } from './run-merge-steps-fixture'

// joshuafolkken/kit#4734: a merged child is put on record once, dated to the merge's confirmation
// rather than to the end of the sync.

const emit_mock = vi.hoisted(() => vi.fn())
const recorded_mock = vi.hoisted(() => vi.fn())
const record_merge_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: {
		read_issue: vi
			.fn()
			.mockResolvedValue({ kind: 'state', state: { state: 'CLOSED', labels: [] } }),
	},
}))
vi.mock('#scripts/issue/issue-closing-pr')
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: {
		emit: emit_mock,
		current_events: vi.fn().mockResolvedValue([]),
		invocation_or_all_events: recorded_mock,
	},
}))
vi.mock('#scripts/lane/lane-ledger', () => ({ lane_ledger: { record_merge: record_merge_mock } }))
vi.mock('./run-merge-steps', () => ({
	run_merge_steps: {
		ask_next: vi.fn().mockResolvedValue('2039'),
		do_merged: vi.fn(),
		has_resumable_cut: vi.fn().mockResolvedValue(false),
		is_over_budget: vi.fn().mockResolvedValue(false),
		refused_carry: vi.fn().mockResolvedValue(undefined),
	},
}))
vi.mock('#scripts/run/run-label', () => ({ run_label: { unmark: vi.fn() } }))

const { run_merge_cli } = await import('./run-merge-cli')
const { run_merge_steps } = await import('./run-merge-steps')

const CHILD = '4734'
const MERGE_TEXT = `#${CHILD} merged`
const { CONFIRMED_AT } = run_merge_steps_fixture

function context(): NonNullable<ReturnType<typeof run_merge_cli.parse>> {
	const ctx = run_merge_cli.parse([CHILD])

	if (ctx === undefined) throw new Error('unparsable test arguments')

	return ctx
}

beforeEach(() => {
	vi.mocked(run_merge_steps.do_merged).mockImplementation(run_merge_steps_fixture.record_merged)
	emit_mock.mockReset().mockResolvedValue(undefined)
	recorded_mock.mockReset().mockResolvedValue([])
	record_merge_mock.mockReset().mockResolvedValue(undefined)
})

describe('run_merge_cli.merge_child — putting a merged child on record', () => {
	it('writes the merge event and the ledger entry for a merge not yet on record', async () => {
		await run_merge_cli.merge_child(context())

		expect(emit_mock).toHaveBeenCalledWith('merge', MERGE_TEXT, CONFIRMED_AT)
		expect(record_merge_mock).toHaveBeenCalledWith(Number(CHILD), CONFIRMED_AT)
	})

	it('writes neither again for a merge already on the stream', async () => {
		recorded_mock.mockResolvedValue([{ kind: 'merge', text: MERGE_TEXT }])

		await run_merge_cli.merge_child(context())

		expect(emit_mock).not.toHaveBeenCalledWith('merge', expect.anything())
		expect(record_merge_mock).not.toHaveBeenCalled()
	})

	it('records a merge whose stream holds only another child’s merge', async () => {
		recorded_mock.mockResolvedValue([{ kind: 'merge', text: '#4714 merged' }])

		await run_merge_cli.merge_child(context())

		expect(record_merge_mock).toHaveBeenCalledWith(Number(CHILD), CONFIRMED_AT)
	})
})
