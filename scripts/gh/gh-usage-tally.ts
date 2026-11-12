import { z } from 'zod'
import { gh_call_kind, type CallClass } from './gh-call-kind'

// The `josh gh:usage` tally (joshuafolkken/kit#6753): the usage log's lines (`gh-usage-log.ts`)
// summed per command — runs, calls, 304 answers and the core `used` difference — most calls first,
// under a heading that names the period the lines cover, since the log's cap drops the oldest.
// A line that does not parse is counted, not tallied. A line without a difference (a failed
// reading) still counts its calls; the difference column sums the lines that carry one.
//
// Below it, the calls per endpoint (joshuafolkken/kit#6867): the lines' `endpoints` summed per call
// kind, most calls first, under the REST, GraphQL, `gh` subcommand and free `GET rate_limit` totals
// (`gh_call_kind.class_of`). A line written before the kinds were recorded carries none, so its
// calls are the `unrecorded` total.

const COLUMN_GAP = '  '
const UNMEASURED = '—'
const HEADER = ['command', 'runs', 'calls', '304', 'core Δ'] as const
const ENDPOINT_HEADER = ['endpoint', 'calls', '304'] as const
const CLASS_LABELS: ReadonlyArray<readonly [CallClass, string]> = [
	['rest', 'REST'],
	['graphql', 'GraphQL'],
	['gh', 'gh'],
	['free', 'rate_limit (free)'],
]

const count_schema = z.object({ calls: z.number(), not_modified: z.number() })

const line_schema = z.looseObject({
	at: z.iso.datetime({ offset: true }),
	command: z.string(),
	calls: z.number(),
	not_modified: z.number(),
	core_used_delta: z.number().optional(),
	endpoints: z.record(z.string(), count_schema).optional(),
})

type UsageLine = z.infer<typeof line_schema>

interface CommandRow {
	command: string
	runs: number
	calls: number
	not_modified: number
	core_used_delta?: number | undefined
}

interface EndpointRow {
	endpoint: string
	calls: number
	not_modified: number
}

interface UsageTally {
	rows: ReadonlyArray<CommandRow>
	endpoints: ReadonlyArray<EndpointRow>
	lines: ReadonlyArray<UsageLine>
	malformed: number
}

function parsed_of(text: string): UsageLine | undefined {
	try {
		return line_schema.safeParse(JSON.parse(text)).data
	} catch {
		return undefined
	}
}

function delta_sum(left: number | undefined, right: number | undefined): number | undefined {
	if (left === undefined) return right
	if (right === undefined) return left

	return left + right
}

function added(row: CommandRow | undefined, line: UsageLine): CommandRow {
	const base = row ?? { command: line.command, runs: 0, calls: 0, not_modified: 0 }

	return {
		command: line.command,
		runs: base.runs + 1,
		calls: base.calls + line.calls,
		not_modified: base.not_modified + line.not_modified,
		core_used_delta: delta_sum(base.core_used_delta, line.core_used_delta),
	}
}

function most_calls_first<Row extends { calls: number }>(
	rows: ReadonlyArray<Row>,
	name_of: (row: Row) => string,
): Array<Row> {
	return rows.toSorted(
		(left, right) => right.calls - left.calls || name_of(left).localeCompare(name_of(right)),
	)
}

function rows_of(lines: ReadonlyArray<UsageLine>): Array<CommandRow> {
	const rows = new Map<string, CommandRow>()

	for (const line of lines) rows.set(line.command, added(rows.get(line.command), line))

	return most_calls_first([...rows.values()], (row) => row.command)
}

function endpoint_rows_of(lines: ReadonlyArray<UsageLine>): Array<EndpointRow> {
	const rows = new Map<string, EndpointRow>()
	const counts = lines.flatMap((line) => Object.entries(line.endpoints ?? {}))

	for (const [endpoint, count] of counts) {
		const base = rows.get(endpoint) ?? { endpoint, calls: 0, not_modified: 0 }

		rows.set(endpoint, {
			endpoint,
			calls: base.calls + count.calls,
			not_modified: base.not_modified + count.not_modified,
		})
	}

	return most_calls_first([...rows.values()], (row) => row.endpoint)
}

// `since_ms` keeps the lines at or after that instant; the malformed count is over every line.
function tally(texts: ReadonlyArray<string>, since_ms?: number): UsageTally {
	const parsed = texts.map((text) => parsed_of(text))
	const valid = parsed.filter((line) => line !== undefined)
	const lines = valid.filter((line) => since_ms === undefined || Date.parse(line.at) >= since_ms)
	const malformed = parsed.length - valid.length

	return { rows: rows_of(lines), endpoints: endpoint_rows_of(lines), lines, malformed }
}

function heading_of(result: UsageTally): string {
	const malformed = result.malformed === 0 ? '' : ` · ${String(result.malformed)} malformed`
	const first = result.lines.at(0)
	const last = result.lines.at(-1)

	if (first === undefined || last === undefined) return `gh:usage — no usage lines${malformed}`

	return `gh:usage — ${first.at} … ${last.at} · ${String(result.lines.length)} lines${malformed}`
}

function cells_of(row: CommandRow): Array<string> {
	const delta = row.core_used_delta === undefined ? UNMEASURED : String(row.core_used_delta)

	return [row.command, String(row.runs), String(row.calls), String(row.not_modified), delta]
}

function line_of(cells: ReadonlyArray<string>, widths: ReadonlyArray<number>): string {
	const padded = cells.map((cell, index) => {
		const width = widths[index] ?? 0

		return index === 0 ? cell.padEnd(width) : cell.padStart(width)
	})

	return padded.join(COLUMN_GAP).trimEnd()
}

function table_lines(table: ReadonlyArray<ReadonlyArray<string>>): Array<string> {
	const columns = table[0] ?? []
	const widths = columns.map((_, index) =>
		Math.max(...table.map((cells) => cells[index]?.length ?? 0)),
	)

	return table.map((cells) => line_of(cells, widths))
}

function sum_calls(rows: ReadonlyArray<{ calls: number }>): number {
	return rows.reduce((sum, row) => sum + row.calls, 0)
}

function totals_of(result: UsageTally): string {
	const classed = CLASS_LABELS.map(([call_class, label]) => {
		const rows = result.endpoints.filter(
			(row) => gh_call_kind.class_of(row.endpoint) === call_class,
		)

		return `${label} ${String(sum_calls(rows))}`
	})
	const unrecorded = sum_calls(result.lines) - sum_calls(result.endpoints)

	return [...classed, `unrecorded ${String(unrecorded)}`].join(' · ')
}

function endpoint_lines(result: UsageTally): Array<string> {
	if (result.endpoints.length === 0) return []
	const cells = result.endpoints.map((row) => [
		row.endpoint,
		String(row.calls),
		String(row.not_modified),
	])

	return ['', totals_of(result), ...table_lines([[...ENDPOINT_HEADER], ...cells])]
}

// `transport` is the session's (`git-gh-transport.ts`), named after the heading's period.
function render(result: UsageTally, transport?: string): string {
	const named = transport === undefined ? '' : ` · transport: ${transport}`
	const heading = `${heading_of(result)}${named}`

	if (result.rows.length === 0) return heading

	const table = [[...HEADER], ...result.rows.map((row) => cells_of(row))]

	return [heading, ...table_lines(table), ...endpoint_lines(result)].join('\n')
}

const gh_usage_tally = { tally, render }

export type { CommandRow, EndpointRow, UsageTally }
export { gh_usage_tally }
