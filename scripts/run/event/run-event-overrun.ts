import { issue_cite } from '#scripts/issue/issue-cite'

// The notes an overrun investigation leaves on the run's event stream (joshuafolkken/kit#4751): its
// start, naming the session's pid, and its end — the session's result or the launch's failure.
// `lane-overrun.ts` writes them and `run:board` reads them back, both through this module, so the two
// never spell them differently.

// What a note says of the investigation of `issue`. A start note that launched no session is neither.
type OverrunNote =
	{ kind: 'started'; issue: number; pid: number } | { kind: 'ended'; issue: number }

const STARTED_PATTERN = /^#(?<issue>\d+) overran: .* — investigating in pid (?<pid>\d+)$/u
const ENDED_PATTERN = /^#(?<issue>\d+) overrun(?: investigation failed)?: /u

// The start note's opening, which a merge collected again reads to launch no second session.
function started_prefix(issue: number): string {
	return `${issue_cite.plain(issue)} overran:`
}

function started_text(issue: number, minutes: number, outcome: string): string {
	return `${started_prefix(issue)} ${String(minutes)} min net — ${outcome}`
}

// The start note's outcome for a launched session.
function investigating(pid: number): string {
	return `investigating in pid ${String(pid)}`
}

function ended_text(issue: number, result: string): string {
	return `${issue_cite.plain(issue)} overrun: ${result}`
}

function failed_text(issue: number, note: string): string {
	return `${issue_cite.plain(issue)} overrun investigation failed: ${note}`
}

function parse(text: string): OverrunNote | undefined {
	const started = STARTED_PATTERN.exec(text)?.groups

	if (started !== undefined) {
		return { kind: 'started', issue: Number(started['issue']), pid: Number(started['pid']) }
	}

	const ended = ENDED_PATTERN.exec(text)?.groups

	return ended === undefined ? undefined : { kind: 'ended', issue: Number(ended['issue']) }
}

const run_event_overrun = {
	ended_text,
	failed_text,
	investigating,
	parse,
	started_prefix,
	started_text,
}

export { run_event_overrun }
export type { OverrunNote }
