import path from 'node:path'
import { cost_format } from '#scripts/cost-runtime/cost-format'
import { cost_pricing } from '#scripts/cost-runtime/cost-pricing'
import { cost_usage, type UsageRecord } from '#scripts/cost-runtime/cost-usage'
import { json_value } from '#scripts/json-value'
import {
	cost_document_reads,
	type DocumentRead,
	type DocumentReadPoint,
	type ReadContext,
} from './cost-document-reads'

// Attributing the carried cost of the run's entry-read instruction documents, one row per document
// (joshuafolkken/kit#1871).
//
// `cost-resident.ts` decomposes the *preamble* — `CLAUDE.md`, the skills index, the hooks — which is
// billed before any work happens. The documents a workflow reads *at its entry* (`SKILL.md`,
// `backlogrun.md`, `chain-rule.md`) are not in that preamble: a `Read` brings each into the conversation
// partway through, and every request after it re-reads it from cache. That per-document carry cost is
// what a point-of-use decision trades away, and until this it could only be re-measured by hand
// against the transcript each time (#1856 chose its target from a hand calculation).
//
// **Measured from the transcript, never from disk.** A document's size on disk is today's, and what
// was billed is the bytes that were actually carried — line-number prefixes and all — so the tokens
// come from the `tool_result` the run received. A `Read` whose result the transcript does not carry
// is reported `is_measured: false`, never as a document that cost zero: "could not be read" and "was
// free" are different answers, the same distinction `cost-transcript.ts` draws with `is_readable`.
//
// **A document brought in by a `Read` call — the point-of-use lever.** Converting an entry read to a
// point-of-use read is what removes a document's carry, and that is a `Read`, so the attribution
// follows `Read` tool calls. Content the harness folds in another way — a `Skill` tool load, the
// resident preamble `cost-resident.ts` already sizes — is out of this table by design, not missed: it
// is not something a run chooses to move to a later point.

const READ_TOOL = 'Read'
const TOOL_USE = 'tool_use'
const TOOL_RESULT = 'tool_result'
const TEXT_TYPE = 'text'

// A document is an instruction / prompt file: markdown under `.claude/` or `prompts/`, or a root
// agent doc. Source files a run reads are not carried as resident instructions and would drown the
// signal this instrument exists to rank, so the predicate keeps to the documents a point-of-use
// decision is actually about.
const DOC_ROOTS = ['/.claude/', '/prompts/']
const ROOT_DOCS = new Set(['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'])

interface DocumentRow {
	// Reported from the first documentation root in the path (`.claude/…`, `prompts/…`) or the
	// basename, so the same document reads identically across machines — the whole point is comparing
	// document sizes, which an absolute path would defeat.
	path: string
	tokens: number
	// Billed requests that carried the document after the one that read it — `total − read_position`.
	carried_requests: number
	cost_usd: number
	// False when the `Read` was found but its result was not in the transcript, so the tokens could
	// not be measured. The row is reported rather than dropped: a known read of unknown size is not a
	// document that cost nothing (joshuafolkken/kit#1871).
	is_measured: boolean
	// How many times the scope read this document, the dollars every read past the first added, and each
	// read as a point on the timeline (joshuafolkken/kit#1913). The four fields above are the earliest
	// read's carry, unchanged; these are what re-reading a large document at a late, large context costs
	// on top of it — the waste the single-carry model could not see.
	read_count: number
	duplicate_cost_usd: number
	reads: Array<DocumentReadPoint>
}

interface DocumentBreakdown {
	rows: Array<DocumentRow>
	total_cost_usd: number
}

// One session's raw transcript and the billed records the carry is measured against: the records give
// the request order a read is placed in, the model the carry is priced at, and — via `scope_ids` —
// which requests count toward the carry. `scope_ids` absent counts every request (the whole-session
// scope); an issue scope passes the issue's own request ids, so a document's carry is charged over that
// issue's requests rather than the whole session's (joshuafolkken/kit#1871).
interface DocumentSource {
	raw: string
	records: ReadonlyArray<UsageRecord>
	scope_ids?: ReadonlySet<string>
}

interface Scan {
	reads: Array<DocumentRead>
	results: Map<string, string>
}

function record_of(value: unknown): Record<string, unknown> | undefined {
	return json_value.is_record(value) ? value : undefined
}

function text_or_empty(value: unknown): string {
	return typeof value === 'string' ? value : ''
}

function message_of(line: Record<string, unknown>): Record<string, unknown> | undefined {
	return record_of(line['message'])
}

function content_blocks(line: Record<string, unknown>): Array<unknown> {
	const content = message_of(line)?.['content']

	return Array.isArray(content) ? content : []
}

// The billed request a line belongs to, resolved as `cost-usage.ts` resolves it: `requestId`, then the
// message id, then the `uuid` a locally-generated line carries instead. A narrower resolution here
// would place a read in a request the record set does not, and count less of its carry than it had.
function request_id_of(line: Record<string, unknown>): string | undefined {
	const request_id = text_or_empty(line['requestId'])
	if (request_id !== '') return request_id

	const message_id = text_or_empty(message_of(line)?.['id'])
	if (message_id !== '') return message_id

	const uuid = text_or_empty(line['uuid'])

	return uuid === '' ? undefined : uuid
}

function is_document(file_path: string): boolean {
	if (!file_path.endsWith('.md')) return false
	if (DOC_ROOTS.some((root) => file_path.includes(root))) return true

	return ROOT_DOCS.has(path.basename(file_path))
}

function short_path(file_path: string): string {
	for (const root of DOC_ROOTS) {
		const at = file_path.indexOf(root)
		if (at !== -1) return file_path.slice(at + 1)
	}

	return path.basename(file_path)
}

function is_read_tool(record: Record<string, unknown>): boolean {
	return text_or_empty(record['type']) === TOOL_USE && record['name'] === READ_TOOL
}

function read_path(block: unknown): string | undefined {
	const record = record_of(block)
	if (record === undefined || !is_read_tool(record)) return undefined

	const file_path = record_of(record['input'])?.['file_path']

	return typeof file_path === 'string' ? file_path : undefined
}

function result_reference(block: unknown): string {
	const record = record_of(block)
	if (record === undefined || text_or_empty(record['type']) !== TOOL_RESULT) return ''

	return text_or_empty(record['tool_use_id'])
}

function item_text(item: unknown): string {
	const record = record_of(item)
	if (record === undefined || text_or_empty(record['type']) !== TEXT_TYPE) return ''

	return text_or_empty(record['text'])
}

function result_text(block: unknown): string {
	const content = record_of(block)?.['content']
	if (typeof content === 'string') return content
	if (Array.isArray(content)) return content.map((item) => item_text(item)).join('')

	return ''
}

function add_read(
	block: unknown,
	request_id: string | undefined,
	reads: Array<DocumentRead>,
): void {
	const file_path = read_path(block)
	if (file_path === undefined || !is_document(file_path)) return

	reads.push({
		tool_use_id: text_or_empty(record_of(block)?.['id']),
		short: short_path(file_path),
		request_id,
	})
}

function add_result(block: unknown, results: Map<string, string>): void {
	const id = result_reference(block)
	if (id === '') return

	results.set(id, result_text(block))
}

function collect_line(line: Record<string, unknown>, sink: Scan): void {
	const request_id = request_id_of(line)

	for (const block of content_blocks(line)) {
		add_read(block, request_id, sink.reads)
		add_result(block, sink.results)
	}
}

// The reads and their results, in transcript order. The carry is not counted here: a read's position
// and the requests that count toward it both come from the billed record set, so counting them off the
// raw lines would be a second, drift-prone definition of a request (joshuafolkken/kit#1871).
function scan_transcript(raw: string): Scan {
	const sink: Scan = { reads: [], results: new Map() }

	for (const line of raw.split('\n')) {
		const parsed = record_of(json_value.parse_or_undefined(line))
		if (parsed !== undefined) collect_line(parsed, sink)
	}

	return sink
}

// A request id to its position in the billed record set, which `cost-usage.ts` keeps in transcript
// order — so a later position is a later request.
function request_order(records: ReadonlyArray<UsageRecord>): Map<string, number> {
	return new Map(records.map((record, index) => [record.request_id, index]))
}

// The record positions the carry is counted over: the scope's own requests. Absent `scope_ids` is the
// whole session, so every position counts; an issue scope passes its own request ids, and a request
// outside the record set contributes no position.
function scope_positions(
	records: ReadonlyArray<UsageRecord>,
	order: ReadonlyMap<string, number>,
	scope_ids: ReadonlySet<string> | undefined,
): Array<number> {
	if (scope_ids === undefined) return records.map((_, index) => index)

	return [...scope_ids].flatMap((id) => {
		const position = order.get(id)

		return position === undefined ? [] : [position]
	})
}

function dominant_model(records: ReadonlyArray<UsageRecord>): string {
	const counts = new Map<string, number>()
	for (const record of records) counts.set(record.model, (counts.get(record.model) ?? 0) + 1)

	let best = ''
	let most = 0
	for (const [model, count] of counts) if (count > most) [best, most] = [model, count]

	return best
}

// The conversation size at each request — cache reads, cache writes and input — so a read carries how
// big the context was when it happened (joshuafolkken/kit#1913).
function context_tokens_of(records: ReadonlyArray<UsageRecord>): Map<string, number> {
	return new Map(
		records.map((record) => [record.request_id, cost_usage.billed_input(record.totals)]),
	)
}

// Every read of one document, gathered so `build_reads` can count the re-reads and price the
// duplicates — where the earliest-read carry keeps only the first.
function group_by_path(reads: ReadonlyArray<DocumentRead>): Map<string, Array<DocumentRead>> {
	const groups = new Map<string, Array<DocumentRead>>()

	for (const read of reads) {
		const kept = groups.get(read.short) ?? []

		kept.push(read)
		groups.set(read.short, kept)
	}

	return groups
}

function session_rows(source: DocumentSource): Array<DocumentRow> {
	const scanned = scan_transcript(source.raw)
	const order = request_order(source.records)
	const context: ReadContext = {
		order,
		scope_positions: scope_positions(source.records, order, source.scope_ids),
		results: scanned.results,
		context_tokens: context_tokens_of(source.records),
		price: cost_pricing.resolve_price(dominant_model(source.records)),
		scope_ids: source.scope_ids,
	}

	return [...group_by_path(scanned.reads)].map((entry) => ({
		path: entry[0],
		...cost_document_reads.build_reads(entry[1], context),
	}))
}

// The same document read in two of an issue's sessions is one row: its carry counts add and its cost
// adds, and the tokens are the larger of the two measurements (one session may have missed the
// result). `is_measured` is true if either session measured it.
function combine(existing: DocumentRow | undefined, row: DocumentRow): DocumentRow {
	if (existing === undefined) return row

	return {
		path: row.path,
		tokens: Math.max(existing.tokens, row.tokens),
		carried_requests: existing.carried_requests + row.carried_requests,
		cost_usd: existing.cost_usd + row.cost_usd,
		is_measured: existing.is_measured || row.is_measured,
		read_count: existing.read_count + row.read_count,
		duplicate_cost_usd: existing.duplicate_cost_usd + row.duplicate_cost_usd,
		reads: [...existing.reads, ...row.reads],
	}
}

function merge_rows(rows: ReadonlyArray<DocumentRow>): Array<DocumentRow> {
	const by_path = new Map<string, DocumentRow>()
	for (const row of rows) by_path.set(row.path, combine(by_path.get(row.path), row))

	return [...by_path.values()].toSorted((left, right) => right.cost_usd - left.cost_usd)
}

// The per-document breakdown for a scope: one row per entry-read document across every session the
// scope covers, largest carry cost first. An empty `sources` yields an empty breakdown, so a scope
// with no transcript to read carries no rows rather than a table of zeroes.
function build(sources: ReadonlyArray<DocumentSource>): DocumentBreakdown {
	const rows = merge_rows(sources.flatMap((source) => session_rows(source)))

	return { rows, total_cost_usd: rows.reduce((sum, row) => sum + row.cost_usd, 0) }
}

const PATH_WIDTH = 50
// Wide enough for the `not measured` label an unmeasured row prints, so that row keeps the column
// alignment rather than overflowing it.
const TOKEN_WIDTH = 12
const COUNT_WIDTH = 6

const FIRST_READ = 1

// A document read more than once carries the count and what the duplicates cost, so a whole-document
// re-read at a late context reads as the waste it is (joshuafolkken/kit#1913). Silent for a document
// read once, which is nearly all of them — a note that appears every time is one nobody reads.
function reads_note(row: DocumentRow): string {
	if (row.read_count <= FIRST_READ) return ''

	const cost = row.is_measured ? ` (dup ${cost_format.format_usd(row.duplicate_cost_usd)})` : ''

	return `  read ${String(row.read_count)}x${cost}`
}

function format_row(row: DocumentRow): string {
	const tokens = row.is_measured ? cost_format.format_tokens(row.tokens) : 'not measured'
	const cost = row.is_measured ? cost_format.format_usd(row.cost_usd) : ''

	return `  ${row.path.padEnd(PATH_WIDTH)}${tokens.padStart(TOKEN_WIDTH)}  ${String(row.carried_requests).padStart(COUNT_WIDTH)}  ${cost}${reads_note(row)}`
}

function format_documents(breakdown: DocumentBreakdown): Array<string> {
	if (breakdown.rows.length === 0) return []

	return [
		'Entry-read documents (carried per request; tokens estimated from the transcript):',
		`  ${'document'.padEnd(PATH_WIDTH)}${'tokens'.padStart(TOKEN_WIDTH)}  ${'carry'.padStart(COUNT_WIDTH)}  cost`,
		...breakdown.rows.map((row) => format_row(row)),
		`  total carry cost ${cost_format.format_usd(breakdown.total_cost_usd)}`,
	]
}

const cost_documents = {
	build,
	format_documents,
}

export type { DocumentBreakdown, DocumentRow, DocumentSource }
export { cost_documents }

export { type DocumentReadPoint } from './cost-document-reads'
