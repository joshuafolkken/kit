import { issue_cite } from '#scripts/issue/issue-cite'
import { lane_await } from '#scripts/lane/lane-await'
import { lane_state } from '#scripts/lane/lane-state'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_merge_cut_release } from './run-merge-cut-release'

const HUMAN_REVIEW = 'human-review'

// A lane the child's own `run:hold --human-review-stop` already recorded stands as it is: the table's
// `merge` event moves only an open or running lane (joshuafolkken/kit#8775).
async function is_retained(issue: string): Promise<boolean> {
	const record = await lane_state.read_state(issue)

	if (record?.state === HUMAN_REVIEW) return true
	const retained = await lane_state.record_change({
		issue,
		state: HUMAN_REVIEW,
		command: 'run:merge',
	})

	return retained.kind === 'written'
}

// A child may exit before its stop marker: retain its lane before settling its dispatch.
async function retain(issue: string): Promise<boolean> {
	if (!(await is_retained(issue))) return false

	if (lane_await.process_trace_default(issue) === 'none') {
		await run_merge_cut_release.release(issue)
	}

	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.HUMAN_REVIEW,
		`${issue_cite.plain_for('program', issue)} waiting for human review`,
	)

	return true
}

const run_merge_human_review = { retain }

export { run_merge_human_review }
