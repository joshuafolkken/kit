import { issue_cite } from '#scripts/issue/issue-cite'
import { run_event_stream, type RunEvent } from './run-event-stream'

// The `resume` event `run:cut --resume` appends when it adopts a cut. Both cuts append one, so
// `josh lane:stats` times a resumed session to its next progress (joshuafolkken/kit#8583); the text
// tells them apart: `#N resumed` back into implementation, `#N resumed (gate)` into the gate.
const GATE_SUFFIX = ' (gate)'

function resumed_prefix(issue: string): string {
	return `${issue_cite.plain_for('program', issue)} resumed`
}

function resume_text(issue: string): string {
	return resumed_prefix(issue)
}

function gate_resume_text(issue: string): string {
	return `${resumed_prefix(issue)}${GATE_SUFFIX}`
}

function is_resume(event: RunEvent): boolean {
	return event.kind === run_event_stream.EVENT_KIND.RESUME
}

function is_resume_of(event: RunEvent, issue: string): boolean {
	return is_resume(event) && event.text.startsWith(resumed_prefix(issue))
}

function is_gate_resume(event: RunEvent): boolean {
	return is_resume(event) && event.text.endsWith(GATE_SUFFIX)
}

const run_event_resume = { gate_resume_text, is_gate_resume, is_resume_of, resume_text }

export { run_event_resume }
