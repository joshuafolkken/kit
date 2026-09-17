import { time_bundle_call } from './time-bundle-call'
import { time_round_trips } from './time-round-trips'
import { time_spans, type Span } from './time-spans'

// Independent subagent launches that went out one per turn, when they could have fanned out in one
// (joshuafolkken/kit#1854).
//
// **This is a second series, deliberately kept apart from the consecutive one in `time-bundles.ts`.**
// That one reads *consecutive* single-call turns, so a launch fired minutes apart with implementation
// and investigation calls between it and the next never enters a sequence — and a launch is not
// bundleable either, so it could not extend one even if it were adjacent. Loosening the consecutive
// definition to reach these would fold dependent calls into it; a separate series with its own
// dependency test is the only way to count the spread-apart shape without that cost.
//
// **It returns the group sizes and nothing more**, so `time-bundles.ts` prices them with the very
// helpers it prices its own sequences with — `recoverable_of`, `longest_of`, the row count — rather
// than a second copy of that arithmetic living here. The two series then fold in identically, which is
// what keeps `unattributed_round_trips` at zero.
//
// **What the shape costs.** Run #1839 launched three investigation subagents at 1.7 / 7.3 / 11.4
// minutes, in three separate turns, whose three questions — the lane machinery, the API signatures,
// the registry and log paths — needed nothing from one another and could have gone out at once. The
// consecutive detector counted none of them. The three review finders it launched at 36.7 minutes, by
// contrast, went out *in one turn* and cost nothing, which is the shape this series must not charge.
//
// ## When two launches could have been one
//
// A launch turn joins the group before it unless one of two things says the later turn depended on
// what came since the earlier one:
//
// **A certain write since the last launch.** Implementation between two launches means the later one
// may read what was produced — the review finders name the files the implementation wrote, which is a
// read-after-write dependency exactly as `time-bundles.ts` treats one. Run #1839 wrote nothing before
// its third investigation launch and forty-odd files before its review launch, so this alone places
// the investigation trio in one group and the review turn in another.
//
// **A prompt that references a prior finding** (`has_prior_reference`, from `time-bundle-call.ts`). A
// read-only investigation chain — the second question only askable once the first is answered — writes
// nothing between its links, so the write test cannot see it; the marker scan is what does, and it is
// the caveat joshuafolkken/kit#1847 recorded.
//
// **Parallel launches are one turn and cost nothing.** Launches sharing a non-empty message id were
// issued together, so they collapse to a single turn here — the review trio is one turn, not three —
// and a group of one turn is dropped, exactly as a consecutive sequence of one is.

const NONE = 0
const ONE = 1
// A group of one is a lone launch that had nothing to fan out with — not a finding, exactly as a
// consecutive sequence of one is not. Only groups of two or more are kept, so a returned size is
// always `>= 2` and prices the same way a consecutive sequence's does.
const MIN_GROUP = 2

function is_launch(span: Span): boolean {
	return (
		span.category === time_spans.TOOL_CATEGORY &&
		!span.is_continuation &&
		time_bundle_call.is_launch_tool(span.label)
	)
}

// The walk's running pieces: the sizes of the groups already closed, the count of launch turns in the
// open group, whether a certain write has landed since that group's last launch, and the message id of
// that last launch so a parallel sibling is not counted as a second turn.
interface Walk {
	closed: Array<number>
	open: number
	wrote_since: boolean
	turn_id: string
}

function new_walk(): Walk {
	return { closed: [], open: NONE, wrote_since: false, turn_id: time_spans.NO_MESSAGE_ID }
}

// A group is worth keeping only at two turns or more, exactly as a consecutive sequence is.
function close_group(walk: Walk): void {
	if (walk.open >= MIN_GROUP) walk.closed.push(walk.open)

	walk.open = NONE
}

// A launch sharing the open turn's non-empty id was issued beside it, so it is the same turn. An
// absent id cannot make that claim, so it always opens a new turn — the conservative reading, matching
// `is_same_turn` in `time-bundles.ts`.
function is_same_turn(walk: Walk, span: Span): boolean {
	return span.message_id !== time_spans.NO_MESSAGE_ID && span.message_id === walk.turn_id
}

// A dependent launch closes the open group and starts a new one at itself, exactly as a target
// conflict does for the consecutive series — everything after it may still fan out with it. The
// `wrote_since` flag is reset here, so it always means "a write since *this* group's last launch".
function open_turn(walk: Walk, span: Span): void {
	if (walk.wrote_since || span.has_prior_reference) close_group(walk)

	walk.open += ONE
	walk.turn_id = span.message_id
	walk.wrote_since = false
}

function step(walk: Walk, span: Span): void {
	if (span.is_writing) {
		walk.wrote_since = true

		return
	}

	if (!is_launch(span) || is_same_turn(walk, span)) return

	open_turn(walk, span)
}

// The fan-out group sizes, each `>= 2` — the shape `time-bundles.ts` already prices a sequence list in.
//
// **Ordered before it is walked, for the reason `time-bundles.ts` gives**: a run's spans do not arrive
// in time order once a delegated unit's are appended after the parent's, and two launches from
// different sessions read as adjacent otherwise.
function agent_bundles(spans: ReadonlyArray<Span>): ReadonlyArray<number> {
	const walk = new_walk()

	for (const span of time_round_trips.in_time_order(spans)) step(walk, span)
	close_group(walk)

	return walk.closed
}

const time_agent_bundles = { agent_bundles }

export { time_agent_bundles }
