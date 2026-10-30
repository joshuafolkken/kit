import { issue_cite } from '#scripts/issue/issue-cite'
import { lane_state } from '#scripts/lane/lane-state'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'

// A child may exit before its stop marker: retain its lane before settling its dispatch.
async function retain(issue: string): Promise<boolean> {
	const retained = await lane_state.record_change({
		issue,
		state: 'human-review',
		command: 'run:merge',
	})

	if (retained.kind !== 'written') return false

	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.HUMAN_REVIEW,
		`${issue_cite.plain(issue)} waiting for human review`,
	)

	return true
}

const run_merge_human_review = { retain }

export { run_merge_human_review }
