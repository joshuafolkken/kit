import type { SessionFile } from '#scripts/cost-runtime/cost-transcript'
import { stamped_memo } from '#scripts/lib/stamped-memo'
import { delivered_rules } from './delivered-rules'
import { rule_rephrase } from './rule-rephrase'
import { rule_value_runs, type Tally } from './rule-value-runs'

// `josh rule:value --weekly <rule-id>...` — the named rules' reached / refused / rephrased, one line per
// week, so a rule's refusals read before and after the week it was changed (joshuafolkken/kit#7332).
//
// **A run is never split across weeks**: it counts in the week its newest file was last written, the
// same run unit the cumulative table reads. Weeks open on Monday 00:00 UTC.

const WEEKLY_FLAG = '--weekly'
const WEEKLY_USAGE =
	'usage: josh rule:value --weekly <rule-id>... [--period <days>] — one or more measured rule ids'
const FLAG_PREFIX = '--'
const MS_PER_DAY = 86_400_000
const DAYS_PER_WEEK = 7
// The Unix epoch fell on a Thursday, three days after the Monday that opens its week.
const EPOCH_AFTER_MONDAY_DAYS = 3
const WEEK_MS = DAYS_PER_WEEK * MS_PER_DAY
const EPOCH_OFFSET_MS = EPOCH_AFTER_MONDAY_DAYS * MS_PER_DAY
const DATE_LENGTH = 'YYYY-MM-DD'.length
const INDENT = '  '
const COLUMN_GAP = '  '

type Runs = ReadonlyMap<string, ReadonlyArray<SessionFile>>

interface WeekTally {
	label: string
	tally: Tally
}

function week_start(ms: number): number {
	return ms - ((ms + EPOCH_OFFSET_MS) % WEEK_MS)
}

// The ids following `--weekly` up to the next flag, or `undefined` when there are none or one is not
// a measured rule — a misspelt id would otherwise print a trend of zeros.
function requested_ids(argv: ReadonlyArray<string>): Array<string> | undefined {
	const start = argv.indexOf(WEEKLY_FLAG) + 1
	const end = argv.findIndex((value, index) => index >= start && value.startsWith(FLAG_PREFIX))
	const ids = argv.slice(start, end === -1 ? undefined : end)
	const known = new Set(delivered_rules.MEASURED_RULES.map((rule) => rule.id))

	return ids.length > 0 && ids.every((id) => known.has(id)) ? ids : undefined
}

function run_week(files: ReadonlyArray<SessionFile>): number {
	return week_start(Math.max(...files.map((file) => file.modified_ms)))
}

// The runs grouped by week, oldest first.
function by_week(runs: Runs): Array<[number, Map<string, ReadonlyArray<SessionFile>>]> {
	const weeks = new Map<number, Map<string, ReadonlyArray<SessionFile>>>()

	for (const [owner, files] of runs) {
		const week = run_week(files)
		const owned = weeks.get(week) ?? new Map<string, ReadonlyArray<SessionFile>>()

		owned.set(owner, files)
		weeks.set(week, owned)
	}

	return [...weeks].toSorted(([left], [right]) => left - right)
}

// Each week's tally, read into a memo of its own as `--period` is: the stored counts hold whole runs.
function tallies(runs: Runs): Array<WeekTally> {
	return by_week(runs)
		.map(([week, owned]) => ({
			label: new Date(week).toISOString().slice(0, DATE_LENGTH),
			tally: rule_value_runs.tally(rule_value_runs.summaries_of(owned, stamped_memo.create())),
		}))
		.filter((week) => week.tally.runs > 0)
}

function week_line(id: string, { label, tally }: WeekTally): string {
	const reading = tally.readings.find((candidate) => candidate.id === id)
	const counts: Array<[string, number]> = [
		['reached', reading?.sessions ?? 0],
		['refused', reading?.refusals ?? 0],
		['rephrased', rule_rephrase.rephrased_of(id, tally.rephrased)],
	]
	const columns = counts.map(([name, count]) => `${name} ${String(count)}`)

	return INDENT + [label, ...columns].join(COLUMN_GAP)
}

// One block per rule: its id, then a line per week. `undefined` when no week holds a read run.
function render(weeks: ReadonlyArray<WeekTally>, ids: ReadonlyArray<string>): string | undefined {
	if (weeks.length === 0) return undefined

	return ids.map((id) => [id, ...weeks.map((week) => week_line(id, week))].join('\n')).join('\n\n')
}

const rule_value_trend = {
	by_week,
	render,
	requested_ids,
	tallies,
	week_start,
	WEEKLY_FLAG,
	WEEKLY_USAGE,
}

export { rule_value_trend }
export type { WeekTally }
