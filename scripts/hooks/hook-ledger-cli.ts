#!/usr/bin/env tsx
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { lane_stats_request } from '#scripts/lane/lane-stats-request'
import { lane_transcript_calls, type ToolCall } from '#scripts/lane/lane-transcript-calls'
import { bounded_pool } from '#scripts/lib/bounded-pool'
import { cli_flags } from '#scripts/lib/cli-flags'
import { hook_demoted } from './hook-demoted'
import { hook_ledger } from './hook-ledger'
import { hook_ledger_demote } from './hook-ledger-demote'
import { hook_ledger_issues, type InterruptIssue } from './hook-ledger-issues'
import { hook_ledger_read, type LedgerGroup, type LedgerLine } from './hook-ledger-read'

// `josh hook:ledger --period <days>` — the hook ledger's refusals over a trailing period, one row per
// hook and rule (joshuafolkken/kit#6664): how often the rule refused, how many of those refusals the
// same session's same call later went through (an approximation of a wrong refusal), and how many
// `route:interrupt` Issues name the rule. `--demote [--apply]` and `--restore <rule>` act on those
// counts instead (joshuafolkken/kit#6591, `hook-ledger-demote.ts`).
//
// **A call is matched by its tool and the head the ledger keeps** (`hook_ledger.command_of`, which the
// transcript reader applies to every call too), the ledger carrying no tool-use id; a later call that came back without `is_error` went through.

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh hook:ledger --period <days> [--demote [--apply]] | --restore <rule>'
const NO_LEDGER = 'josh hook:ledger: no hook ledger outside a git repository'
const OPTIONS = {
	period: { type: 'string' },
	demote: { type: 'boolean' },
	apply: { type: 'boolean' },
	restore: { type: 'string' },
} as const
const NO_REFUSALS = 'josh hook:ledger: no refusals in the last'
const UNKNOWN = 'unknown'
const ESCAPED_PIPE = String.raw`\|`
const HEADER = ['hook', 'rule', 'refusals', 'passed later', 'interrupts']
const SESSION_READS = 8

interface LedgerContext {
	directory: string | undefined
	now: Date
	read_issues: (start_ms: number) => Promise<ReadonlyArray<InterruptIssue> | undefined>
	demoted_file: string
}

interface LedgerValues {
	period?: string | undefined
	demote?: boolean | undefined
	apply?: boolean | undefined
	restore?: string | undefined
}

interface LedgerRequest {
	period_days: number
	is_demote: boolean
	should_apply: boolean
}

type PassedLines = ReadonlyArray<LedgerLine>

function values_of(argv: ReadonlyArray<string>): LedgerValues | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)

	return parsed === undefined || parsed.positionals.length > 0 ? undefined : parsed.values
}

// `--apply` only beside `--demote`, which reads the period the table does.
function request_of(values: LedgerValues): LedgerRequest | undefined {
	const period_days = lane_stats_request.positive(values.period)
	const is_demote = values.demote === true
	const should_apply = values.apply === true

	if (period_days === undefined || (should_apply && !is_demote)) return undefined

	return { period_days, is_demote, should_apply }
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

async function table_report(
	lines: ReadonlyArray<LedgerLine>,
	period_days: number,
	context: LedgerContext,
): Promise<string> {
	const start_ms = hook_ledger_read.period_start(period_days, context.now)
	const [passed, issues] = await Promise.all([read_passed(lines), context.read_issues(start_ms)])

	return table(hook_ledger_read.group(lines).map((group) => row_of(group, passed, issues)))
}

async function demote_report(
	lines: ReadonlyArray<LedgerLine>,
	should_apply: boolean,
	context: LedgerContext,
): Promise<string> {
	const passed = await read_passed(lines)
	const rules = hook_ledger_demote.candidates(hook_ledger_read.group(lines), passed)

	return await hook_ledger_demote.report(rules, should_apply, context.demoted_file)
}

async function report(
	directory: string,
	request: LedgerRequest,
	context: LedgerContext,
): Promise<string> {
	const { period_days } = request
	const lines = await hook_ledger_read.read_lines(directory, period_days, context.now)

	if (lines.length === 0) return `${NO_REFUSALS} ${String(period_days)} day(s)`

	return request.is_demote
		? await demote_report(lines, request.should_apply, context)
		: await table_report(lines, period_days, context)
}

function default_context(): LedgerContext {
	return {
		directory: hook_ledger.ledger_directory(),
		now: new Date(),
		read_issues: hook_ledger_issues.read,
		demoted_file: hook_demoted.DEMOTED_FILE,
	}
}

function refused(message: string): number {
	console.error(message)

	return 1
}

// `--restore <rule>` stands alone: it reads no ledger, so a period beside it is a usage error.
async function restore(
	values: LedgerValues,
	rule: string,
	context: LedgerContext,
): Promise<number> {
	if (Object.keys(values).length > 1) return refused(USAGE)

	console.info(await hook_ledger_demote.restore(rule, context.demoted_file))

	return 0
}

async function answer(values: LedgerValues, context: LedgerContext): Promise<number> {
	if (values.restore !== undefined) return await restore(values, values.restore, context)

	const request = request_of(values)

	if (request === undefined) return refused(USAGE)
	if (context.directory === undefined) return refused(NO_LEDGER)

	console.info(await report(context.directory, request, context))

	return 0
}

async function run(
	argv: ReadonlyArray<string>,
	context: LedgerContext = default_context(),
): Promise<number> {
	const values = values_of(argv)

	return values === undefined ? refused(USAGE) : await answer(values, context)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const hook_ledger_cli = { USAGE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { hook_ledger_cli }
export type { LedgerContext }
