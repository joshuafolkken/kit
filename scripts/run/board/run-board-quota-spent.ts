import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import type { QuotaReading, QuotaWindow } from './run-board-quota-read'

// How much of each usage window one task spends (joshuafolkken/kit#5508). A lane child works one
// issue, so once its file is done the rise from its first reading to its last is that task's spend;
// a file still being written has spent only part of it, so it tells nothing. The windows are
// reported in whole percents, so a file whose readings did not rise spent under one percent and is
// counted as spending none (joshuafolkken/kit#5618); a window that reset while the file was written is
// measured from the first reading inside its last reset.

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

// The window `end` closes, as the first of `heads` (oldest first) inside the same reset read it.
function window_start(
	end: QuotaWindow,
	heads: ReadonlyArray<QuotaReading>,
): QuotaWindow | undefined {
	return heads.flatMap((head) => head.windows).find((window) => is_same_window(window, end))
}

function window_spent(
	end: QuotaWindow,
	heads: ReadonlyArray<QuotaReading>,
): Array<[number, number]> {
	const start = window_start(end, heads)

	if (start === undefined) return []

	return [[end.minutes, Math.max(end.used_percent - start.used_percent, 0)]]
}

// The rise of each window from a file's first reading inside its last reset to its last reading;
// `heads` are the readings a file's head holds, oldest first.
function spent_of(heads: ReadonlyArray<QuotaReading>, tail: QuotaReading | undefined): Spent {
	if (tail === undefined) return {}

	return Object.fromEntries(tail.windows.flatMap((window) => window_spent(window, heads)))
}

function mean_of(spends: ReadonlyArray<Spent>, minutes: number): Array<[number, number]> {
	const told = spends.flatMap((spent) => spent[minutes] ?? [])
	const total = told.reduce((sum, spent) => sum + spent, 0)

	return total > 0 ? [[minutes, total / told.length]] : []
}

// Each window's mean spend over the files that tell one; a window none of them rose in tells nothing.
function per_task_of(spends: ReadonlyArray<Spent>): Spent {
	const lengths = new Set(spends.flatMap((spent) => Object.keys(spent).map(Number)))

	return Object.fromEntries([...lengths].flatMap((minutes) => mean_of(spends, minutes)))
}

const run_board_quota_spent = { claude_done, codex_done, per_task_of, spent_of }

export { run_board_quota_spent }
export type { Spent }
