#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { cli_flags } from '#scripts/lib/cli-flags'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import {
	review_finding_ledger,
	type CategoryCount,
	type SeverityCount,
} from './review-finding-ledger'

// `josh review:findings [--period <days>]` — the reader over the review-finding ledger. It
// prints each recurring category's count, most frequent first, and the number of rounds that recorded
// zero findings — the denominator that tells a genuinely quiet category apart from one nobody looked
// at. `--period` narrows both to the last `<days>` and splits each category by severity, since an
// all-time count dominated by low findings hides what starts a fix round (joshuafolkken/kit#7130).
// The write half is `pnpm josh review:record`; both read one grammar from `review-finding-ledger`.

const NO_FINDINGS = 'no review findings recorded yet'
const OPTIONS = { period: { type: 'string' } } as const
const USAGE = 'usage: josh review:findings [--period <days>]'
const MS_PER_DAY = 86_400_000
// `process.argv` holds the runtime and the script before the command's own arguments.
const FIRST_ARGUMENT = 2
// `period_of`'s answer for a run with no `--period` — never a valid period, which is positive.
const ALL_TIME = 0

function count_line(entry: CategoryCount): string {
	return `  ${entry.category}: ${String(entry.count)}`
}

function zero_line(zero_rounds: number): string {
	return `zero-finding rounds recorded: ${String(zero_rounds)}`
}

function format_report(counts: ReadonlyArray<CategoryCount>, zero_rounds: number): string {
	if (counts.length === 0) return zero_rounds === 0 ? NO_FINDINGS : zero_line(zero_rounds)

	const body = counts.map((entry) => count_line(entry)).join('\n')

	return `findings by category:\n${body}\n${zero_line(zero_rounds)}`
}

function severity_line(entry: SeverityCount): string {
	return `  ${entry.category}: high ${String(entry.high)} · medium ${String(entry.medium)} · low ${String(entry.low)}`
}

function format_period_report(
	counts: ReadonlyArray<SeverityCount>,
	zero_rounds: number,
	since: string,
): string {
	if (counts.length === 0) return zero_rounds === 0 ? NO_FINDINGS : zero_line(zero_rounds)

	const body = counts.map((entry) => severity_line(entry)).join('\n')

	return `findings by category and severity since ${since}:\n${body}\n${zero_line(zero_rounds)}`
}

// The `--period` days, `ALL_TIME` when the flag is absent, `undefined` for an unknown flag or a value
// that is not a positive whole number of days.
function period_of(argv: ReadonlyArray<string>): number | undefined {
	const values = cli_flags.values_of(argv, OPTIONS)

	if (values === undefined) return undefined

	return values.period === undefined ? ALL_TIME : cli_flags.to_positive(values.period)
}

// The first ledger date inside the last `days` — the boundary day counts, as the ledger dates by day.
function since_of(days: number, now_ms: number): string {
	return observation_ledger_home.ledger_date(new Date(now_ms - days * MS_PER_DAY))
}

function report_of(content: string, days: number, now_ms: number): string {
	if (days === ALL_TIME) {
		return format_report(
			review_finding_ledger.category_counts(content),
			review_finding_ledger.zero_round_count(content),
		)
	}

	const since = since_of(days, now_ms)
	const counts = review_finding_ledger.severity_counts(content, since)

	return format_period_report(counts, review_finding_ledger.zero_round_count(content, since), since)
}

function refuse(): number {
	console.error(USAGE)

	return 1
}

// Every issue's file of the ledger directory is counted: a recurring category
// is one whichever issue recorded each sighting.
async function print_report(root: string, days: number, now_ms: number): Promise<number> {
	const content = (await observation_ledger_home.read(root)) ?? ''

	console.info(report_of(content, days, now_ms))

	return 0
}

async function run(
	argv: ReadonlyArray<string> = [],
	root: string = observation_ledger_home.ledger_root(),
	now_ms: number = Date.now(),
): Promise<number> {
	const days = period_of(argv)

	return days === undefined ? refuse() : await print_report(root, days, now_ms)
}

function command_arguments(): ReadonlyArray<string> {
	return process.argv.slice(FIRST_ARGUMENT)
}

async function main(): Promise<void> {
	process.exitCode = await run(command_arguments())
}

const review_findings_cli = { NO_FINDINGS, USAGE, format_report, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export { review_findings_cli }
