import { cost_blocks } from '#scripts/cost/cost-blocks'
import { time_bundle_call, type BundleFacts } from './time-bundle-call'
import { time_bundles } from './time-bundles'
import { time_shell } from './time-shell'
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

// **Refusing a write leaves a turn half applied, so no write is ever refused.** Claude Code denies one
// call and runs the turn's others, so the siblings of a refused edit land while it does not — and the
// reissued edit may no longer match the file they have since changed. "Could this have gone out beside
// another call" is `time-bundle-call.ts`'s question and is answered `true` for an edit deliberately,
// because the harness applies a turn's edits in order; "is this safe to refuse" is a different question
// and only this file needs it.
//
// **It is held here rather than at the hook's matcher, which names `Bash` alone.** A matcher is
// settings a consumer can widen; this is the guarantee, and it has to hold whatever the wiring says.
const WRITING_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'NotebookEdit'])
// The write words, matched **anywhere in the line rather than as its leading word**. A chain is
// labelled by its first segment — `cat notes.md && sed -i '' s/a/b/ src/x.ts` reads as `cat` — so the
// leading word says nothing about what the rest of the line does. That is the same shape, and the same
// reason, as `time-bundle-call.ts`'s own mutation-word scan, and the tokenizer is reused from there so
// the two cannot disagree about where a word ends.
//
// `sed` is on that module's read list deliberately — an in-place edit is what `Edit` does, and a turn
// may issue several. Here it is excluded outright rather than tested for `-i`: a read-only `sed` is
// then never refused, which is a call allowed that could have been refused.
const WRITING_WORDS: ReadonlySet<string> = new Set(['dd', 'sed', 'tee'])
// A redirection, tested as a character rather than a token, because `a.json>b.json` needs no spaces
// around it. It matches a `->` inside a grep pattern too, which again only allows a call that could
// have been refused — the direction every rule here leans.
const REDIRECTION = '>'

// One line, and it says four things: what happened, what to do instead, where the rule is written, and
// what to do when the turn was already batching or the call really is alone. **The last of those is not
// a loophole, it is the honest half** — the guard cannot see the turn it interrupted, so a reader told
// only to batch would batch something that already was.
const REASON =
	`⛔ batching: the last ${String(SEQUENCE_BEFORE_LIMIT)} turns each issued a single tool call, so ` +
	`this one would make ${String(CONSECUTIVE_LIMIT)} in a row. Reissue it in one turn together with ` +
	`the calls meant to follow it that do not need its result — CLAUDE.md → "Put every call that does ` +
	`not depend on another's result in the same turn". If this turn was already batching, or the call ` +
	`genuinely has nothing to go beside it, reissue it as it was: this fires once per run of ` +
	`single-call turns and cannot repeat on the call in hand.`

function is_writing_command(command: string): boolean {
	if (command.includes(REDIRECTION)) return true

	return time_bundle_call.words_of(command).some((word) => WRITING_WORDS.has(word))
}

function is_writing_call(call: GuardedCall): boolean {
	if (WRITING_TOOLS.has(call.name)) return true
	if (call.name !== cost_blocks.BASH_TOOL) return false

	return is_writing_command(time_shell.bash_command(call.input))
}

// Whether this call is one the guard could ever refuse, asked before any transcript is read. **The
// caller uses it to skip that read**: a quarter-megabyte read inside a hook that holds every call is
// not worth paying on a `pnpm josh` invocation the answer can never be about.
function is_guarded_call(call: GuardedCall): boolean {
	return time_bundle_call.call_facts(call.name, call.input).is_bundleable && !is_writing_call(call)
}

// **A shared target is a dependency, and it is what keeps the guard off the search-then-read pair.**
// `time-bundles.ts` treats two calls naming the same path — or one naming a directory the other reads
// inside of — as ordered, and reuses that test here so a call the report would never have counted as
// recoverable is never refused either.
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

const time_batch_guard = {
	CONSECUTIVE_LIMIT,
	REASON,
	SEQUENCE_BEFORE_LIMIT,
	is_guarded_call,
	should_block,
}

export type { GuardedCall }
export { time_batch_guard }
