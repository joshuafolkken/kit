import { NEEDS_HUMAN_MERGE_LABEL } from '#scripts/issue/issue-labels'
import { lane_state } from '#scripts/lane/lane-state'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { expect, it, vi } from 'vitest'
import { run_merge } from './run-merge'
import { run_merge_human_review } from './run-merge-human-review'

vi.mock('#scripts/lane/lane-state')
vi.mock('#scripts/run/event/run-event-stream-emit')

const ISSUE = '5410'

it('does not settle a dispatch whose lane state could not be recorded', async () => {
	vi.mocked(lane_state.record_change).mockResolvedValue({ kind: 'skipped', reason: 'write failed' })

	expect(await run_merge_human_review.retain(ISSUE)).toBe(false)
	expect(run_event_stream_emit.emit).not.toHaveBeenCalled()
})

it('waits for an OPEN human merge without counting failure or outage', () => {
	const outcome = run_merge.classify_child(
		{ state: 'OPEN', labels: [NEEDS_HUMAN_MERGE_LABEL.toUpperCase()], is_human_review: false },
		{ is_outage: true, is_cut: false },
	)

	expect(outcome).toBe('human-review')
	expect(run_merge.change_of(outcome)).toBeUndefined()
})

it('counts the manually merged child even with the human merge label', () => {
	const outcome = run_merge.classify_child({
		state: 'CLOSED',
		labels: [NEEDS_HUMAN_MERGE_LABEL],
		is_human_review: false,
	})

	expect(outcome).toBe('merged')
	expect(run_merge.change_of(outcome)).toStrictEqual({ merged: 1 })
})
