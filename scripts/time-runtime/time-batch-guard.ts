import { time_bundle_call, type BundleFacts } from './time-bundle-call'
import { time_bundles } from './time-bundles'
import { time_call_identity } from './time-call-identity'
import { time_spans, type Span } from './time-spans'
import { time_transcript_line } from './time-transcript-line'

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
// ## The refusal cannot repeat on the call in hand, but it does repeat as the run keeps single-calling
//
// A refusal repeating on the *same call* would wedge a run, and that is made structurally impossible in
// two ways. The caller records when it last fired, and the immediate re-look never re-fires: a call the
// run answered by re-issuing it unchanged is found on a refused span in the tail (`is_reissued_refusal`)
// and let through, so a turn can have at most one of its calls refused.
//
// **What used to follow from the record was silence for the rest of the run, and kit#2164 is what ends
// that.** The old rule fired only where the open sequence *began* after the last firing — and a run that
// ignored the refusal and kept single-calling never started a new sequence, so it was never spoken to
// again. Measured across every run, that came to one refusal per run against thousands of turns. The
// rule now fires the first time a run of single-call turns reaches the limit, and then **again every
// `REFIRE_EVERY` further single-call turns** it keeps issuing: `is_sequence_at_limit` counts the closed
// single-call turns since the last firing and re-fires once that count reaches the interval. A new
// sequence — the run batched, then lapsed again — is a first firing of its own, exactly as before.
//
// **The re-fire cannot wedge**, for the same reason the first firing cannot: each re-fire refuses a
// *different* call than the one already on a refused span, and a call the run re-issues unchanged after a
// re-fire is let through by `is_reissued_refusal` just as the first refusal's re-issue is.
//
// **And the caller must fail toward allowing.** With no instant on record every sequence looks new, so
// a caller that cannot record the refusal must not make it. `scripts/hooks/batch-guard.ts` states that half.

// How many consecutive single-call turns are allowed before one is refused. **Three, from the
// measurement rather than from taste**: joshuafolkken/kit#1344 found the longest bundleable sequence
// of each run at 3–5 turns, so refusing at the third catches most sequences while they still have
// turns left to save. Four or more gives most of them back; two would refuse the ordinary pair a
// person would never call a defect.
const CONSECUTIVE_LIMIT = 3

// **How many further single-call turns pass between one firing and the next, once a run keeps
// single-calling after being spoken to** (joshuafolkken/kit#2164). This is the `N` the acceptance
// criteria name, and it lives here as a single constant. Before this the guard fired once per unbroken
// run of single-call turns and then went silent — a run that ignored the first refusal and kept issuing
// single calls was never spoken to again, so over thousands of turns the guard delivered one notice. The
// re-fire turns that back into steady pressure: the same `CONSECUTIVE_LIMIT` cadence the first firing
// used, applied again from the last firing, so the reminder recurs every three continued single-call
// turns rather than once. It is deliberately not more frequent than the initial limit — a shorter
// interval would refuse a run that is only two single calls past a reminder it just answered.
const REFIRE_EVERY = CONSECUTIVE_LIMIT
const ONE_TURN = 1
const NONE = 0

// **The notice's own re-fire interval, and the `N` joshuafolkken/kit#2276 measured as too long.** A
// refusal that fired every single-call turn would refuse a run only one call past a reminder it just
// answered, so `REFIRE_EVERY` holds the refusal at the initial limit. **A notice cannot wedge** — the
// call proceeds either way — so nothing makes the notice pay that caution, and #2164 reusing the
// refusal's three-turn cadence for it is why a lane child single-calling was nudged only once per three
// mistakes. This is a single constant, the one the acceptance criteria name, kept apart from
// `REFIRE_EVERY` so the refusal's cadence and the notice's cannot drift into one number that is wrong
// for one of them.
const NOTICE_REFIRE_EVERY = ONE_TURN

// **How many of the most recent single-call turns the notice names** (joshuafolkken/kit#2276). #2164's
// notice ended at "batch what follows" and named no call, and the density did not move; naming the
// concrete calls the run just issued one-per-turn is the untried half of "why it did not work" — a
// reader shown *these three reads had no dependency* has something to act on that "batch more" never
// gave. Three, so the notice carries the sequence that tripped the limit without growing the per-turn
// context it rides on.
const NAMED_CANDIDATE_COUNT = 3

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

// The notice a whole-file write earns instead of the refusal above (joshuafolkken/kit#1848). It says
// the same thing REASON does — reissue the calls that do not need each other in one turn — but as a
// **notice, not a refusal**: the write proceeds, because a `Write` cannot be refused safely (see
// `WHOLE_FILE_WRITE_TOOL` below). The honest half is here for the same reason it is on REASON — the
// guard cannot see the turn it is interrupting, so a reader told only to batch would batch a turn that
// already was. It carries no ⛔, so a person watching reads it as advice rather than a stop.
const NOTICE =
	`💡 batching: the last ${String(SEQUENCE_BEFORE_LIMIT)} turns each issued a single tool call, so ` +
	`this Write makes ${String(CONSECUTIVE_LIMIT)} in a row. This is a notice, not a refusal — the ` +
	`write proceeds. Where the writes meant to follow it do not need its result, issue them in one turn ` +
	`together. **The criterion is whether a call's input needs another call's result, not what kind of ` +
	`call it is** — it never authorizes weakening a verification gate or a review: fewer turns, never ` +
	`less work. The measured cost and the rejected mechanisms are in ` +
	`\`prompts/collaboration-workflow/turn-batching.md\`. If this run was already batching, or the write ` +
	`genuinely has nothing to go beside it, carry on: this recurs every ` +
	`${String(NOTICE_REFIRE_EVERY)} further single-call turn(s).`

// The notice a *refusable* call earns instead of its refusal when the run is a dispatched lane child
// (joshuafolkken/kit#2164). A headless `claude -p` child ends its turn on a denial, so the batching
// guard cannot refuse there — but the guidance is exactly as useful, so it is delivered as a notice: the
// call proceeds, and the model is told to batch what follows. It carries no ⛔, so a person watching
// reads it as advice rather than a stop, and it says the reminder recurs so a child that keeps
// single-calling knows the pressure is steady rather than spent.
const LANE_NOTICE =
	`💡 batching: the last ${String(SEQUENCE_BEFORE_LIMIT)} turns each issued a single tool call, so ` +
	`this one makes ${String(CONSECUTIVE_LIMIT)} in a row. This is a notice, not a refusal — the call ` +
	`proceeds, because a dispatched lane child ends its turn on a denial. Where the calls meant to follow ` +
	`it do not need its result, issue them in one turn together. **The criterion is whether a call's ` +
	`input needs another call's result, not what kind of call it is** — it never authorizes weakening a ` +
	`verification gate or a review: fewer turns, never less work. The measured cost and the rejected ` +
	`mechanisms are in \`prompts/collaboration-workflow/turn-batching.md\`. If this run was already ` +
	`batching, or the call genuinely has nothing to go beside it, carry on: this recurs every ` +
	`${String(NOTICE_REFIRE_EVERY)} further single-call turn(s).`

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

// The one tool the write-side fold names (joshuafolkken/kit#2366). A span's label is its tool name for
// everything but Bash (`time-spans.ts`), so this is how a recent single-call turn is read as an edit
// that `edit:files` could fold — distinct from `Write`, which this command cannot content-address.
const EDIT_TOOL = 'Edit'

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

// The counterpart to `is_guarded_call` for the one tool it turns away: the whole-file write is the
// call the guard **notifies** about rather than refuses (joshuafolkken/kit#1848). It cannot be refused
// safely — its reissue overwrites an applied sibling in silence — yet a run of single-call `Write`
// turns was the largest recoverable contributor the refusal could never reach, so the notice carries
// the rule to it without the false-positive cost. `.claude/settings.json` names `Write` in the matcher
// so the hook is even reached, exactly as the predicate is what makes the matcher's answer non-empty.
function is_notice_call(call: GuardedCall): boolean {
	return call.name === WHOLE_FILE_WRITE_TOOL
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
// and `NONE` is never greater than a recorded refusal — so the length test in `is_sequence_at_limit` is
// what admits a run's first firing, and this decides only whether that firing is the sequence's first.
//
// **Both sides of that comparison are the same machine's wall clock**: the transcript's timestamps and
// the instant the caller recorded. A clock that jumped backwards makes a record read as later than
// every sequence, which withholds the firing — the safe direction, and the one every other failure here
// takes too.
function sequence_started_ms(sequence: ReadonlyArray<Span>): number {
	return sequence[0]?.ended_ms ?? NONE
}

// How many of the open sequence's closed single-call turns ended after the last firing. For a run whose
// last firing predates this sequence every turn counts; for one already spoken to inside this sequence
// only the turns issued since count — which is what the re-fire interval is measured against.
function turns_since(sequence: ReadonlyArray<Span>, last_fired_ms: number): number {
	return sequence.filter((span) => span.ended_ms > last_fired_ms).length
}

// **The firing test, first-time and re-fire in one** (joshuafolkken/kit#2164). The length and dependency
// gates are unchanged. What changed is the instant comparison: where a firing predates the open
// sequence it is that sequence's first, so the length gate alone decides it; where the run has already
// been spoken to inside this sequence, it re-fires only once `REFIRE_EVERY` further single-call turns
// have closed since. The old rule kept only the first branch, which is why it fell silent for the rest
// of a run that kept single-calling.
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

// **Nothing here reads the turn the call belongs to**, because nothing can: see "What it cannot know"
// above. The two call-shaped tests are asked of the call in hand, and everything else of the turns
// behind it.
// The sequence test both dispositions share, over spans the caller has already parsed: is the open run
// of single-call turns at the limit, for a call that began after the last time this disposition fired.
// Shared so the refusal and the notice cannot drift apart on what "three in a row" means
// (joshuafolkken/kit#1848), and taking spans rather than the tail so a disposition that also asks
// `is_reissued_refusal` parses the transcript once (joshuafolkken/kit#1979).
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

// This guard's own refusal label, as `time-transcript-line.ts` reads it back off a refused result: the
// token after the ⛔ and before the first colon of REASON. Derived from REASON rather than written a
// second time, so the two can never disagree about which refusals in the transcript are this guard's
// (joshuafolkken/kit#1979).
const GUARD_LABEL = time_transcript_line.guard_from_refusal(REASON)

// **A call the guard has already refused, found in the tail by the same identity the report compares
// re-issues on** (joshuafolkken/kit#1979). A refused call the run answered by re-issuing it unchanged
// is one that had nothing to batch — refusing the re-issue again buys a round trip and no batching,
// which is the waste `time-guard-refusals.ts`'s `same_args_reissue` counts. The identity is built
// through the same `to_tool_call` the transcript parse uses, so a refused span and the live call about
// to repeat it produce the identical string.
//
// **This is what the timestamp alone could not do.** `refused_at_ms` withholds the immediate
// re-refusal, but an unbroken run of single-call turns longer than the read window presents a sequence
// start that has moved forward and is refused again (see "What it cannot know" above). The refused span
// is still in the tail even when that start has scrolled out of view, so its identity is what survives.
// The first refusal of a novel call still fires — only a call already on a refused span of this guard's
// is let through, so a genuinely bundleable single call is refused exactly as before.
function is_reissued_refusal(spans: ReadonlyArray<Span>, call: GuardedCall): boolean {
	const identity = time_call_identity.identity_of(
		time_spans.to_tool_call(call.name, call.input, time_spans.NO_MESSAGE_ID),
	)

	return spans.some(
		(span) =>
			span.refusal_guard === GUARD_LABEL && time_call_identity.identity_of(span) === identity,
	)
}

// `refire_every` defaults to the refusal's cadence so every existing caller reads unchanged; the
// lane-child downgraded notice passes `NOTICE_REFIRE_EVERY` instead, so a refusable call turned into a
// notice recurs on the notice's tighter cadence rather than the refusal's (joshuafolkken/kit#2276).
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

// The notice's rule: the same sequence test, gated on the whole-file write rather than on a refusable
// call. `notified_at_ms` is read from the notice's **own** record, so a notice never spends the
// refusal's stamp and cannot silence a genuine refusal of a later read or edit on the same run. A
// whole-file write is never refused, so it has no re-issue to detect — the reissue test is the
// refusal's alone.
function should_notify(text: string, call: GuardedCall, notified_at_ms: number): boolean {
	if (!is_notice_call(call)) return false

	const { spans } = time_spans.parse_timeline(text)

	return is_at_limit(spans, call, notified_at_ms, NOTICE_REFIRE_EVERY)
}

// One recent single-call turn named the way a reader would recognize it: the tool, and the file it
// touched where the label does not already carry it (joshuafolkken/kit#2276). `label` is the tool name
// for a non-shell call and the command for a shell one, so the target is appended only where it adds
// something the label has not already said.
function describe_span(span: Span): string {
	const target = span.targets[0] ?? ''
	if (target === '' || span.label.includes(target)) return span.label

	return `${span.label} ${target}`
}

// **The fewest reads that a composite call can fold** (joshuafolkken/kit#2311). One path is a single
// call already, so nothing folds below two — the directive is withheld and the run keeps the guidance
// alone, exactly as it does when the recent turns were not reads at all.
const FOLD_MINIMUM = 2

// **The recent single-call turns that were file reads, each named by the one path it read.** A fold
// needs a *file* path, so three targets are dropped: one that named none (a bare `pwd`), a write (a run
// of edits has nothing for `read:files` to do), and a directory (`ls scripts/` names `scripts/`, which
// `read:files` cannot read — it would emit `Cannot read scripts/` and exit 1, so the paste-ready
// command must never carry it). The directory test is `has_extension` reused from the target scanner,
// not a second copy. Deduped, so a run that read one file twice folds it once and names it once.
function read_targets(sequence: ReadonlyArray<Span>): ReadonlyArray<string> {
	const paths = sequence
		.filter((span) => span.is_bundleable && !span.is_writing)
		.map((span) => span.targets[0] ?? '')
		.filter((path) => path !== '' && time_bundle_call.has_extension(path))

	return [...new Set(paths)]
}

// **The composite-command half of the notice** (joshuafolkken/kit#2311): the single call that folds the
// recent single-call reads, handed to the run ready to paste. Naming the concrete calls did not move the
// density (#2276) — the notice still asked the model to *reissue them in one turn*, which is a request
// for the parallel `tool_use` blocks the model structurally resists. The lever measured to move
// round-trip density is a composite command that folds a routine section into one call (`read:files`,
// kit#2202); so the guard now offers *that* command, the one the model can emit in a single turn,
// rather than another way to say "batch". Below two reads there is nothing to fold, so it is empty and
// the guidance stands alone.
function read_fold_directive(sequence: ReadonlyArray<Span>): string {
	const paths = read_targets(sequence)
	if (paths.length < FOLD_MINIMUM) return ''

	return ` Fold them into one call: \`pnpm josh read:files ${paths.join(' ')}\`.`
}

// **The write-side counterpart of the read fold** (joshuafolkken/kit#2366): the recent single-call
// `Edit` turns, folded into one `edit:files` call. The read fold pastes a whole command because a read
// is addressed by its path alone; an edit carries its own text, so the fold names the files and points
// at the command that applies a plan of edits over them in one call — the composite command the model
// can emit in a single turn where reissuing the edits as parallel `tool_use` blocks is the shape it
// resists. Only `Edit` counts: a whole-file `Write` creates content this command cannot content-address,
// and it earns its own notice already. Below two edits there is nothing to fold.
function write_targets(sequence: ReadonlyArray<Span>): ReadonlyArray<string> {
	const paths = sequence
		.filter((span) => span.label === EDIT_TOOL)
		.map((span) => span.targets[0] ?? '')
		.filter((path) => path !== '' && time_bundle_call.has_extension(path))

	return [...new Set(paths)]
}

function write_fold_directive(sequence: ReadonlyArray<Span>): string {
	const paths = write_targets(sequence)
	if (paths.length < FOLD_MINIMUM) return ''

	return ` Fold them into one \`pnpm josh edit:files\` call with a plan over: ${paths.join(' ')}.`
}

// **The concrete half of the notice** (joshuafolkken/kit#2276): the most recent single-call turns,
// named, so the model is shown the calls it should have batched rather than only told to batch — and,
// since kit#2311, the one `read:files` call that folds them where they were reads. Parsed from the tail
// here rather than threaded from `should_notify` because it runs only when a notice actually fires,
// which is rare enough that the second parse costs less than carrying the spans through the hook's
// notice contract. An empty sequence names nothing and the notice falls back to its guidance alone.
function recent_candidates(tail: string): string {
	const recent = time_bundles
		.open_sequence(time_spans.parse_timeline(tail).spans)
		.slice(-NAMED_CANDIDATE_COUNT)

	if (recent.length === NONE) return ''

	const named = recent.map((span) => describe_span(span)).join(', ')
	const folds = `${read_fold_directive(recent)}${write_fold_directive(recent)}`

	return ` Just issued one per turn, so at least these could have shared a turn: ${named}.${folds}`
}

// **This guard's own name for its once-per-run record.** It lives beside the rule rather than in
// `batch-guard.ts` because a second module now has to read the same record: `delivered-rules.ts`
// stands aside for this guard and has to ask whether it has *already* refused, and a second copy of
// the string is the clone that would let the two disagree about which file they are reading.
const STAMP_PREFIX = 'josh-batch-guard-'

// The notice's own record, distinct from `STAMP_PREFIX` so a notice fired on a Write cannot move the
// instant the refusal reads — the two dispositions dedupe independently, once each per run of
// single-call turns (joshuafolkken/kit#1848).
const NOTICE_STAMP_PREFIX = 'josh-batch-guard-notice-'

const time_batch_guard = {
	CONSECUTIVE_LIMIT,
	GUARD_LABEL,
	LANE_NOTICE,
	NAMED_CANDIDATE_COUNT,
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
	recent_candidates,
	should_block,
	should_notify,
}

export type { GuardedCall }
export { time_batch_guard }
