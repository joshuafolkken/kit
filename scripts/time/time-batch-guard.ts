import { time_bundle_call, type BundleFacts } from './time-bundle-call'
import { time_bundles } from './time-bundles'
import { time_spans, type Span } from './time-spans'

// Whether the call about to go out should be refused because the run has stopped batching
// (joshuafolkken/kit#1390).
//
// Two mechanisms already exist and neither moved the number. joshuafolkken/kit#1304 distributed the
// norm as prose; joshuafolkken/kit#1329 and joshuafolkken/kit#1337 put the density in front of the run
// while it was still going. Three consecutive runs measured 1.10–1.12 calls per round trip against a
// 1.50 floor, with 14–27 of every hundred round trips recoverable (joshuafolkken/kit#1344). What is
// left is not another way to *say* it: it is intervening in the decision itself.
//
// **The judgement is `time-bundle-call.ts`'s and `time-bundles.ts`'s, not a second one.** Whether a
// call is bundleable, what it names, and what counts as a run of single-call turns are already
// decided — by the very modules the end-of-run report is computed from. A guard with an opinion of its
// own would refuse calls the report then says were fine, and the Issue's own verification step reads
// that report.
//
// ## What it cannot know: the size of the turn it is interrupting
//
// **A `PreToolUse` hook cannot tell a batched turn from a single-call one, and no field in the
// transcript can be made to say.** Claude Code writes one line per content block and starts the first
// tool as soon as that block parses — measured on a live session, the later `tool_use` lines of one
// message arrive **1.4 to 15 seconds afterwards**. So at the instant the first call of a turn is
// judged, the turn looks single-call whatever it will turn out to be. `stop_reason` is no help: every
// line of a message carries the finished message's value, including the `thinking` line written before
// any tool ran, so it says nothing about how much of the message exists yet.
//
// **The guard therefore decides on closed history alone** — the run of single-call turns already
// behind it — and the refusal lands on the first call of the turn that follows. Where that turn was
// going to batch, the refusal is a false positive costing one round trip, which is the price
// joshuafolkken/kit#1390 named and accepted before this was built.
//
// **Reading the count anyway would have been worse than not reading it.** `time_density.last_turn_calls`
// answers exactly this question after the fact, and calling it here returns `1` for every turn — so a
// guard written against it would refuse the first call of every batched turn while reporting that it
// had checked. That is the first call of the very behavior this exists to produce, punished with a
// verdict nobody could see was empty.
//
// ## The refusal cannot repeat while the sequence is in view
//
// A refusal repeating on the call in hand would wedge a run, and that is made structurally impossible:
// the caller records when it last refused, and a sequence qualifies only if it *began* after that
// instant. A refused call extends the sequence rather than restarting it, and a sequence's start does
// not move between two calls seconds apart — so the immediate re-refusal cannot happen, and a turn can
// have at most one of its calls refused. The run has to batch (or issue a dependent or non-bundleable
// call) before a new sequence starts and the guard has anything to say again.
//
// **What that argument does not cover is a sequence outliving the window the caller reads.** The start
// compared here is the first span *in that window*, so an unbroken run of single-call turns longer than
// it — 23–34 round trips, measured on these transcripts — presents a start that has moved forward, and
// is refused a second time. **That is bounded rather than a loop**: one extra round trip per window of
// unbroken single-calling, which is behavior worth having. Closing it exactly would cost the mechanism
// its life — the only test that does so (refuse only where the recorded instant is itself inside the
// window) silences the guard permanently once the window passes the last refusal.
//
// **And the caller must fail toward allowing.** With no instant on record every sequence looks new, so
// a caller that cannot record the refusal must not make it. `scripts/batch-guard.ts` states that half.

// How many consecutive single-call turns are allowed before one is refused. **Three, from the
// measurement rather than from taste**: joshuafolkken/kit#1344 found the longest bundleable sequence
// of each run at 3–5 turns, so refusing at the third catches most sequences while they still have
// turns left to save. Four or more gives most of them back; two would refuse the ordinary pair a
// person would never call a defect.
const CONSECUTIVE_LIMIT = 3
const ONE_TURN = 1
const NONE = 0

// **The turns already closed, so the one being interrupted is not among them.** A span exists only
// once its result has come back, and the call being judged has not run yet — so a sequence of
// `CONSECUTIVE_LIMIT - 1` closed turns is the state in which the next call would make the third.
const SEQUENCE_BEFORE_LIMIT = CONSECUTIVE_LIMIT - ONE_TURN

// The call about to go out, named the way the hook payload names it. A record rather than two
// parameters so the tool and its input cannot be handed over in the wrong order — both are strings on
// the caller's side often enough for that to compile.
interface GuardedCall {
	name: string
	input: unknown
}

// **A write is refusable, and the exclusion that said otherwise is gone** (joshuafolkken/kit#1762).
// Read over 19 recorded runs, 261 of 1,737 round trips (15.0%) were recoverable by batching and **184
// of them (70.5%) were writes** — 158 `Edit` alone. The refusal's own text has always said the rule
// covers them ("edits are covered exactly as reads are"); the implementation had not caught up, so the
// largest single contributor to the waste was the one party the guard could never reach.
//
// **Two different things were rejected before this, and separating them is what unblocked it.** What
// was rejected on measured cost is *widening the hook's matcher and nothing else*: a matcher naming
// `Edit` in front of an `is_guarded_call` that answers `false` for every write starts a process that
// can only ever answer "allow". That reasoning is sound and is untouched — the predicate is widened
// first, so the matcher now reaches a question that has an answer. What was **not** rejected, because
// nobody had proposed it, is making a write refusable at all; "buy nothing a refusal could use" was a
// consequence of the exclusion below it rather than a ground of its own.
//
// **The safety objection was real, and it is narrowed rather than dismissed.** Claude Code denies one
// call of a turn and runs the rest, so a refused edit leaves its siblings applied and itself not, and
// the reissue can meet text that has moved under it. `depends_on_sequence` below closes the half that
// is visible: it withholds the refusal whenever the call in hand shares a target with the sequence
// behind it, writes included, so an edit to a file the run has already been rewriting is never
// refused.
//
// **The half it cannot close is the turn it is interrupting** — for the reason stated above, no field
// in the transcript says what else that turn issued. Three edits to one file batched into a single
// turn can therefore have their first refused while the other two apply. **The bound is that this
// surfaces rather than corrupts**: a refusable write is content-addressed — an `Edit` carries the
// `old_string` it was written against, an in-place `sed` a pattern — so a reissue either applies where
// it was meant to or fails to match and is reported. So the residual cost is one round trip in the
// ordinary case and a failed edit the run must redo in this one — the same false-positive price
// joshuafolkken/kit#1390 named and accepted for reads, now paid on the calls that carry most of the
// waste instead of only on the calls that carry the rest.
//
// **The dispatch it adds is measured, and it is not the figure the deleted text quoted.** One hook run
// is **0.53 s** in this checkout and about 0.4 s in a consumer, essentially all of it process startup —
// measured under `docs/josh-commands.md` → "`josh format:edited`", which is where that reading was
// taken. The "about 2.4 s" above was a `pnpm josh` dispatch measured before joshuafolkken/kit#1342 made
// this command eligible for the in-process path. Against that, one recovered round trip is a whole
// model turn.
//
// **The matcher is settings a consumer can widen, so what a call is stays this module's answer.**
// `is_guarded_call` is the guarantee and `.claude/settings.json` is the wiring; the two are kept apart
// so a consumer editing the second cannot change the first.
//
// **What a call *is* lives in `time-bundle-call.ts`** since joshuafolkken/kit#1509, beside the rest of
// it, because the sequence builder needs the same answer and a second copy here is what let the two
// disagree — the builder had no way to ask at all, so it read a run of edits to one file as a chain of
// dependent calls and no sequence ever formed.

// One line, and it says four things: what happened, what to do instead, where the rule is written, and
// what to do when the turn was already batching or the call really is alone. **The last of those is not
// a loophole, it is the honest half** — the guard cannot see the turn it interrupted, so a reader told
// only to batch would batch something that already was.
const REASON =
	`⛔ batching: the last ${String(SEQUENCE_BEFORE_LIMIT)} turns each issued a single tool call, so ` +
	`this one would make ${String(CONSECUTIVE_LIMIT)} in a row. Reissue it in one turn together with ` +
	`the calls meant to follow it that do not need its result. **The criterion is whether this call's ` +
	`input needs another call's result, not what kind of call it is** — edits are covered exactly as ` +
	`reads are, and it never authorizes weakening a verification gate or a review: fewer turns, never ` +
	`less work. The measured cost and the rejected mechanisms are in ` +
	`\`prompts/collaboration-workflow/turn-batching.md\`. If this turn was already batching, or the call ` +
	`genuinely has nothing to go beside it, reissue it as it was: this fires once per run of ` +
	`single-call turns and cannot repeat on the call in hand.`

// The one write that is never refused, because it is the one whose reissue is **unconditional**. Every
// other refusable write is content-addressed and so fails loudly when its turn's siblings moved the
// text under it; a `Write` carries the whole file, so reissuing it re-applies content composed before
// those siblings ran and overwrites an applied edit with no error anywhere. **A turn holding a `Write`
// and an `Edit` of one file is a shape a run actually produces** — create it, then adjust it — which is
// what separates this from a truncating shell redirect, where the colliding turn would have to hold two
// writers of one path and is not a shape that occurs.
//
// **It is not the blanket exclusion joshuafolkken/kit#1762 removed.** That one turned away every write
// for being a write; this turns away one tool because a false positive on it cannot surface. `Edit` —
// 164 of the 251 recoverable round trips against `Write`'s 37, read over 20 runs — is untouched, and
// the matcher leaves `Write` out for the cost reason above rather than relying on this line alone.
const WHOLE_FILE_WRITE_TOOL = 'Write'

// Whether this call is one the guard could ever refuse, asked before any transcript is read. **The
// caller uses it to skip that read**: a quarter-megabyte read inside a hook that holds every call is
// not worth paying on a `pnpm josh` invocation the answer can never be about.
//
// **Bundleable is the whole test, because the criterion is dependency and not the kind of call.** The
// `may_write` term that used to sit beside it excluded the 70.5% of recoverable round trips that are
// writes (joshuafolkken/kit#1762). What keeps a write that genuinely cannot be refused safe is
// `depends_on_sequence`, which reads the targets, rather than a blanket exclusion here.
function is_guarded_call(call: GuardedCall): boolean {
	if (call.name === WHOLE_FILE_WRITE_TOOL) return false

	return time_bundle_call.call_facts(call.name, call.input).is_bundleable
}

// The same question narrowed to calls that write nothing — the test `is_guarded_call` used to be, kept
// under a name that says what it asks rather than deleted. **`scripts/delegation/investigation-reads.ts`
// is its caller**, and it needs this answer rather than the one above: it refuses a `Bash` line only
// where that line is unambiguously a read, so an in-place `sed` stays outside its reach even now that
// the batching guard can refuse one. Widening the single predicate in place would have loosened that
// guard silently, which is the one way this change could have gone wrong without a test noticing.
//
// **`may_write`, not `is_writing`** — this is a refusal test, and it is the one that has to over-call.
// The dependency test reads the other field, which may not (joshuafolkken/kit#1509).
function is_read_only_call(call: GuardedCall): boolean {
	const facts = time_bundle_call.call_facts(call.name, call.input)

	return facts.is_bundleable && !facts.may_write
}

// **A shared target is a dependency, and it is what keeps the guard off the search-then-read pair.**
// `time-bundles.ts` treats two calls naming the same path — or one naming a directory the other reads
// inside of — as ordered, and reuses that test here so a call the report would never have counted as
// recoverable is never refused either.
//
// **It asks for the shared target alone, where `time_bundles.is_dependent` exempts a write following a
// write, because the two are answering different questions** (joshuafolkken/kit#1762). The builder asks
// "could these two have gone out together", and for two edits to one file the answer is yes — that
// exemption is what lets such a stretch form a sequence at all (joshuafolkken/kit#1509). This asks "is
// refusing this one safe", and there the same pair is the one case where it is not: the siblings of a
// refused edit still run, so an edit naming a file the run is already rewriting comes back to text that
// has moved under it. Both sides read `shares_target`, so there is one definition of what sharing a
// target means and two uses of it rather than a second copy.
function depends_on_sequence(sequence: ReadonlyArray<Span>, facts: BundleFacts): boolean {
	return sequence.some((span) => time_bundles.shares_target(span.targets, facts.targets))
}

// The instant the open sequence began, as far as the window shows. An empty sequence answers `NONE`,
// and `NONE` is never greater than a recorded refusal — so the length test below is what actually
// admits a run, and this can only ever withhold.
//
// **Both sides of that comparison are the same machine's wall clock**: the transcript's timestamps and
// the instant the caller recorded. A clock that jumped backwards makes a record read as later than
// every sequence, which withholds the refusal — the safe direction, and the one every other failure
// here takes too.
function sequence_started_ms(sequence: ReadonlyArray<Span>): number {
	return sequence[0]?.ended_ms ?? NONE
}

function is_sequence_at_limit(
	sequence: ReadonlyArray<Span>,
	facts: BundleFacts,
	refused_at_ms: number,
): boolean {
	if (sequence.length < SEQUENCE_BEFORE_LIMIT) return false
	if (depends_on_sequence(sequence, facts)) return false

	return sequence_started_ms(sequence) > refused_at_ms
}

// `text` is the transcript tail the caller read, `refused_at_ms` the instant it last refused — zero
// where it never has, which makes the first sequence of a run eligible.
//
// **Nothing here reads the turn the call belongs to**, because nothing can: see "What it cannot know"
// above. The two call-shaped tests are asked of the call in hand, and everything else of the turns
// behind it.
function should_block(text: string, call: GuardedCall, refused_at_ms: number): boolean {
	if (!is_guarded_call(call)) return false

	return is_sequence_at_limit(
		time_bundles.open_sequence(time_spans.parse_timeline(text).spans),
		time_bundle_call.call_facts(call.name, call.input),
		refused_at_ms,
	)
}

// **This guard's own name for its once-per-run record.** It lives beside the rule rather than in
// `batch-guard.ts` because a second module now has to read the same record: `delivered-rules.ts`
// stands aside for this guard and has to ask whether it has *already* refused, and a second copy of
// the string is the clone that would let the two disagree about which file they are reading.
const STAMP_PREFIX = 'josh-batch-guard-'

const time_batch_guard = {
	CONSECUTIVE_LIMIT,
	REASON,
	SEQUENCE_BEFORE_LIMIT,
	STAMP_PREFIX,
	is_guarded_call,
	is_read_only_call,
	should_block,
}

export type { GuardedCall }
export { time_batch_guard }
