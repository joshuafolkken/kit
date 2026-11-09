import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { json_value } from '#scripts/lib/json-value'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { z } from 'zod'

// The refusals `hook-ledger.ts` wrote over a trailing period, grouped by hook and rule — the counts
// `josh hook:ledger` prints (joshuafolkken/kit#6664).
//
// **One day file is read per day of the period, and the period's start then cuts the oldest.** The
// files are named by UTC day, so a 1-day period may span two of them.

const LEDGER_EXTENSION = '.jsonl'
const HOURS_PER_DAY = 24
const MS_PER_HOUR = 3_600_000
const MS_PER_DAY = HOURS_PER_DAY * MS_PER_HOUR
const KEY_SEPARATOR = '\t'

// The fields a count reads off a `HookLedgerEntry` line; the role and the issue are not counted.
const line_schema = z.object({
	at: z.string(),
	hook: z.string(),
	rule: z.string(),
	tool: z.string(),
	session: z.string(),
	command: z.string(),
})

type LedgerLine = z.infer<typeof line_schema>

interface LedgerGroup {
	hook: string
	rule: string
	lines: ReadonlyArray<LedgerLine>
}

function period_start(period_days: number, now: Date): number {
	return now.getTime() - period_days * MS_PER_DAY
}

// The day files the period touches, oldest first: one more than its whole days, for the partial day.
function day_files(directory: string, period_days: number, now: Date): Array<string> {
	const count = Math.ceil(period_days) + 1
	const days = Array.from({ length: count }, (_, index) =>
		observation_ledger_home.ledger_date(new Date(now.getTime() - (count - 1 - index) * MS_PER_DAY)),
	)

	return days.map((day) => path.join(directory, `${day}${LEDGER_EXTENSION}`))
}

// A day nothing was refused on has no file; it reads as no lines.
async function read_text(file: string): Promise<string> {
	try {
		return await readFile(file, 'utf8')
	} catch {
		return ''
	}
}

function lines_of(text: string): Array<LedgerLine> {
	return text
		.split('\n')
		.map((line) => json_value.parse_with(line, line_schema))
		.filter((line) => line !== undefined)
}

// Every readable ledger line written in the period; a line that is not an entry is skipped.
async function read_lines(
	directory: string,
	period_days: number,
	now: Date,
): Promise<Array<LedgerLine>> {
	const files = day_files(directory, period_days, now)
	const texts = await Promise.all(files.map(async (file) => await read_text(file)))
	const start = period_start(period_days, now)

	return texts.flatMap((text) => lines_of(text)).filter((line) => Date.parse(line.at) >= start)
}

// The lines grouped by hook and rule, the most refusals first.
function group(lines: ReadonlyArray<LedgerLine>): Array<LedgerGroup> {
	const groups = new Map<string, LedgerGroup>()

	for (const line of lines) {
		const key = `${line.hook}${KEY_SEPARATOR}${line.rule}`
		const found = groups.get(key) ?? { hook: line.hook, rule: line.rule, lines: [] }

		groups.set(key, { ...found, lines: [...found.lines, line] })
	}

	return [...groups.values()].toSorted((left, right) => right.lines.length - left.lines.length)
}

const hook_ledger_read = { group, period_start, read_lines }

export { hook_ledger_read }
export type { LedgerGroup, LedgerLine }
