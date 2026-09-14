import { cost_pricing, type ModelPrice } from './cost-pricing'
import { cost_tokens } from './cost-tokens'
import type { UsageTotals } from './cost-usage'

// The reads of one entry-read document: the earliest one's carry, and every read as a point on the
// run's timeline (joshuafolkken/kit#1913).
//
// **`cost-documents.ts` kept only the earliest read**, because a document is one continuous presence
// in the conversation once it is in — re-reading it adds nothing to the *carry*. That is right for the
// carry, and it hid the waste this file measures: `followup.md` (~32 KB) read whole a second time at
// the run's largest context is a real re-materialization, billed again from that point. So the primary
// carry stays the earliest read's, unchanged, and the per-read points are added beside it.
//
// **A read counts as a re-read of *this scope* only if its own request is in the scope.** A resumed or
// forked session copies the parent's read line into its transcript, and that copy is not a second read
// — its request belongs to the parent, not this scope. Filtering the points by scope membership is
// what keeps a fork's copied line out of the count while a genuine same-session second read stays in,
// the distinction the earliest-read carry already draws for the fork case.

const NONE = 0
const ZERO_COST = 0

// A `Read` of a document and the request that issued it, as `cost-documents.ts` scans it out of the
// transcript. Kept here beside the math that consumes it, so the dependency is one-way.
interface DocumentRead {
	tool_use_id: string
	short: string
	request_id: string | undefined
}

// One read of a document, placed on the run's timeline (joshuafolkken/kit#1913). `context_tokens` is
// how big the conversation was when it happened — the reading that ranks a late re-read above an early
// one of the same size — and `cost_usd` is what that read's own carry cost, so a duplicate's waste is
// answerable per read rather than only in the row's total.
interface DocumentReadPoint {
	context_tokens: number
	carried_requests: number
	cost_usd: number
	is_first: boolean
}

// What one session's rows are built against: the request order a read is placed in, the scope
// positions the carry counts over, the results to size, the conversation size at each request, the
// price, and which requests are the scope's own.
interface ReadContext {
	order: ReadonlyMap<string, number>
	scope_positions: ReadonlyArray<number>
	results: ReadonlyMap<string, string>
	context_tokens: ReadonlyMap<string, number>
	price: ModelPrice | undefined
	scope_ids: ReadonlySet<string> | undefined
}

// Everything a `DocumentRow` carries but its path: the earliest read's carry, and the per-read points.
interface DocumentReads {
	tokens: number
	carried_requests: number
	cost_usd: number
	is_measured: boolean
	read_count: number
	duplicate_cost_usd: number
	reads: Array<DocumentReadPoint>
}

function position_of(read: DocumentRead, order: ReadonlyMap<string, number>): number {
	const at = read.request_id === undefined ? undefined : order.get(read.request_id)

	return at ?? Infinity
}

// The scope's requests that came after the read — its carry. A read whose request is outside the scope
// carries only the scope's later requests, which is how an issue or fork scope charges its own.
function carried_after(read: DocumentRead, context: ReadContext): number {
	const at = read.request_id === undefined ? undefined : context.order.get(read.request_id)
	if (at === undefined) return NONE

	return context.scope_positions.filter((position) => position > at).length
}

function carry_totals(cache_read_tokens: number): UsageTotals {
	return {
		input_tokens: 0,
		cache_write_5m_tokens: 0,
		cache_write_1h_tokens: 0,
		cache_read_tokens,
		output_tokens: 0,
		thinking_tokens: 0,
		thinking_measured: false,
	}
}

// The carry is a cache read on every following request, priced at the read rate; an unpriced model
// contributes no dollars, the floor `cost_documents` took before the math moved here.
function carry_cost(tokens: number, carried: number, price: ModelPrice | undefined): number {
	if (price === undefined) return ZERO_COST

	return cost_pricing.estimate_cost(carry_totals(tokens * carried), price)
}

function tokens_of(read: DocumentRead, results: ReadonlyMap<string, string>): number {
	const content = results.get(read.tool_use_id)

	return content === undefined || content === '' ? NONE : cost_tokens.estimate(content)
}

function is_measured_of(
	read: DocumentRead | undefined,
	results: ReadonlyMap<string, string>,
): boolean {
	if (read === undefined) return false

	const content = results.get(read.tool_use_id)

	return content !== undefined && content !== ''
}

// A read is this scope's own — rather than a parent's line copied into a resumed transcript — when its
// request is in the scope. The whole-session scope (no `scope_ids`) counts every read the order knows.
function in_scope(read: DocumentRead, context: ReadContext): boolean {
	if (read.request_id === undefined) return false
	if (context.scope_ids === undefined) return context.order.has(read.request_id)

	return context.scope_ids.has(read.request_id)
}

function point_of(read: DocumentRead, context: ReadContext, is_first: boolean): DocumentReadPoint {
	const carried = carried_after(read, context)

	return {
		context_tokens: context.context_tokens.get(read.request_id ?? '') ?? NONE,
		carried_requests: carried,
		cost_usd: carry_cost(tokens_of(read, context.results), carried, context.price),
		is_first,
	}
}

// The earliest read's carry, kept as the row's primary figures so the carry semantics are exactly what
// they were before the per-read points were added.
function primary_reads(
	primary: DocumentRead | undefined,
	context: ReadContext,
): Pick<DocumentReads, 'tokens' | 'carried_requests' | 'cost_usd' | 'is_measured'> {
	if (primary === undefined) {
		return { tokens: NONE, carried_requests: NONE, cost_usd: ZERO_COST, is_measured: false }
	}

	const tokens = tokens_of(primary, context.results)
	const carried = carried_after(primary, context)

	return {
		tokens,
		carried_requests: carried,
		cost_usd: carry_cost(tokens, carried, context.price),
		is_measured: is_measured_of(primary, context.results),
	}
}

// The dollars every read but the first added — the re-materialization the earliest-read carry does not
// charge. Summed over the scope's own reads, so a fork's copied line never contributes.
function duplicate_cost(points: ReadonlyArray<DocumentReadPoint>): number {
	let total = ZERO_COST

	for (const point of points) if (!point.is_first) total += point.cost_usd

	return total
}

// One document's reads across a session, largest concern first: the primary carry, how many times the
// scope read it, what the duplicates cost, and each read placed on the timeline.
function build_reads(group: ReadonlyArray<DocumentRead>, context: ReadContext): DocumentReads {
	const ordered = [...group].toSorted(
		(left, right) => position_of(left, context.order) - position_of(right, context.order),
	)
	const scoped = ordered.filter((read) => in_scope(read, context))
	const points = scoped.map((read, index) => point_of(read, context, index === NONE))

	return {
		...primary_reads(ordered[0], context),
		read_count: scoped.length,
		duplicate_cost_usd: duplicate_cost(points),
		reads: points,
	}
}

const cost_document_reads = { build_reads }

export type { DocumentRead, DocumentReadPoint, DocumentReads, ReadContext }
export { cost_document_reads }
