import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import type { QuotaReading, QuotaWindow } from './run-board-quota-read'

// How much of each usage window one task spends (joshuafolkken/kit#5508). A lane child works one
// issue, so each done file is one task; a file still being written has done only part of it, so it
// tells nothing. The windows are shared by every session, so the sample's rise is measured once
// across its done files and divided by them (joshuafolkken/kit#5770): a file whose readings did not
// rise is still a task done (joshuafolkken/kit#5618), and a window that reset is measured inside the
// newest file's last reset.

const MS_PER_MINUTE = 60_000
// A window whose two resets lie within half its length is the same window, its reset only jittered.
const HALF = 2
// A done file's last line: a Claude session's `result`, a Codex turn's `task_complete`. A lane log
// that a resumed session appends to again reads as not done once it is written past that line.
const CLAUDE_END = z.looseObject({ type: z.literal('result') })
const CODEX_END = z.looseObject({ payload: z.looseObject({ type: z.literal('task_complete') }) })

function last_line(text: string): string {
	const trimmed = text.trimEnd()

	return trimmed.slice(trimmed.lastIndexOf('\n') + 1)
}

function claude_done(tail: string): boolean {
	return json_value.parse_with(last_line(tail), CLAUDE_END) !== undefined
}

function codex_done(tail: string): boolean {
	return json_value.parse_with(last_line(tail), CODEX_END) !== undefined
}

// Each window's spend per task, by its length in minutes.
type Spent = Readonly<Record<number, number>>
// A done file's readings, its head's oldest first and its tail's last; a file not done holds none.
type QuotaSpan = ReadonlyArray<QuotaReading>

function is_same_window(start: QuotaWindow, end: QuotaWindow): boolean {
	const drift = Math.abs(end.resets_ms - start.resets_ms)

	return start.minutes === end.minutes && drift < (end.minutes * MS_PER_MINUTE) / HALF
}

function span_of(heads: ReadonlyArray<QuotaReading>, tail: QuotaReading | undefined): QuotaSpan {
	return tail === undefined ? [] : [...heads, tail]
}

// The windows each span's last reading holds, newest span first.
function ends_of(spans: ReadonlyArray<QuotaSpan>): Array<QuotaWindow> {
	return spans.flatMap((span) => span.at(-1)?.windows ?? [])
}

// The windows of `span` inside the same reset as `end`.
function windows_in(span: QuotaSpan, end: QuotaWindow): Array<QuotaWindow> {
	return span.flatMap((reading) => reading.windows).filter((window) => is_same_window(window, end))
}

// The meter is shared by every session, so concurrent lanes each rise by all of their overlap: the
// sample's rise is read once across its files, from the lowest reading to the highest inside the
// newest file's last reset, and shared by the files read inside it (joshuafolkken/kit#5770).
function rise_per_task(spans: ReadonlyArray<QuotaSpan>, minutes: number): Array<[number, number]> {
	const end = ends_of(spans).find((window) => window.minutes === minutes)

	if (end === undefined) return []

	const told = spans.map((span) => windows_in(span, end)).filter((windows) => windows.length > 0)
	const used = told.flat().map((window) => window.used_percent)
	const rise = Math.max(...used) - Math.min(...used)

	return rise > 0 ? [[minutes, rise / told.length]] : []
}

// Each window's spend per task over the spans of the sample's done files, newest first; a window that
// did not rise across them tells nothing.
function per_task_of(spans: ReadonlyArray<QuotaSpan>): Spent {
	const lengths = new Set(ends_of(spans).map((window) => window.minutes))

	return Object.fromEntries([...lengths].flatMap((minutes) => rise_per_task(spans, minutes)))
}

const run_board_quota_spent = { claude_done, codex_done, per_task_of, span_of }

export { run_board_quota_spent }
export type { QuotaSpan, Spent }
