import { lane_stats } from '#scripts/lane/lane-stats'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import type { QuotaReading, QuotaWindow } from './run-board-quota-read'

// How much of each usage window one task spends (joshuafolkken/kit#5508). A lane child works one
// issue, so once its file is done the rise from its first reading to its last is that task's spend;
// a file still being written has spent only part of it, so it tells nothing. The windows are
// reported in whole percents, so a file whose readings did not rise tells nothing and is left out;
// a window that reset between the two readings is left out too.

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

// Each window's spend in one file, by its length in minutes.
type Spent = Readonly<Record<number, number>>

function is_same_window(start: QuotaWindow, end: QuotaWindow): boolean {
	const drift = Math.abs(end.resets_ms - start.resets_ms)

	return start.minutes === end.minutes && drift < (end.minutes * MS_PER_MINUTE) / HALF
}

function window_spent(end: QuotaWindow, head: QuotaReading): Array<[number, number]> {
	const start = head.windows.find((window) => is_same_window(window, end))

	if (start === undefined) return []

	const spent = end.used_percent - start.used_percent

	return spent > 0 ? [[end.minutes, spent]] : []
}

// The rise of each window from a file's first reading to its last.
function spent_of(head: QuotaReading | undefined, tail: QuotaReading | undefined): Spent {
	if (head === undefined || tail === undefined) return {}

	return Object.fromEntries(tail.windows.flatMap((window) => window_spent(window, head)))
}

function median_of(spends: ReadonlyArray<Spent>, minutes: number): Array<[number, number]> {
	const median = lane_stats.median(spends.flatMap((spent) => spent[minutes] ?? []))

	return median === undefined ? [] : [[minutes, median]]
}

// Each window's median spend over the files that tell one.
function per_task_of(spends: ReadonlyArray<Spent>): Spent {
	const lengths = new Set(spends.flatMap((spent) => Object.keys(spent).map(Number)))

	return Object.fromEntries([...lengths].flatMap((minutes) => median_of(spends, minutes)))
}

const run_board_quota_spent = { claude_done, codex_done, per_task_of, spent_of }

export { run_board_quota_spent }
export type { Spent }
