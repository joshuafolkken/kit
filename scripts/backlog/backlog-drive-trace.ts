import { issue_cite } from '#scripts/issue/issue-cite'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'

// **The driver's own steps on a child, opened and closed on the stream** (joshuafolkken/kit#6677): a
// pass runs its collections and launches one after another, so a child that finished while siblings
// launched waits for them, and without these lines nothing said what the driver was doing meanwhile.
// They are `lane-phase` traces — `#<N> <step> <edge>` — whose step no reader draws as a phase.

const STEP = { COLLECT: 'collect', LAUNCH: 'launch' } as const
const EDGE = { START: 'start', DONE: 'done', FAILED: 'failed' } as const

type Step = (typeof STEP)[keyof typeof STEP]
type Edge = (typeof EDGE)[keyof typeof EDGE]

function text_of(issue: string, step: Step, edge: Edge): string {
	return `${issue_cite.plain_for('program', issue)} ${step} ${edge}`
}

async function mark(issue: string, step: Step, edge: Edge): Promise<void> {
	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.LANE_PHASE,
		text_of(issue, step, edge),
	)
}

async function traced<T>(issue: string, step: Step, run: () => Promise<T>): Promise<T> {
	await mark(issue, step, EDGE.START)

	try {
		const value = await run()

		await mark(issue, step, EDGE.DONE)

		return value
	} catch (error) {
		await mark(issue, step, EDGE.FAILED)

		throw error
	}
}

const backlog_drive_trace = { STEP, traced }

export { backlog_drive_trace }
