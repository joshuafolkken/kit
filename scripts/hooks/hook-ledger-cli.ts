#!/usr/bin/env tsx
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { lane_stats_request } from '#scripts/lane/lane-stats-request'
import { lane_transcript_calls, type ToolCall } from '#scripts/lane/lane-transcript-calls'
import { bounded_pool } from '#scripts/lib/bounded-pool'
import { cli_flags } from '#scripts/lib/cli-flags'
import { hook_ledger } from './hook-ledger'
import { hook_ledger_issues, type InterruptIssue } from './hook-ledger-issues'
import { hook_ledger_read, type LedgerGroup, type LedgerLine } from './hook-ledger-read'

// `josh hook:ledger --period <days>` — the hook ledger's refusals over a trailing period, one row per
// hook and rule (joshuafolkken/kit#6664): how often the rule refused, how many of those refusals the
// same session's same call later went through (an approximation of a wrong refusal), and how many
// `route:interrupt` Issues name the rule.
//
// **A call is matched by its tool and the head the ledger keeps** (`hook_ledger.command_of`, which the
// transcript reader applies to every call too), the ledger carrying no tool-use id; a later call that came back without `is_error` went through.

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh hook:ledger --period <days>'
const NO_LEDGER = 'josh hook:ledger: no hook ledger outside a git repository'
const OPTIONS = { period: { type: 'string' } } as const
const NO_REFUSALS = 'josh hook:ledger: no refusals in the last'
const UNKNOWN = 'unknown'
const ESCAPED_PIPE = String.raw`\|`
const HEADER = ['hook', 'rule', 'refusals', 'passed later', 'interrupts']
const SESSION_READS = 8

interface LedgerContext {
	directory: string | undefined
	now: Date
	read_issues: (start_ms: number) => Promise<ReadonlyArray<InterruptIssue> | undefined>
}

type PassedLines = ReadonlyArray<LedgerLine>

function period_of(argv: ReadonlyArray<string>): number | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)

	if (parsed === undefined || parsed.positionals.length > 0) return undefined

	return lane_stats_request.positive(parsed.values.period)
}

// A session whose transcript is gone, or was never named, reads as no calls.
async function calls_of(session: string): Promise<ReadonlyArray<ToolCall>> {
	try {
		const raw = await readFile(session, 'utf8')

		return lane_transcript_calls.parse({ session_id: session, lane: '' }, raw)
	} catch {
		return []
	}
}

function is_same_call(line: LedgerLine, call: ToolCall): boolean {
	return call.tool === line.tool && call.head === line.command
}

function went_through(line: LedgerLine, calls: ReadonlyArray<ToolCall>): boolean {
	const refused_ms = Date.parse(line.at)

	return calls.some(
		(call) => call.started_ms > refused_ms && call.is_error === false && is_same_call(line, call),
	)
}

// One session's refusals that later went through; its calls are dropped once it is reduced.
async function passed_in(session: string, lines: ReadonlyArray<LedgerLine>): Promise<PassedLines> {
	const calls = await calls_of(session)

	return lines.filter((line) => line.session === session && went_through(line, calls))
}

// Transcripts are read a few at a time, so a long period neither holds every session's calls at once
// nor runs out of file descriptors (a failed read would count as no calls).
async function read_passed(lines: ReadonlyArray<LedgerLine>): Promise<ReadonlySet<LedgerLine>> {
	const sessions = [...new Set(lines.map((line) => line.session))].filter(Boolean)
	const passed = await bounded_pool.bounded_map(
		sessions,
		SESSION_READS,
		async (session) => await passed_in(session, lines),
	)

	return new Set(passed.flat())
}

function row_of(
	group: LedgerGroup,
	passed_lines: ReadonlySet<LedgerLine>,
	issues: ReadonlyArray<InterruptIssue> | undefined,
): Array<string> {
	const passed = group.lines.filter((line) => passed_lines.has(line))
	const interrupts = hook_ledger_issues.count(group.rule, issues)

	return [
		group.hook,
		group.rule,
		String(group.lines.length),
		String(passed.length),
		interrupts === undefined ? UNKNOWN : String(interrupts),
	]
}

// A rule named by its reason's opening may carry a `|`; it is escaped so the row keeps its columns.
function table_line(cells: ReadonlyArray<string>): string {
	const escaped = cells.map((cell) => cell.split('|').join(ESCAPED_PIPE))

	return `| ${escaped.join(' | ')} |`
}

function table(rows: ReadonlyArray<ReadonlyArray<string>>): string {
	const rule = HEADER.map(() => '---')

	return [HEADER, rule, ...rows].map((cells) => table_line(cells)).join('\n')
}

async function report(
	directory: string,
	period_days: number,
	context: LedgerContext,
): Promise<string> {
	const lines = await hook_ledger_read.read_lines(directory, period_days, context.now)

	if (lines.length === 0) return `${NO_REFUSALS} ${String(period_days)} day(s)`

	const start_ms = hook_ledger_read.period_start(period_days, context.now)
	const [passed, issues] = await Promise.all([read_passed(lines), context.read_issues(start_ms)])

	return table(hook_ledger_read.group(lines).map((group) => row_of(group, passed, issues)))
}

function default_context(): LedgerContext {
	return {
		directory: hook_ledger.ledger_directory(),
		now: new Date(),
		read_issues: hook_ledger_issues.read,
	}
}

async function run(
	argv: ReadonlyArray<string>,
	context: LedgerContext = default_context(),
): Promise<number> {
	const period_days = period_of(argv)

	if (period_days === undefined || context.directory === undefined) {
		console.error(period_days === undefined ? USAGE : NO_LEDGER)

		return 1
	}

	console.info(await report(context.directory, period_days, context))

	return 0
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const hook_ledger_cli = { USAGE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { hook_ledger_cli }
export type { LedgerContext }
