import { markdown_section } from './markdown-section'

// joshuafolkken/kit#4007: a follow-up measurement filed with `auto-ok` ("measure three days after #N
// merges") was offered by `backlog:next` the day it was filed, and its lane could only hand the hold
// back. The body now names the earliest time the work can start, and the pickup holds the issue until
// then. One UTC spelling only — a date a reader has to guess the zone of is not a deadline.

const BACKGROUND_HEADING = '## 背景'
const PREFIX = '- 実施可能日:'
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/u
// What `toISOString` writes after the minutes the declaration spells.
const ISO_TAIL = ':00.000Z'
const MALFORMED = `\`${PREFIX}\` must be a UTC time written YYYY-MM-DDTHH:MMZ`

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

function is_due(body: string | undefined, now: number = Date.now()): boolean {
	const date = date_of(body)

	return date === undefined || Date.parse(date) <= now
}

// The declared time as epoch milliseconds while it is still ahead, or `undefined` when the issue is due —
// for a reader that spells the time its own way (`run:board` in the local zone).
function waiting_ms(body: string | undefined, now: number = Date.now()): number | undefined {
	if (is_due(body, now)) return undefined

	return Date.parse(String(date_of(body)))
}

// The declared time as written while it is still ahead, or `undefined` when the issue is due.
function waiting_date(body: string | undefined, now: number = Date.now()): string | undefined {
	return is_due(body, now) ? undefined : date_of(body)
}

// Why `backlog:next` holds an issue back, or `undefined` when it is due. The caller cites the issue.
function waiting_reason(body: string | undefined, now: number = Date.now()): string | undefined {
	const date = waiting_date(body, now)

	return date === undefined ? undefined : `not before ${date}`
}

function problems(body: string): ReadonlyArray<string> {
	const value = declared_value(body)

	return value === undefined || is_valid(value) ? [] : [MALFORMED]
}

const issue_not_before = { is_due, problems, waiting_date, waiting_ms, waiting_reason }

export { issue_not_before }
