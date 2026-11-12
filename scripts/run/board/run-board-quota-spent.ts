import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import type { QuotaReading, QuotaWindow } from './run-board-quota-read'

// How much of each usage window one task spends (joshuafolkken/kit#5508). A lane child works one
// issue, so each done lane is one task; Codex rollouts in the same lane share one task. Files without
// lanes each count as one task; a file still being written tells nothing. The windows are shared
// by every session, so the sample's rise is measured once across its done lanes and divided by
// them (joshuafolkken/kit#5770): a file whose readings did not
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

interface QuotaTask {
	span: QuotaSpan
	lane: string | undefined
}

interface QuotaEnd {
	end_ms: number
	lane: string | undefined
}

// Marks arrive newest first: prepend older spans so a lane's newest reading stays last.
function lane_spans(tasks: ReadonlyArray<QuotaTask>): Array<QuotaSpan> {
	const lanes = new Map<string | QuotaTask, QuotaSpan>()

	for (const task of tasks) {
		const key = task.lane ?? task

		lanes.set(key, [...task.span, ...(lanes.get(key) ?? [])])
	}

	return [...lanes.values()]
}

function lane_ends(ends: ReadonlyArray<QuotaEnd>): Array<number> {
	const lanes = new Map<string | QuotaEnd, number>()

	for (const end of ends) {
		const key = end.lane ?? end

		lanes.set(key, Math.max(end.end_ms, lanes.get(key) ?? end.end_ms))
	}

	return [...lanes.values()]
}

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

// A window's use as one reading told it, and when.
interface Told {
	used_percent: number
	taken_ms: number | undefined
}

// The uses of `span` inside the same reset as `end`.
function told_in(span: QuotaSpan, end: QuotaWindow): Array<Told> {
	return span.flatMap((reading) =>
		reading.windows
			.filter((window) => is_same_window(window, end))
			.map((window) => ({ used_percent: window.used_percent, taken_ms: reading.taken_ms })),
	)
}

// By use, then by time: the first is the lowest use's earliest reading, the last the highest's latest.
function by_use(left: Told, right: Told): number {
	return left.used_percent - right.used_percent || (left.taken_ms ?? 0) - (right.taken_ms ?? 0)
}

// The tasks the rise from `low` to `high` was spent by: the done lanes whose last reading lies after
// `low` and by `high` (joshuafolkken/kit#5826), so a resumed lane's head read hours back does not
// share the lanes done since among the sample alone; the sample's own count where untimed or none.
function tasks_in(low: Told, high: Told, ends: ReadonlyArray<number>, sampled: number): number {
	const { taken_ms: from } = low
	const { taken_ms: to } = high

	if (from === undefined || to === undefined) return sampled

	const done = ends.filter((end_ms) => end_ms > from && end_ms <= to).length

	return done > 0 ? done : sampled
}

// The meter is shared by every session, so concurrent lanes each rise by all of their overlap: the
// sample's rise is read once across its files, from the lowest reading to the highest inside the
// newest file's last reset (joshuafolkken/kit#5770), and shared by the tasks done between them.
function rise_per_task(
	spans: ReadonlyArray<QuotaSpan>,
	minutes: number,
	ends: ReadonlyArray<number>,
): Array<[number, number]> {
	const end = ends_of(spans).find((window) => window.minutes === minutes)

	if (end === undefined) return []

	const told = spans.map((span) => told_in(span, end)).filter((uses) => uses.length > 0)
	const ordered = told.flat().toSorted(by_use)
	const [low, high] = [ordered.at(0), ordered.at(-1)]

	if (low === undefined || high === undefined) return []

	const rise = high.used_percent - low.used_percent

	return rise > 0 ? [[minutes, rise / tasks_in(low, high, ends, told.length)]] : []
}

// Each window's spend per task over the spans of the sample's done files, newest first, and the last
// reading times of the done files read; a window that did not rise across them tells nothing.
function per_task_of(spans: ReadonlyArray<QuotaSpan>, ends: ReadonlyArray<number> = []): Spent {
	const lengths = new Set(ends_of(spans).map((window) => window.minutes))

	return Object.fromEntries([...lengths].flatMap((minutes) => rise_per_task(spans, minutes, ends)))
}

function per_lane_of(tasks: ReadonlyArray<QuotaTask>, ends: ReadonlyArray<QuotaEnd>): Spent {
	return per_task_of(lane_spans(tasks), lane_ends(ends))
}

const run_board_quota_spent = { claude_done, codex_done, per_lane_of, per_task_of, span_of }

export { run_board_quota_spent }
export type { QuotaEnd, QuotaSpan, Spent }
