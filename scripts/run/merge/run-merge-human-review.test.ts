import { lane_state } from '#scripts/lane/lane-state'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, expect, it, vi } from 'vitest'
import { run_merge_human_review } from './run-merge-human-review'

vi.mock('#scripts/lane/lane-state')
vi.mock('#scripts/run/event/run-event-stream-emit')

const ISSUE = '5410'

afterEach(() => vi.clearAllMocks())

it('does not settle a dispatch whose lane state could not be recorded', async () => {
	vi.mocked(lane_state.record_change).mockResolvedValue({ kind: 'skipped', reason: 'write failed' })

	expect(await run_merge_human_review.retain(ISSUE)).toBe(false)
	expect(run_event_stream_emit.emit).not.toHaveBeenCalled()
})
