import {
	lane_ledger,
	type DispatchEntry,
	type LaneStateChangeEntry,
	type LedgerEntry,
} from './lane-ledger'

// The spans each lane stood paused, read off the `lane-state` lines `lane:pause` and `lane:resume`
// append to the ledger (joshuafolkken/kit#5168). A SIGSTOP leaves the call in flight on the clock, so a
// measurement of a lane's time takes its overlap with these out: `lane:pause --all` once put seven
// hours into one plan call and one check call.
//
// **A pause opens a span, the lane's next resume or dispatch closes it** — `lane:restart` and a
// re-dispatch start a fresh child without a resume; a pause with neither yet stays open, and a
// resume with no pause before it closes nothing.

const PAUSED = 'paused'
const LANE_ISSUE_PATTERN = /-(?<issue>\d+)$/u

interface PausedSpan {
	from_ms: number
	to_ms: number
}

// Each lane's paused spans, by issue number.
type PausedSpans = ReadonlyMap<number, ReadonlyArray<PausedSpan>>

interface Walk {
	spans: Array<PausedSpan>
	open_ms: number | undefined
}

// A ledger line that opens or closes a lane's paused span.
type Change = LaneStateChangeEntry | DispatchEntry

const NONE: ReadonlyArray<PausedSpan> = []

function is_change(entry: LedgerEntry): entry is Change {
	return entry.kind === lane_ledger.KIND.LANE_STATE || entry.kind === lane_ledger.KIND.DISPATCH
}

function is_pause(change: Change): boolean {
	return change.kind === lane_ledger.KIND.LANE_STATE && change.state === PAUSED
}

function step(walk: Walk, change: Change): Walk {
	const at_ms = Date.parse(change.at)

	if (is_pause(change)) return { spans: walk.spans, open_ms: walk.open_ms ?? at_ms }
	if (walk.open_ms === undefined) return walk

	return { spans: [...walk.spans, { from_ms: walk.open_ms, to_ms: at_ms }], open_ms: undefined }
}

// One lane's changes, oldest first, folded into its spans.
function spans_of(changes: ReadonlyArray<Change>): Array<PausedSpan> {
	let walk: Walk = { spans: [], open_ms: undefined }

	for (const change of changes) walk = step(walk, change)
	if (walk.open_ms === undefined) return walk.spans

	return [...walk.spans, { from_ms: walk.open_ms, to_ms: Infinity }]
}

function by_lane(entries: ReadonlyArray<LedgerEntry>): PausedSpans {
	const changes = entries
		.filter((entry) => is_change(entry))
		.toSorted((left, right) => Date.parse(left.at) - Date.parse(right.at))
	const issues = [...new Set(changes.map((change) => change.issue))]

	return new Map(
		issues.map((issue) => [issue, spans_of(changes.filter((change) => change.issue === issue))]),
	)
}

// The spans of the lane a transcript directory (`<lane-root-slug>-<issue>`) belongs to.
function of_lane(spans: PausedSpans, lane: string): ReadonlyArray<PausedSpan> {
	const issue = LANE_ISSUE_PATTERN.exec(lane)?.groups?.['issue']

	return issue === undefined ? NONE : (spans.get(Number(issue)) ?? NONE)
}

// How much of `from_ms`…`to_ms` the spans cover.
function overlap_ms(spans: ReadonlyArray<PausedSpan>, from_ms: number, to_ms: number): number {
	let sum = 0

	for (const span of spans) {
		sum += Math.max(0, Math.min(to_ms, span.to_ms) - Math.max(from_ms, span.from_ms))
	}

	return sum
}

const lane_paused_spans = { by_lane, of_lane, overlap_ms }

export type { PausedSpan, PausedSpans }
export { lane_paused_spans }
