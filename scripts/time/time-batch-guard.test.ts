import { describe, expect, it } from 'vitest'
import { time_batch_guard } from './time-batch-guard'
import { time_transcript_fixture } from './time-transcript-fixture'

// The guard reads a transcript rather than a span list, because the run of single-call turns it asks
// about is a shape only the raw lines carry: the turn in flight has issued no result yet, so it has no
// span, and where a turn ends is written on the lines rather than derivable from the spans. The fixture
// writes the lines Claude Code writes, so every case below is a transcript a run could have had.
//
// The minute grid is the fixture's: turn `n` issues on minute `2n + 1` and is answered on `2n + 2`.

const { open_turn_lines, target_turn_lines, ms } = time_transcript_fixture

const NEVER_REFUSED = 0
const FRESH_PATH = 'scripts/fresh.ts'
// A path-shaped word that appears only inside quotes (joshuafolkken/kit#1611).
const QUOTED_PATTERN = 'scripts/time'
const FRESH_CALL = { name: 'Read', input: { file_path: FRESH_PATH } }
// The two calls both tables below name, and their labels, so neither the fixture nor the wording is
// written twice.
const EDIT_LABEL = 'an edit'
const SED_LABEL = 'an in-place sed'
const FILE_READ_LABEL = 'a file read'
const EDIT_TOOL = 'Edit'
// Named the way this harness names it. Neither spelling of the delegation tool is in the bundleable
// set, so the case below would read the same under `Task`.
const DELEGATION_TOOL = 'Agent'
const WRITE_TOOL = 'Write'
const WRITE_LABEL = 'a whole-file write'
const EDIT_CALL = { name: EDIT_TOOL, input: { file_path: FRESH_PATH } }
const IN_PLACE_SED_CALL = { name: 'Bash', input: { command: `sed -i '' s/a/b/ ${FRESH_PATH}` } }
const SHELL_READ_CALL = { name: 'Bash', input: { command: `cat ${FRESH_PATH}` } }
const JOSH_CALL = { name: 'Bash', input: { command: 'pnpm josh gate' } }
const CHAINED_SED_CALL = {
	name: 'Bash',
	input: { command: `cat notes.md && sed -i '' s/a/b/ ${FRESH_PATH}` },
}
const REDIRECTION_CALL = { name: 'Bash', input: { command: "jq '.x' a.json > b.json" } }
const WRITE_CALL = { name: WRITE_TOOL, input: { file_path: FRESH_PATH } }

function transcript(...groups: Array<Array<string>>): string {
	return groups.flat().join('\n')
}

describe('time_batch_guard.should_block — the run of single-call turns', () => {
	it('refuses the call that would make a third consecutive single-call turn', () => {
		const text = transcript(
			target_turn_lines(0, ['a.ts']),
			target_turn_lines(1, ['b.ts']),
			open_turn_lines(2, ['c.ts']),
		)

		expect(time_batch_guard.should_block(text, FRESH_CALL, NEVER_REFUSED)).toBe(true)
	})

	// Two is the ordinary pair nobody would call a defect, and the limit is three.
	it('allows the call that would make only a second', () => {
		const text = transcript(target_turn_lines(0, ['a.ts']), open_turn_lines(1, ['c.ts']))

		expect(time_batch_guard.should_block(text, FRESH_CALL, NEVER_REFUSED)).toBe(false)
	})

	// **The turn being interrupted is not read, because it cannot be.** Claude Code starts a turn's
	// first tool 1.4–15 seconds before the turn's later `tool_use` lines are written, so an open turn
	// that will batch is indistinguishable from one that will not. This case pins the consequence
	// rather than pretending otherwise: the call is refused either way — once — and the reason says so.
	it('refuses without regard to how many calls the open turn will go on to issue', () => {
		const text = transcript(
			target_turn_lines(0, ['a.ts']),
			target_turn_lines(1, ['b.ts']),
			open_turn_lines(2, ['c.ts', 'd.ts']),
		)

		expect(time_batch_guard.should_block(text, FRESH_CALL, NEVER_REFUSED)).toBe(true)
	})

	// **The verdict must not change part-way through a turn.** A turn's earlier calls come back while
	// its later ones are still being judged, and folding those into the sequence lengthened it by one
	// mid-turn — measured live, the first call of a two-call turn was admitted and the second refused.
	// Only a turn boundary closes a trip, so an in-flight turn contributes nothing however far along it
	// is.
	it('does not count the in-flight turn as closed once its first call has come back', () => {
		const text = transcript(target_turn_lines(0, ['a.ts']), target_turn_lines(1, ['c.ts']))

		expect(time_batch_guard.should_block(text, FRESH_CALL, NEVER_REFUSED)).toBe(false)
	})

	// A turn that already batched breaks the run, so what precedes it cannot be carried across it.
	it('allows where a batched turn breaks the run of singles', () => {
		const text = transcript(
			target_turn_lines(0, ['a.ts']),
			target_turn_lines(1, ['b.ts', 'e.ts']),
			target_turn_lines(2, ['f.ts']),
			open_turn_lines(3, ['c.ts']),
		)

		expect(time_batch_guard.should_block(text, FRESH_CALL, NEVER_REFUSED)).toBe(false)
	})
})

// **The matcher is not the counter, and joshuafolkken/kit#1798 is what separates them.** A turn
// issuing one `Write` or one `Glob` is a turn `.claude/settings.json` never hands this guard, so no
// refusal can land on it — and it still extends the run, because what the counter reads is
// `is_bundleable` and every one of those tools is in that set. Pinned because the Issue's own premise
// was that an unmatched tool breaks the count: it does not, and a change made on that reading would
// have widened the counter as well as the wiring.
describe('time_batch_guard.should_block — a turn the matcher never reaches', () => {
	it.each([
		[WRITE_LABEL, WRITE_TOOL],
		['a glob', 'Glob'],
	])('counts %s turn toward the run it sits inside', (_label, name) => {
		const text = transcript(
			target_turn_lines(0, ['a.ts']),
			target_turn_lines(1, ['b.ts'], name),
			open_turn_lines(2, ['c.ts']),
		)

		expect(time_batch_guard.should_block(text, FRESH_CALL, NEVER_REFUSED)).toBe(true)
	})

	// The other half of the same line, and the boundary the widening must not cross: a delegation is not
	// bundleable, so it breaks the run rather than extending it — its result is what the next call needs,
	// which is the one reason a single-call turn was never recoverable in the first place.
	it('allows where a delegation breaks the run', () => {
		const text = transcript(
			target_turn_lines(0, ['a.ts']),
			target_turn_lines(1, ['b.ts'], DELEGATION_TOOL),
			open_turn_lines(2, ['c.ts']),
		)

		expect(time_batch_guard.should_block(text, FRESH_CALL, NEVER_REFUSED)).toBe(false)
	})
})

describe('time_batch_guard.should_block — what it will not refuse', () => {
	// The search-then-read pair: this call names a path an earlier one already named, so it could not
	// have gone out beside it and the end-of-run report would never have counted it as recoverable.
	it('allows a call that names a target the run already touched', () => {
		const text = transcript(
			target_turn_lines(0, ['a.ts']),
			target_turn_lines(1, ['b.ts']),
			open_turn_lines(2, ['c.ts']),
		)
		const dependent = { name: 'Read', input: { file_path: 'b.ts' } }

		expect(time_batch_guard.should_block(text, dependent, NEVER_REFUSED)).toBe(false)
	})

	// The bundleable set is what keeps `pnpm josh`, `git` and the `gh` write flags structurally
	// unreachable from here — a command that mutates the repository is not a call that could have gone
	// out beside another, whatever the run of single-call turns behind it looks like.
	it('allows a call that is not bundleable in the first place', () => {
		const text = transcript(
			target_turn_lines(0, ['a.ts']),
			target_turn_lines(1, ['b.ts']),
			open_turn_lines(2, ['c.ts']),
		)
		const merge = { name: 'Bash', input: { command: 'pnpm josh followup --merge' } }

		expect(time_batch_guard.should_block(text, merge, NEVER_REFUSED)).toBe(false)
	})

	it('allows where the transcript holds nothing to read', () => {
		expect(time_batch_guard.should_block('', FRESH_CALL, NEVER_REFUSED)).toBe(false)
	})
})

// joshuafolkken/kit#1762. Writes are **70.5% of the recoverable round trips** measured over 19 runs —
// 158 `Edit` of 261 — and the guard's own refusal text has always said the rule covers them. The
// exclusion that kept it from reaching any of them is gone, and what makes refusing one safe is the
// target test below rather than a blanket answer about the kind of call.
describe('time_batch_guard.should_block — writes', () => {
	it.each([
		[EDIT_LABEL, EDIT_CALL],
		[SED_LABEL, IN_PLACE_SED_CALL],
	])('refuses %s naming a file the run has not touched', (_label, call) => {
		const text = transcript(
			target_turn_lines(0, ['a.ts'], EDIT_TOOL),
			target_turn_lines(1, ['b.ts'], EDIT_TOOL),
			open_turn_lines(2, ['c.ts'], EDIT_TOOL),
		)

		expect(time_batch_guard.should_block(text, call, NEVER_REFUSED)).toBe(true)
	})

	// **The one write that stays out, and it is a different exclusion from the one this Issue removed.**
	// The bound on a false positive is that it surfaces: an `Edit` and an in-place `sed` are
	// content-addressed, so a reissue after the turn's siblings ran either applies where it was meant to
	// or fails and is reported. A `Write` carries the whole file, so reissuing it re-applies content
	// composed before those siblings ran and overwrites an applied edit with nothing raised anywhere —
	// and a turn holding a `Write` and an `Edit` of one file is a shape a run produces.
	it('allows a whole-file write, whose reissue could not fail loudly', () => {
		const text = transcript(
			target_turn_lines(0, ['a.ts'], EDIT_TOOL),
			target_turn_lines(1, ['b.ts'], EDIT_TOOL),
			open_turn_lines(2, ['c.ts'], EDIT_TOOL),
		)

		expect(time_batch_guard.should_block(text, WRITE_CALL, NEVER_REFUSED)).toBe(false)
	})

	// **This case is what the target test buys, and it is the one that separates the two
	// implementations.** `time_bundles.is_dependent` answers `false` for a write following a write —
	// deliberately, so a stretch of edits to one file forms a sequence at all (joshuafolkken/kit#1509) —
	// so a guard reading it here would refuse exactly the edit whose reissue is least safe: the siblings
	// of a refused call still run, and an edit to a file the run is already rewriting comes back to text
	// that has moved under it. `depends_on_sequence` asks `shares_target` instead, and with
	// `is_dependent` in its place this expectation flips to `true`.
	it('allows an edit naming a file the run has already been editing', () => {
		const text = transcript(
			target_turn_lines(0, ['a.ts'], EDIT_TOOL),
			target_turn_lines(1, [FRESH_PATH], EDIT_TOOL),
			open_turn_lines(2, ['c.ts'], EDIT_TOOL),
		)

		expect(time_batch_guard.should_block(text, EDIT_CALL, NEVER_REFUSED)).toBe(false)
	})
})

// The two tests the caller asks before reading a quarter-megabyte of transcript, so a `pnpm josh`
// invocation costs nothing but the hook's own start. **They are one table because the pair is the
// content of joshuafolkken/kit#1762**: `is_guarded_call` widened to "could this have gone out beside
// another call" and admits every write, while `is_read_only_call` is what it used to be and admits
// none. `scripts/delegation/investigation-reads.ts` asks the second — that guard counts *reading*, so
// an in-place `sed` stays outside its reach even now that the batching guard can refuse one, and
// widening the single predicate in place would have moved it silently.
//
// A chain is labelled by its first segment, so the leading word alone reads two of these as reads —
// scanning the whole line is what tells the two columns apart.
describe('time_batch_guard — what each predicate admits', () => {
	it.each([
		['a shell read', SHELL_READ_CALL, true, true],
		[FILE_READ_LABEL, FRESH_CALL, true, true],
		['a josh command', JOSH_CALL, false, false],
		[WRITE_LABEL, WRITE_CALL, false, false],
		[EDIT_LABEL, EDIT_CALL, true, false],
		[SED_LABEL, IN_PLACE_SED_CALL, true, false],
		['a chained in-place sed', CHAINED_SED_CALL, true, false],
		['a redirection', REDIRECTION_CALL, true, false],
	])('answers %s with %s as guarded and %s as read-only', (_label, call, guarded, read_only) => {
		expect(time_batch_guard.is_guarded_call(call)).toBe(guarded)
		expect(time_batch_guard.is_read_only_call(call)).toBe(read_only)
	})
})

// The predicate that routes the whole-file write to a notice rather than a refusal
// (joshuafolkken/kit#1848). It admits that one tool and nothing else — the calls `is_guarded_call`
// already refuses stay its, so the two never overlap and no call is both refused and notified.
describe('time_batch_guard.is_notice_call — the whole-file write alone', () => {
	it.each([
		[WRITE_LABEL, WRITE_CALL, true],
		[EDIT_LABEL, EDIT_CALL, false],
		[FILE_READ_LABEL, FRESH_CALL, false],
		[SED_LABEL, IN_PLACE_SED_CALL, false],
	])('answers %s with %s', (_label, call, expected) => {
		expect(time_batch_guard.is_notice_call(call)).toBe(expected)
	})
})

describe('time_batch_guard.should_block — one refusal per sequence', () => {
	// A refused call extends the sequence rather than restarting it, and a sequence's start does not
	// move between two calls seconds apart — which is what makes the immediate re-refusal impossible
	// and caps a turn at one refused call. (A sequence outliving the caller's window is the bounded
	// exception the module states; it needs 23–34 unbroken round trips to reach.)
	it('allows a sequence that began before the last refusal', () => {
		const text = transcript(
			target_turn_lines(0, ['a.ts']),
			target_turn_lines(1, ['b.ts']),
			target_turn_lines(2, ['c.ts']),
			open_turn_lines(3, ['d.ts']),
		)
		const after_the_sequence_began = ms(3)

		expect(time_batch_guard.should_block(text, FRESH_CALL, after_the_sequence_began)).toBe(false)
	})

	// joshuafolkken/kit#1611. The dependency veto above is the one thing `targets` decides here, so
	// narrowing what a line names moves it — and this is the direction that move takes. A quoted
	// search pattern names nothing: `grep -rn "scripts/time" scripts/fresh.ts` looks for that text
	// *inside* `scripts/fresh.ts` and does not need whatever earlier call read `scripts/time`. While
	// `bash_facts` tokenized the quotes, the pair shared a word and the veto let this call through;
	// now it is refused, which is the answer the sequence had all along.
	it('refuses a call whose only shared word was a quoted search pattern', () => {
		const text = transcript(
			target_turn_lines(0, ['a.ts']),
			target_turn_lines(1, [QUOTED_PATTERN]),
			open_turn_lines(2, ['c.ts']),
		)
		const command = `grep -rn "${QUOTED_PATTERN}" ${FRESH_PATH}`

		expect(
			time_batch_guard.should_block(text, { name: 'Bash', input: { command } }, NEVER_REFUSED),
		).toBe(true)
	})

	// Once a batched turn has broken the run, what follows is a new sequence and the guard speaks again.
	it('refuses again once a new sequence has started', () => {
		const text = transcript(
			target_turn_lines(0, ['a.ts']),
			target_turn_lines(1, ['b.ts', 'e.ts']),
			target_turn_lines(2, ['f.ts']),
			target_turn_lines(3, ['g.ts']),
			open_turn_lines(4, ['h.ts']),
		)
		const before_the_new_sequence = ms(3)

		expect(time_batch_guard.should_block(text, FRESH_CALL, before_the_new_sequence)).toBe(true)
	})
})

// The notice's rule mirrors should_block's, gated on the whole-file write instead of on a refusable
// call and reading its own last-fired instant (joshuafolkken/kit#1848). A `Write` cannot be refused
// safely, so this is the only thing the guard says about a run of single-call write turns.
describe('time_batch_guard.should_notify — the whole-file write', () => {
	it('notifies the write that would make a third consecutive single-call turn', () => {
		const text = transcript(
			target_turn_lines(0, ['a.ts'], WRITE_TOOL),
			target_turn_lines(1, ['b.ts'], WRITE_TOOL),
			open_turn_lines(2, ['c.ts'], WRITE_TOOL),
		)

		expect(time_batch_guard.should_notify(text, WRITE_CALL, NEVER_REFUSED)).toBe(true)
	})

	// Two is the ordinary pair, and the limit is three — the same threshold the refusal uses.
	it('says nothing where the write would make only a second', () => {
		const text = transcript(
			target_turn_lines(0, ['a.ts'], WRITE_TOOL),
			open_turn_lines(1, ['c.ts'], WRITE_TOOL),
		)

		expect(time_batch_guard.should_notify(text, WRITE_CALL, NEVER_REFUSED)).toBe(false)
	})

	// A write naming a file the run is already writing could not have gone out beside the earlier ones,
	// so the notice is withheld — the same target veto the refusal applies.
	it('says nothing about a write naming a file the run has already written', () => {
		const text = transcript(
			target_turn_lines(0, ['a.ts'], WRITE_TOOL),
			target_turn_lines(1, [FRESH_PATH], WRITE_TOOL),
			open_turn_lines(2, ['c.ts'], WRITE_TOOL),
		)

		expect(time_batch_guard.should_notify(text, WRITE_CALL, NEVER_REFUSED)).toBe(false)
	})
})

describe('time_batch_guard.should_notify — what it will not notify', () => {
	// A refusable call is never notified: it is refused instead, and letting both fire would speak twice
	// about one call.
	it.each([
		[FILE_READ_LABEL, FRESH_CALL],
		[EDIT_LABEL, EDIT_CALL],
	])('says nothing about %s, which the refusal owns', (_label, call) => {
		const text = transcript(
			target_turn_lines(0, ['a.ts']),
			target_turn_lines(1, ['b.ts']),
			open_turn_lines(2, ['c.ts']),
		)

		expect(time_batch_guard.should_notify(text, call, NEVER_REFUSED)).toBe(false)
	})

	// One notice per sequence: a run of single-call turns that began before the last notice is not
	// notified again, exactly as a refusal is not repeated.
	it('says nothing where the sequence began before the last notice', () => {
		const text = transcript(
			target_turn_lines(0, ['a.ts'], WRITE_TOOL),
			target_turn_lines(1, ['b.ts'], WRITE_TOOL),
			target_turn_lines(2, ['c.ts'], WRITE_TOOL),
			open_turn_lines(3, ['d.ts'], WRITE_TOOL),
		)
		const after_the_sequence_began = ms(3)

		expect(time_batch_guard.should_notify(text, WRITE_CALL, after_the_sequence_began)).toBe(false)
	})
})
