import { cost_pricing } from '#scripts/cost-runtime/cost-pricing'
import { figure_format } from '#scripts/lib/figure-format'
import { json_value } from '#scripts/lib/json-value'
import { transcript_record } from '#scripts/lib/transcript-record'
import { time_josh_names } from '#scripts/time-runtime/time-josh-names'
import { time_shell } from '#scripts/time-runtime/time-shell'
import type { Block, TranscriptLine } from '#scripts/time-runtime/time-transcript-line'
import type { AuditSession } from './cost-audit-read'

// The effort and tool-result half of `josh cost:audit`'s current-period breakdown
// (joshuafolkken/kit#7055): the cost each reasoning effort ran up, and the characters tool results
// put into the context — by tool, by josh subcommand, and the Reads of a file the session had already
// read.
//
// **A result is charged to the call it answers**, paired by `tool_use_id` within one session; a result
// whose call lies outside the period is not counted. **A Read repeats when its session already read
// that path**, whatever range either read covered — the figure bounds what a re-read could save.

const UNKNOWN_EFFORT = 'unknown'
const READ_TOOL = 'Read'
const BASH_TOOL = 'Bash'
const FILE_PATH_KEY = 'file_path'
const ROW_LIMIT = 10

interface EffortSpend {
	effort: string
	usd: number
}

interface ResultChars {
	key: string
	results: number
	chars: number
}

interface DuplicateReads {
	files: number
	reads: number
	chars: number
}

interface ResultBreakdown {
	total_usd: number
	efforts: ReadonlyArray<EffortSpend>
	tools: ReadonlyArray<ResultChars>
	josh: ReadonlyArray<ResultChars>
	duplicate_reads: DuplicateReads
}

interface CallResult {
	call: Block
	chars: number
}

interface FileRead {
	file: string
	chars: number
}

function add(totals: Map<string, number>, key: string, value: number): void {
	totals.set(key, (totals.get(key) ?? 0) + value)
}

function effort_by_request(lines: ReadonlyArray<TranscriptLine>): Map<string, string> {
	const priced = lines.filter((line) => line.request_id !== '' && line.effort !== '')

	return new Map(priced.map((line) => [line.request_id, line.effort]))
}

function add_efforts(totals: Map<string, number>, session: AuditSession): void {
	const efforts = effort_by_request(session.lines)

	for (const record of session.records) {
		add(totals, efforts.get(record.request_id) ?? UNKNOWN_EFFORT, cost_pricing.cost_of([record]))
	}
}

function calls_of(blocks: ReadonlyArray<Block>): Map<string, Block> {
	const calls = blocks.filter((block) => block.type === transcript_record.TOOL_USE_TYPE)

	return new Map(calls.filter((call) => call.id !== '').map((call) => [call.id, call]))
}

function results_of(lines: ReadonlyArray<TranscriptLine>): Array<CallResult> {
	const blocks = lines.flatMap((line) => line.blocks)
	const calls = calls_of(blocks)

	return blocks
		.map((block) => ({ call: calls.get(block.result_id), chars: block.result_chars }))
		.filter((result): result is CallResult => result.call !== undefined)
}

// The josh subcommand a Bash call ran, `''` for any other call.
function josh_of(call: Block): string {
	if (call.name !== BASH_TOOL) return ''

	return time_josh_names.josh_command_of(time_shell.bash_command(call.input))
}

function read_path(call: Block): string {
	if (call.name !== READ_TOOL || !json_value.is_record(call.input)) return ''

	const value = call.input[FILE_PATH_KEY]

	return typeof value === 'string' ? value : ''
}

// The Reads of a path this session had already read, in the order they ran.
function repeats_of(results: ReadonlyArray<CallResult>): Array<FileRead> {
	const seen = new Set<string>()
	const reads = results.map((result) => ({ file: read_path(result.call), chars: result.chars }))

	return reads.filter((read) => {
		const is_repeat = seen.has(read.file)

		seen.add(read.file)

		return read.file !== '' && is_repeat
	})
}

function duplicates_of(repeats: ReadonlyArray<ReadonlyArray<FileRead>>): DuplicateReads {
	const all = repeats.flat()
	const files = repeats.map((one) => new Set(one.map((read) => read.file)).size)

	return {
		files: files.reduce((sum, count) => sum + count, 0),
		reads: all.length,
		chars: all.reduce((sum, read) => sum + read.chars, 0),
	}
}

function chars_rows(
	results: ReadonlyArray<CallResult>,
	key_of: (call: Block) => string,
): Array<ResultChars> {
	const rows = new Map<string, ResultChars>()

	for (const { call, chars } of results) {
		const key = key_of(call)
		const row = rows.get(key) ?? { key, results: 0, chars: 0 }

		rows.set(key, { key, results: row.results + 1, chars: row.chars + chars })
	}

	rows.delete('')

	return [...rows.values()].toSorted((left, right) => right.chars - left.chars)
}

function effort_rows(sessions: ReadonlyArray<AuditSession>): Array<EffortSpend> {
	const totals = new Map<string, number>()

	for (const session of sessions) add_efforts(totals, session)

	return [...totals]
		.map(([effort, usd]) => ({ effort, usd }))
		.toSorted((left, right) => right.usd - left.usd)
}

// The current period's breakdown, read from sessions already cut to the period.
function breakdown_of(sessions: ReadonlyArray<AuditSession>): ResultBreakdown {
	const per_session = sessions.map((session) => results_of(session.lines))
	const results = per_session.flat()
	const efforts = effort_rows(sessions)

	return {
		total_usd: efforts.reduce((sum, row) => sum + row.usd, 0),
		efforts,
		tools: chars_rows(results, (call) => call.name),
		josh: chars_rows(results, (call) => josh_of(call)),
		duplicate_reads: duplicates_of(per_session.map((one) => repeats_of(one))),
	}
}

function effort_line(row: EffortSpend, total_usd: number): string {
	return `    ${row.effort}: ${figure_format.format_usd(row.usd)} (${figure_format.format_share(row.usd, total_usd)})`
}

function chars_line(row: ResultChars): string {
	const average = figure_format.format_tokens(Math.round(row.chars / row.results))

	return `    ${row.key}: ${figure_format.format_tokens(row.chars)} chars, ${String(row.results)} results, ${average} avg`
}

function chars_lines(rows: ReadonlyArray<ResultChars>): Array<string> {
	if (rows.length === 0) return ['    none']

	return rows.slice(0, ROW_LIMIT).map((row) => chars_line(row))
}

function duplicate_line(duplicates: DuplicateReads): string {
	const counts = `${String(duplicates.reads)} reads of ${String(duplicates.files)} files`

	return `  repeated Reads of a file the session already read: ${counts}, ${figure_format.format_tokens(duplicates.chars)} chars`
}

function result_lines(breakdown: ResultBreakdown): Array<string> {
	const efforts = breakdown.efforts.map((row) => effort_line(row, breakdown.total_usd))
	const limit = String(ROW_LIMIT)

	return [
		'',
		'Effort and tool results (this period: dollars and result characters)',
		'  cost by effort:',
		...(efforts.length === 0 ? ['    none'] : efforts),
		`  result characters by tool (top ${limit}):`,
		...chars_lines(breakdown.tools),
		`  result characters by josh subcommand (top ${limit}):`,
		...chars_lines(breakdown.josh),
		duplicate_line(breakdown.duplicate_reads),
	]
}

const cost_audit_result = { ROW_LIMIT, UNKNOWN_EFFORT, breakdown_of, result_lines }

export type { DuplicateReads, EffortSpend, ResultBreakdown, ResultChars }
export { cost_audit_result }
