import { issue_sample_gate } from './issue-sample-gate'
import { markdown_section } from './markdown-section'

// joshuafolkken/kit#4007: a follow-up measurement filed with `auto-ok` ("measure three days after #N
// merges") was offered by `backlog:next` the day it was filed, and its lane could only hand the hold
// back. The body now names the earliest time the work can start, and the pickup holds the issue until
// then. One UTC spelling only — a date a reader has to guess the zone of is not a deadline.
// A body may instead wait on samples recorded after a pull request merged (`issue-sample-gate.ts`);
// this module answers for both, so every reader holds an issue back the same way.

const BACKGROUND_HEADING = '## 背景'
const PREFIX = '- 実施可能日:'
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/u
// What `toISOString` writes after the minutes the declaration spells.
const ISO_TAIL = ':00.000Z'
// The refusal ends in a line ready to paste (joshuafolkken/kit#5225); a far-future date, so the
// example never reads as already due.
const EXAMPLE = `${PREFIX} 2099-01-01T09:00Z`
const MALFORMED = `\`${PREFIX}\` must be a UTC time written YYYY-MM-DDTHH:MMZ\n${EXAMPLE}`
const HEADING_MARKS = /^#{1,6}\s+/u
// joshuafolkken/kit#4438: a start condition written as its own heading is never read — every reader
// sees only the declaration line under the background heading — so the issue is offered at once.
const STRAY_HEADINGS = [
	{ name: '実施可能日', declaration: `${PREFIX} YYYY-MM-DDTHH:MMZ` },
	{ name: '実施可能条件', declaration: issue_sample_gate.DECLARATION },
]

// The value after the declaration under the background heading, or `undefined` when the body declares none.
function declared_value(body: string): string | undefined {
	const background = markdown_section.section_lines(body, BACKGROUND_HEADING).join('\n')
	const line = markdown_section
		.unfenced_lines(background)
		.map((text) => text.trim())
		.find((text) => text.startsWith(PREFIX))

	return line?.slice(PREFIX.length).trim()
}

// The round trip refuses a calendar-impossible value (`2026-02-30T09:30Z`, `T24:00Z`) that
// `Date.parse` silently rolls over into a different time.
function is_valid(value: string): boolean {
	if (!DATE_PATTERN.test(value)) return false

	const time = Date.parse(value)

	return !Number.isNaN(time) && new Date(time).toISOString() === `${value.slice(0, -1)}${ISO_TAIL}`
}

// The declared time, or `undefined` when there is none or it does not parse. A malformed date reads as
// absent: `issue:file` refuses it, and holding a hand-edited one forever would lose the issue silently.
function date_of(body = ''): string | undefined {
	const value = declared_value(body)

	return value !== undefined && is_valid(value) ? value : undefined
}

function is_date_due(body: string | undefined, now: number): boolean {
	const date = date_of(body)

	return date === undefined || Date.parse(date) <= now
}

// Whether the issue may start: its declared time has arrived and its declared samples are recorded.
function is_due(body: string | undefined, now: number = Date.now()): boolean {
	return is_date_due(body, now) && issue_sample_gate.wait_of(body) === undefined
}

// The declared time as epoch milliseconds while it is still ahead, or `undefined` when it has arrived —
// for a reader that spells the time its own way (`run:board` in the local zone).
function waiting_ms(body: string | undefined, now: number = Date.now()): number | undefined {
	if (is_date_due(body, now)) return undefined

	return Date.parse(String(date_of(body)))
}

// The declared time as written while it is still ahead, or `undefined` when it has arrived.
function waiting_date(body: string | undefined, now: number = Date.now()): string | undefined {
	return is_date_due(body, now) ? undefined : date_of(body)
}

// Why `backlog:next` holds an issue back, or `undefined` when it is due. The caller cites the issue.
function waiting_reason(body: string | undefined, now: number = Date.now()): string | undefined {
	const date = waiting_date(body, now)

	if (date !== undefined) return `not before ${date}`

	const wait = issue_sample_gate.wait_of(body)

	return wait === undefined ? undefined : issue_sample_gate.reason_of(wait)
}

function stray_heading_problems(body: string): ReadonlyArray<string> {
	const headings = markdown_section
		.unfenced_lines(body)
		.map((line) => line.trim())
		.filter((line) => HEADING_MARKS.test(line))
		.map((line) => line.replace(HEADING_MARKS, ''))

	return STRAY_HEADINGS.filter(({ name }) => headings.some((text) => text.startsWith(name))).map(
		({ name, declaration }) =>
			`heading \`${name}\` is not read — declare it under \`${BACKGROUND_HEADING}\` as \`${declaration}\``,
	)
}

function problems(body: string): ReadonlyArray<string> {
	const value = declared_value(body)
	const date_problems = value === undefined || is_valid(value) ? [] : [MALFORMED]

	return [...stray_heading_problems(body), ...date_problems, ...issue_sample_gate.problems(body)]
}

const issue_not_before = { is_due, problems, waiting_date, waiting_ms, waiting_reason }

export { issue_not_before }
