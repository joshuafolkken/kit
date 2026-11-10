import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { parse_json } from '#scripts/git/parse-json-array'
import { lane_breakdown, type Breakdown } from '#scripts/lane/lane-breakdown'
import { lane_net_read } from '#scripts/lane/lane-net-read'
import { cli_flags } from '#scripts/lib/cli-flags'
import { z } from 'zod'
import { cost_audit, type Audit, type AuditWindow, type MergeCounts } from './cost-audit'
import { cost_audit_format } from './cost-audit-format'
import { cost_audit_read, type AuditSession } from './cost-audit-read'

// `josh cost:audit [--period <days>]` — what AI work cost over a period, by session kind, tool
// category and guard, with the cost per merged pull request, set against the period before it. It
// exists so a cost reduction can be watched after it lands rather than measured once by hand: a row
// that grew past the threshold in `cost-audit.ts` is printed as a regression.
//
// **Kit-only.** It reads kit's own transcript store, like `josh retrospective`, which carries its
// summary line.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const USAGE =
	'Usage: pnpm josh cost:audit [--period <days> | --since <YYYY-MM-DD> --until <YYYY-MM-DD>] [--density]'
const DENSITY_FLAG = '--density'
const OPTIONS = {
	period: { type: 'string' },
	since: { type: 'string' },
	until: { type: 'string' },
	density: { type: 'boolean' },
} as const
// A positive whole number of days (`cli_flags.to_positive`), at most ten years.
const MAX_PERIOD_DAYS = 3650
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const ISO_DATE_LENGTH = 10
// GitHub's search qualifier takes an ISO instant without the milliseconds `toISOString` writes.
const MILLISECONDS_PATTERN = /\.\d{3}Z$/u

const search_count_schema = z.object({ total_count: z.number() })

// The period's length in days and the instant it ends.
interface AuditSpan {
	days: number
	now_ms: number
}

interface SpanValues {
	period?: string | undefined
	since?: string | undefined
	until?: string | undefined
}

// An unknown flag or a `--period` with no value is refused, not read as the default period.
function read_period(argv: ReadonlyArray<string>): number | undefined {
	const values = cli_flags.values_of(argv, OPTIONS)

	if (values === undefined) return undefined

	const raw = values.period ?? String(cost_audit.DEFAULT_PERIOD_DAYS)
	const days = cli_flags.to_positive(raw)

	return days !== undefined && days <= MAX_PERIOD_DAYS ? days : undefined
}

// A UTC calendar date's midnight, or `undefined` for anything but a real `YYYY-MM-DD` date.
function date_ms(raw: string): number | undefined {
	if (!DATE_PATTERN.test(raw)) return undefined

	const ms = Date.parse(`${raw}T00:00:00Z`)

	if (Number.isNaN(ms)) return undefined

	return new Date(ms).toISOString().slice(0, ISO_DATE_LENGTH) === raw ? ms : undefined
}

// `--since` through `--until`, both UTC dates and both included, as the period's length and its end;
// the period before is as long, ending where this one opens.
function dated_span(since: string, until: string): AuditSpan | undefined {
	const start = date_ms(since)
	const end = date_ms(until)

	if (start === undefined || end === undefined || end < start) return undefined

	const days = (end - start) / cost_audit.MS_PER_DAY + 1

	return days <= MAX_PERIOD_DAYS ? { days, now_ms: end + cost_audit.MS_PER_DAY } : undefined
}

function relative_span(argv: ReadonlyArray<string>, now_ms: number): AuditSpan | undefined {
	const days = read_period(argv)

	return days === undefined ? undefined : { days, now_ms }
}

// `--since` and `--until` together, never one alone or beside `--period`.
function absolute_span(values: SpanValues): AuditSpan | undefined {
	const { period, since, until } = values

	if (since === undefined || until === undefined || period !== undefined) return undefined

	return dated_span(since, until)
}

// The period the audit reads: the dated pair, or the trailing `--period` ending now.
function read_span(argv: ReadonlyArray<string>, now_ms: number): AuditSpan | undefined {
	const values = cli_flags.values_of(argv, OPTIONS)

	if (values === undefined) return undefined

	const is_dated = values.since !== undefined || values.until !== undefined

	return is_dated ? absolute_span(values) : relative_span(argv, now_ms)
}

function instant(ms: number): string {
	return new Date(ms).toISOString().replace(MILLISECONDS_PATTERN, 'Z')
}

function merged_query(repo: string, window: AuditWindow): string {
	return `repo:${repo} is:pr is:merged merged:${instant(window.start_ms)}..${instant(window.end_ms)}`
}

async function merge_count(repo: string, window: AuditWindow): Promise<number | undefined> {
	const parameters = new URLSearchParams({ q: merged_query(repo, window), per_page: '1' })
	const raw = await git_gh_exec.exec_gh_api({ path: `search/issues?${parameters.toString()}` })

	return parse_json.parse_json_object_or_undefined(raw, search_count_schema)?.total_count
}

// Both periods' merge counts, or `undefined` when GitHub could not be read — the audit then prints
// no per-merge row rather than one divided by a guess.
async function read_merges(days: number, now_ms: number): Promise<MergeCounts | undefined> {
	try {
		const repo = await git_gh_command.repo_get_name_with_owner()

		if (repo === undefined) return undefined

		const [current, previous] = await Promise.all(
			cost_audit.windows_of(days, now_ms).map(async (window) => await merge_count(repo, window)),
		)

		return current === undefined || previous === undefined ? undefined : { current, previous }
	} catch {
		return undefined
	}
}

// Each lane's stages by its Issue, read off the ledger and the run events `josh lane:breakdown` reads; a
// lane the ledger holds no dispatch and merge of has none.
async function read_breakdowns(
	sessions: ReadonlyArray<AuditSession>,
): Promise<Map<number, Breakdown>> {
	const [entries, events] = await Promise.all([
		lane_net_read.read_ledger({}),
		lane_net_read.read_events({}),
	])
	const issues = new Set(sessions.flatMap((session) => session.issue ?? []))
	const pairs = [...issues].map(
		(issue) => [issue, lane_breakdown.of(entries, events, issue)] as const,
	)

	return new Map(pairs.filter((pair): pair is [number, Breakdown] => pair[1] !== undefined))
}

async function measure(cwd: string, days: number, now_ms: number): Promise<Audit> {
	const sessions = cost_audit_read.load(cwd, cost_audit.since_ms(days, now_ms))
	const [merges, breakdowns] = await Promise.all([
		read_merges(days, now_ms),
		read_breakdowns(sessions),
	])

	return cost_audit.audit({ sessions, days, now_ms, merges, breakdowns })
}

// The default period's summary line, for `josh retrospective`, with the filing line a regression adds.
async function summary(cwd: string, now_ms: number = Date.now()): Promise<string> {
	const audit = await measure(cwd, cost_audit.DEFAULT_PERIOD_DAYS, now_ms)

	return [cost_audit_format.summary_line(audit), ...cost_audit_format.filing_lines(audit)].join(
		'\n',
	)
}

// `--density` prints the lane-child density alone, so the number is the output's last line; a period
// with no lane-child request prints nothing, never a zero a declared bound would read as met.
function printed_lines(argv: ReadonlyArray<string>, audit: Audit): Array<string> {
	if (!argv.includes(DENSITY_FLAG)) return cost_audit_format.report_lines(audit)

	const value = cost_audit_format.density_value(audit)

	return value === undefined ? [] : [value]
}

// Nothing to print is a failure: `--density` with no sample exits non-zero, like `lane:value`.
function printed(lines: ReadonlyArray<string>): number {
	for (const line of lines) console.info(line)

	return lines.length > 0 ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
}

async function run(
	argv: ReadonlyArray<string>,
	cwd: string = process.cwd(),
	now_ms: number = Date.now(),
): Promise<number> {
	const span = read_span(argv, now_ms)

	if (span === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	return printed(printed_lines(argv, await measure(cwd, span.days, span.now_ms)))
}

const cost_audit_cli = { USAGE, read_period, read_span, merged_query, run, summary }

export { cost_audit_cli }
