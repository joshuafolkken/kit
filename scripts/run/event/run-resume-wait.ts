import type { EpicChild } from '#scripts/epic/epic-graph'
import { issue_cite } from '#scripts/issue/issue-cite'
import { run_event_scope } from './run-event-scope'
import { run_event_stream, type RunEvent } from './run-event-stream'
import { run_event_stream_emit } from './run-event-stream-emit'

// joshuafolkken/kit#8855: an issue an outage stopped and no launch has restarted since, with why it is
// not restarted yet — the newest `resume-wait` reason, `undefined` before one is recorded.
type ResumeWaits = ReadonlyMap<string, string | undefined>

const KIND = run_event_stream.EVENT_KIND
const SEAT_WAIT = '席待ち'
const BLOCKER_WAIT = '依存待ち'
const REASON_PATTERN = /^#\d+ (?<reason>.+)$/u

function reason_in(text: string): string | undefined {
	return REASON_PATTERN.exec(text)?.groups?.['reason']
}

type Waits = Map<string, string | undefined>

function outage_folded(waits: Waits, issue: string): void {
	waits.set(issue, undefined)
}

function launch_folded(waits: Waits, issue: string): void {
	waits.delete(issue)
}

function reason_folded(waits: Waits, issue: string, text: string): void {
	if (waits.has(issue)) waits.set(issue, reason_in(text))
}

// What each kind does to an issue's wait: an outage opens it, a launch ends it, a reason updates an
// open one. The other kinds leave it.
const FOLDS: ReadonlyMap<string, (waits: Waits, issue: string, text: string) => void> = new Map([
	[KIND.OUTAGE, outage_folded],
	[KIND.CHILD_LAUNCH, launch_folded],
	[KIND.RESUME_WAIT, reason_folded],
])

function folded(waits: Waits, event: RunEvent): void {
	const issue = run_event_scope.issue_named(event)
	if (issue === undefined) return

	FOLDS.get(event.kind)?.(waits, issue, event.text)
}

function awaiting(events: ReadonlyArray<RunEvent>): ResumeWaits {
	const waits: Waits = new Map()

	for (const event of events) folded(waits, event)

	return waits
}

// A blocker in the child's own repository is named by its number alone; the board prints it plain.
function blocker_of(child: EpicChild, blocker: EpicChild['blocked_by'][number]): string {
	const repo = blocker.repo === child.repo ? '' : blocker.repo

	return issue_cite.plain_for('terminal', blocker.number, repo)
}

// A child with a blocker waits on it; one without waits for a free seat.
function reason_of(child: EpicChild): string {
	if (child.blocked_by.length === 0) return SEAT_WAIT
	const blockers = child.blocked_by.map((blocker) => blocker_of(child, blocker))

	return `${BLOCKER_WAIT} ${blockers.join(' ')}`
}

// Each issue's reason is written once per change; `emit_once` would dedupe by kind across issues.
async function record(waits: ResumeWaits, issue: string, reason: string): Promise<void> {
	if (!waits.has(issue) || waits.get(issue) === reason) return

	const text = `${issue_cite.plain_for('program', issue)} ${reason}`

	await run_event_stream_emit.emit(KIND.RESUME_WAIT, text)
}

const run_resume_wait = { BLOCKER_WAIT, SEAT_WAIT, awaiting, reason_of, record }

export type { ResumeWaits }
export { run_resume_wait }
