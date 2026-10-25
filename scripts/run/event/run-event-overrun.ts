import { issue_cite } from '#scripts/issue/issue-cite'

// The notes an overrun investigation leaves on the run's event stream (joshuafolkken/kit#4751): every
// merged lane's net time, at or under the threshold or over it, or why there is none
// (joshuafolkken/kit#4818); an overrun's start, naming the session's pid and start time; and its end —
// the session's result or the launch's failure. `lane-overrun.ts` writes them and `run:board` reads them
// back, both through this module, so the two never spell them differently.

// What a note says of the investigation of `issue`. `start` is the session's `process_identity` start
// token, which tells the session from a later process holding its pid; a launcher that could not read it
// leaves it off. A start note that launched no session is a failure with its minutes.
type OverrunNote =
	| { kind: 'within'; issue: number; minutes: number }
	| { kind: 'skipped'; issue: number; reason: string }
	| { kind: 'started'; issue: number; minutes: number; pid: number; start: string | undefined }
	| { kind: 'ended'; issue: number; result: string }
	| { kind: 'failed'; issue: number; minutes: number | undefined }

type Groups = Partial<Record<string, string>>

const WITHIN_PATTERN = /^#(?<issue>\d+) net: (?<minutes>\d+) min$/u
const SKIPPED_PATTERN = /^#(?<issue>\d+) overrun skipped: (?<reason>.+)$/u
const OVERRAN_PATTERN = /^#(?<issue>\d+) overran: (?<minutes>\d+) min net — (?<outcome>.*)$/u
const INVESTIGATING_PATTERN = /^investigating in pid (?<pid>\d+)(?: started (?<start>.+))?$/u
const ENDED_PATTERN = /^#(?<issue>\d+) overrun: (?<result>.*)$/u
const FAILED_PATTERN = /^#(?<issue>\d+) overrun investigation failed: /u

// The result an investigation that filed records; the board shows the filings themselves.
const FILED_RESULT = 'filed'
const NONE_LEAD = 'none: '
const RECURRED_PATTERN = /^recurred #(?<number>\d+)/u
// The result of an investigation that appended causes to open Issues, which file no new one
// (joshuafolkken/kit#4858); any it filed besides show as filings.
const FOLDED_LEAD = 'folded '
const FOLDED_SEPARATOR = ','
const FOLDED_PATTERN = /^folded (?<list>#\d+(?:,#\d+)*)/u
const NUMBER_PATTERN = /#(?<number>\d+)/gu

function started_text(issue: number, minutes: number, outcome: string): string {
	return `${issue_cite.plain(issue)} overran: ${String(minutes)} min net — ${outcome}`
}

function within_text(issue: number, minutes: number): string {
	return `${issue_cite.plain(issue)} net: ${String(minutes)} min`
}

function skipped_text(issue: number, reason: string): string {
	return `${issue_cite.plain(issue)} overrun skipped: ${reason}`
}

// The start note's outcome for a launched session.
function investigating(pid: number, start: string | undefined): string {
	const outcome = `investigating in pid ${String(pid)}`

	return start === undefined ? outcome : `${outcome} started ${start}`
}

function ended_text(issue: number, result: string): string {
	return `${issue_cite.plain(issue)} overrun: ${result}`
}

function failed_text(issue: number, note: string): string {
	return `${issue_cite.plain(issue)} overrun investigation failed: ${note}`
}

function none_result(reason: string): string {
	return `${NONE_LEAD}${reason}`
}

function recurred_result(issue: number | string): string {
	return `recurred ${issue_cite.plain(issue)}`
}

// The issue a `recurred #N` result commented on.
function recurred_of(result: string): number | undefined {
	const number = RECURRED_PATTERN.exec(result)?.groups?.['number']

	return number === undefined ? undefined : Number(number)
}

function folded_result(issues: ReadonlyArray<number | string>): string {
	return `${FOLDED_LEAD}${issues.map((issue) => issue_cite.plain(issue)).join(FOLDED_SEPARATOR)}`
}

// The Issues a `folded #A,#B` result appended to, else none; any text after the list is not read.
function folded_of(result: string): ReadonlyArray<number> {
	const list = FOLDED_PATTERN.exec(result)?.groups?.['list'] ?? ''

	return [...list.matchAll(NUMBER_PATTERN)].map((match) => Number(match.groups?.['number']))
}

// The reason a `none: <reason>` result gives, else the result as it is.
function reason_of(result: string): string {
	return result.startsWith(NONE_LEAD) ? result.slice(NONE_LEAD.length) : result
}

function overran(groups: Groups): OverrunNote {
	const issue = Number(groups['issue'])
	const minutes = Number(groups['minutes'])
	const launched = INVESTIGATING_PATTERN.exec(groups['outcome'] ?? '')?.groups

	if (launched === undefined) return { kind: 'failed', issue, minutes }

	return { kind: 'started', issue, minutes, pid: Number(launched['pid']), start: launched['start'] }
}

function within(groups: Groups): OverrunNote {
	return { kind: 'within', issue: Number(groups['issue']), minutes: Number(groups['minutes']) }
}

function skipped(groups: Groups): OverrunNote {
	return { kind: 'skipped', issue: Number(groups['issue']), reason: groups['reason'] ?? '' }
}

function failed(groups: Groups): OverrunNote {
	return { kind: 'failed', issue: Number(groups['issue']), minutes: undefined }
}

function ended(groups: Groups): OverrunNote {
	return { kind: 'ended', issue: Number(groups['issue']), result: groups['result'] ?? '' }
}

const READERS: ReadonlyArray<readonly [RegExp, (groups: Groups) => OverrunNote]> = [
	[WITHIN_PATTERN, within],
	[SKIPPED_PATTERN, skipped],
	[OVERRAN_PATTERN, overran],
	[FAILED_PATTERN, failed],
	[ENDED_PATTERN, ended],
]

function parse(text: string): OverrunNote | undefined {
	for (const [pattern, read] of READERS) {
		const groups = pattern.exec(text)?.groups

		if (groups !== undefined) return read(groups)
	}

	return undefined
}

const run_event_overrun = {
	ended_text,
	failed_text,
	FILED_RESULT,
	folded_of,
	folded_result,
	investigating,
	none_result,
	parse,
	reason_of,
	recurred_of,
	recurred_result,
	skipped_text,
	started_text,
	within_text,
}

export { run_event_overrun }
export type { OverrunNote }
