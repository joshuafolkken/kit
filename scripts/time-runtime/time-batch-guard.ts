import { time_bundle_call, type BundleFacts } from './time-bundle-call'
import { time_bundles } from './time-bundles'
import { time_call_identity } from './time-call-identity'
import { time_spans, type Span } from './time-spans'
import { time_transcript_line } from './time-transcript-line'

// Whether the call about to go out should be refused because the run has stopped batching. What a
// call is and what a single-call sequence is are `time-bundle-call.ts`'s and `time-bundles.ts`'s
// answers — the same modules the end-of-run report uses — so the guard never disagrees with it.
//
// A `PreToolUse` hook cannot see the size of the turn it interrupts (later `tool_use` lines arrive
// seconds afterwards), so it decides on closed history alone; a refusal of a turn that was going to
// batch is a false positive costing one round trip.
//
// It fires when a sequence first reaches the limit, then every `REFIRE_EVERY` further single-call
// turns, and never twice on the same call: an unchanged reissue is let through (`is_reissued_refusal`).
// A caller that cannot record the refusal must not make it (`scripts/hooks/batch-guard.ts`).

// The longest bundleable sequence measured at 3–5 turns, so refusing at the third still saves turns.
const CONSECUTIVE_LIMIT = 3

// Not tighter than the first limit, so a run just past an answered reminder is not refused again.
const REFIRE_EVERY = CONSECUTIVE_LIMIT
const ONE_TURN = 1
const NONE = 0

// A notice cannot wedge (the call proceeds), so it recurs every turn; kept apart from `REFIRE_EVERY`.
const NOTICE_REFIRE_EVERY = ONE_TURN

// Naming the concrete calls gives the reader something to act on that "batch more" does not.
const NAMED_CANDIDATE_COUNT = 3

// The call being judged has not closed, so `CONSECUTIVE_LIMIT - 1` closed turns means it makes the limit.
const SEQUENCE_BEFORE_LIMIT = CONSECUTIVE_LIMIT - ONE_TURN

// A record so the tool and its input cannot be handed over in the wrong order.
interface GuardedCall {
	name: string
	input: unknown
}

// A closed turn's span or the call in hand alike.
type NamedCall = Pick<Span, 'is_bundleable' | 'is_writing' | 'label' | 'targets'>

// Writes are refusable — they were most of the recoverable round trips. A refused edit leaves its
// siblings applied, but a refusable write is content-addressed, so a reissue either applies or fails
// loudly; `depends_on_sequence` withholds the refusal where the call shares a target with the sequence.

// The three texts carry the action and a pointer; the criterion's reasoning and measured cost stay
// at the pointer, so a firing does not re-bill the rule body.
const RULE_POINTER = '`prompts/collaboration-workflow/turn-batching.md`'
const STREAK = `${String(CONSECUTIVE_LIMIT)} single-call turns in a row`

// Includes what to do when the turn was already batching — the guard cannot see the turn it interrupted.
const REASON =
	`⛔ batching: ${STREAK}. Reissue this with the calls that do not need its result — the test is ` +
	`whether a call's input needs another call's result, not what kind of call it is (edits are covered ` +
	`exactly as reads), and it never authorizes weakening a verification gate or a review. Already ` +
	`batching, or nothing to pair? Reissue it unchanged; this fires once per streak. ${RULE_POINTER}`

// A whole-file write earns a notice, not a refusal: a `Write` cannot be refused safely.
const NOTICE =
	`💡 batching: ${STREAK}; the Write proceeds. Issue the writes that do not need its result in one ` +
	`turn, never by weakening a gate or a review. ${RULE_POINTER}`

// A headless lane child ends its turn on a denial, so a refusable call there earns a notice instead.
// It recurs every single-call turn, so it is kept to one line.
const LANE_NOTICE = `💡 batching: ${STREAK}; the call proceeds. Pair independent calls. ${RULE_POINTER}`

// Never refused: its reissue overwrites an applied sibling edit with no error anywhere.
const WHOLE_FILE_WRITE_TOOL = 'Write'

// The one tool the write-side fold names; `Write` cannot be content-addressed by `edit:files`.
const EDIT_TOOL = 'Edit'

// Asked before the transcript is read, so the hook skips the read for calls it can never refuse.
// Bundleable is the whole test — the criterion is dependency, not the kind of call.
function is_guarded_call(call: GuardedCall): boolean {
	if (call.name === WHOLE_FILE_WRITE_TOOL) return false

	return time_bundle_call.call_facts(call.name, call.input).is_bundleable
}

function is_notice_call(call: GuardedCall): boolean {
	return call.name === WHOLE_FILE_WRITE_TOOL
}

// For `investigation-reads.ts`, which refuses only unambiguous reads. `may_write` over-calls, as a
// refusal test must.
function is_read_only_call(call: GuardedCall): boolean {
	const facts = time_bundle_call.call_facts(call.name, call.input)

	return facts.is_bundleable && !facts.may_write
}

// A shared target is a dependency. Unlike `time_bundles.is_dependent`, a write after a write is not
// exempt: refusing an edit to a file the run is rewriting would reissue against moved text.
function depends_on_sequence(sequence: ReadonlyArray<Span>, facts: BundleFacts): boolean {
	return sequence.some((span) => time_bundles.shares_target(span.targets, facts.targets))
}

// A clock that jumped backwards withholds the firing — the safe direction.
function sequence_started_ms(sequence: ReadonlyArray<Span>): number {
	return sequence[0]?.ended_ms ?? NONE
}

function turns_since(sequence: ReadonlyArray<Span>, last_fired_ms: number): number {
	return sequence.filter((span) => span.ended_ms > last_fired_ms).length
}

// A firing before the open sequence makes this its first; inside it, re-fire every `refire_every` turns.
function is_sequence_at_limit(
	sequence: ReadonlyArray<Span>,
	facts: BundleFacts,
	last_fired_ms: number,
	refire_every: number,
): boolean {
	if (sequence.length < SEQUENCE_BEFORE_LIMIT || depends_on_sequence(sequence, facts)) return false

	if (last_fired_ms < sequence_started_ms(sequence)) return true

	return turns_since(sequence, last_fired_ms) >= refire_every
}

// Shared by the refusal and the notice so they agree on "three in a row"; takes parsed spans so the
// transcript is parsed once.
function is_at_limit(
	spans: ReadonlyArray<Span>,
	call: GuardedCall,
	last_fired_ms: number,
	refire_every: number,
): boolean {
	return is_sequence_at_limit(
		time_bundles.open_sequence(spans),
		time_bundle_call.call_facts(call.name, call.input),
		last_fired_ms,
		refire_every,
	)
}

// Derived from REASON, so the two never disagree about which transcript refusals are this guard's.
const GUARD_LABEL = time_transcript_line.guard_from_refusal(REASON)

// An unchanged reissue of a refused call had nothing to batch, so it is let through. Matched by the
// same identity the report uses, it survives a sequence start that scrolled out of the window.
function is_reissued_refusal(spans: ReadonlyArray<Span>, call: GuardedCall): boolean {
	const identity = time_call_identity.identity_of(
		time_spans.to_tool_call(call.name, call.input, time_spans.NO_MESSAGE_ID),
	)

	return spans.some(
		(span) =>
			span.refusal_guard === GUARD_LABEL && time_call_identity.identity_of(span) === identity,
	)
}

// The lane-child notice passes `NOTICE_REFIRE_EVERY` to recur on the notice's cadence.
function should_block(
	text: string,
	call: GuardedCall,
	refused_at_ms: number,
	refire_every: number = REFIRE_EVERY,
): boolean {
	if (!is_guarded_call(call)) return false

	const { spans } = time_spans.parse_timeline(text)

	if (is_reissued_refusal(spans, call)) return false

	return is_at_limit(spans, call, refused_at_ms, refire_every)
}

// `notified_at_ms` is the notice's own record, so a notice never silences a later refusal.
function should_notify(text: string, call: GuardedCall, notified_at_ms: number): boolean {
	if (!is_notice_call(call)) return false

	const { spans } = time_spans.parse_timeline(text)

	return is_at_limit(spans, call, notified_at_ms, NOTICE_REFIRE_EVERY)
}

// The target is appended only where the label does not already carry it.
function describe_span(span: NamedCall): string {
	const target = span.targets[0] ?? ''
	if (target === '' || span.label.includes(target)) return span.label

	return `${span.label} ${target}`
}

const FOLD_MINIMUM = 2

// File paths only: no target, a write, or a directory (`read:files` cannot read one) is dropped.
function read_targets(sequence: ReadonlyArray<NamedCall>): ReadonlyArray<string> {
	const paths = sequence
		.filter((span) => span.is_bundleable && !span.is_writing)
		.map((span) => span.targets[0] ?? '')
		.filter((path) => path !== '' && time_bundle_call.has_extension(path))

	return [...new Set(paths)]
}

// A paste-ready composite command moves density where asking for parallel calls did not.
function read_fold_directive(sequence: ReadonlyArray<NamedCall>): string {
	const paths = read_targets(sequence)
	if (paths.length < FOLD_MINIMUM) return ''

	return ` Fold them into one call: \`pnpm josh read:files ${paths.join(' ')}\`.`
}

// The write-side fold: an edit carries its own text, so it names the files for one `edit:files` plan.
function write_targets(sequence: ReadonlyArray<NamedCall>): ReadonlyArray<string> {
	const paths = sequence
		.filter((span) => span.label === EDIT_TOOL)
		.map((span) => span.targets[0] ?? '')
		.filter((path) => path !== '' && time_bundle_call.has_extension(path))

	return [...new Set(paths)]
}

function write_fold_directive(sequence: ReadonlyArray<NamedCall>): string {
	const paths = write_targets(sequence)
	if (paths.length < FOLD_MINIMUM) return ''

	return ` Fold them into one \`pnpm josh edit:files\` call with a plan over: ${paths.join(' ')}.`
}

// Shared by the notice and the live density line, so both word the same calls alike.
function name_candidates(calls: ReadonlyArray<NamedCall>): string {
	if (calls.length === NONE) return ''

	const named = calls.map((call) => describe_span(call)).join(', ')
	const folds = `${read_fold_directive(calls)}${write_fold_directive(calls)}`

	return ` Just issued one per turn, so at least these could have shared a turn: ${named}.${folds}`
}

// Re-parsed here rather than threaded through: it runs only when a notice actually fires.
function recent_candidates(tail: string): string {
	return name_candidates(
		time_bundles.open_sequence(time_spans.parse_timeline(tail).spans).slice(-NAMED_CANDIDATE_COUNT),
	)
}

// For the `PostToolUse` density line, a lane's only batching signal. The call in hand is named after
// the closed turns unless it depends on them or is not bundleable; empty means nothing to name.
function pairing_candidates(tail: string, call: GuardedCall | undefined): string {
	const sequence = time_bundles.open_sequence(time_spans.parse_timeline(tail).spans)

	if (call === undefined || sequence.length === NONE) {
		return name_candidates(sequence.slice(-NAMED_CANDIDATE_COUNT))
	}

	const facts = time_bundle_call.call_facts(call.name, call.input)

	if (!facts.is_bundleable || depends_on_sequence(sequence, facts)) return ''

	const current = time_spans.to_tool_call(call.name, call.input, time_spans.NO_MESSAGE_ID)

	return name_candidates([...sequence.slice(ONE_TURN - NAMED_CANDIDATE_COUNT), current])
}

// Here rather than in `batch-guard.ts`: `delivered-rules.ts` reads the same record.
const STAMP_PREFIX = 'josh-batch-guard-'

// Separate, so the notice and the refusal dedupe independently.
const NOTICE_STAMP_PREFIX = 'josh-batch-guard-notice-'

const time_batch_guard = {
	CONSECUTIVE_LIMIT,
	GUARD_LABEL,
	LANE_NOTICE,
	NOTICE,
	NOTICE_REFIRE_EVERY,
	NOTICE_STAMP_PREFIX,
	REASON,
	REFIRE_EVERY,
	SEQUENCE_BEFORE_LIMIT,
	STAMP_PREFIX,
	is_guarded_call,
	is_notice_call,
	is_read_only_call,
	pairing_candidates,
	recent_candidates,
	should_block,
	should_notify,
}

export type { GuardedCall }
export { time_batch_guard }
