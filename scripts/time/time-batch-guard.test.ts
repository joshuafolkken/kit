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
const FRESH_CALL = { name: 'Read', input: { file_path: FRESH_PATH } }
// The two calls both tables below name, and their labels, so neither the fixture nor the wording is
// written twice.
const EDIT_LABEL = 'an edit'
const SED_LABEL = 'an in-place sed'
const EDIT_CALL = { name: 'Edit', input: { file_path: FRESH_PATH } }
const IN_PLACE_SED_CALL = { name: 'Bash', input: { command: `sed -i '' s/a/b/ ${FRESH_PATH}` } }

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

	// Every write is outside the bundleable set, which is what keeps `pnpm josh`, `git` and the `gh`
	// write flags structurally unreachable from here.
	it('allows a call that is not bundleable in the first place', () => {
		const text = transcript(
			target_turn_lines(0, ['a.ts']),
			target_turn_lines(1, ['b.ts']),
			open_turn_lines(2, ['c.ts']),
		)
		const merge = { name: 'Bash', input: { command: 'pnpm josh followup --merge' } }

		expect(time_batch_guard.should_block(text, merge, NEVER_REFUSED)).toBe(false)
	})

	// **Refusing a write would leave a turn half applied**: Claude Code denies one call and runs the
	// turn's others, so the siblings of a refused edit land while it does not. `time-bundle-call.ts`
	// calls an edit bundleable — correctly, since the harness applies a turn's edits in order — which
	// is exactly why the guard has to ask a second question of its own.
	it.each([
		[EDIT_LABEL, EDIT_CALL],
		['a write', { name: 'Write', input: { file_path: FRESH_PATH } }],
		[SED_LABEL, IN_PLACE_SED_CALL],
	])('allows %s, which it must never refuse', (_label, call) => {
		const text = transcript(
			target_turn_lines(0, ['a.ts']),
			target_turn_lines(1, ['b.ts']),
			open_turn_lines(2, ['c.ts']),
		)

		expect(time_batch_guard.should_block(text, call, NEVER_REFUSED)).toBe(false)
	})

	it('allows where the transcript holds nothing to read', () => {
		expect(time_batch_guard.should_block('', FRESH_CALL, NEVER_REFUSED)).toBe(false)
	})
})

// The same two tests the caller asks before reading a quarter-megabyte of transcript, so a write and a
// `pnpm josh` invocation cost nothing but the hook's own start.
describe('time_batch_guard.is_guarded_call', () => {
	it.each([
		['a shell read', { name: 'Bash', input: { command: `cat ${FRESH_PATH}` } }, true],
		['a file read', FRESH_CALL, true],
		['a josh command', { name: 'Bash', input: { command: 'pnpm josh gate' } }, false],
		[EDIT_LABEL, EDIT_CALL, false],
		[SED_LABEL, IN_PLACE_SED_CALL, false],
	])('answers %s with %s', (_label, call, expected) => {
		expect(time_batch_guard.is_guarded_call(call)).toBe(expected)
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
