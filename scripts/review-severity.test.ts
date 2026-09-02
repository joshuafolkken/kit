import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#1220: the output format demanded a severity on every finding and nothing said
// what earned one, so `medium` — the severity that blocks a PR — was whatever the reviewer felt.
// Under an instruction to find something, an undefined severity drifts upward: rounds three and four
// of joshuafolkken/kit#854 were spent on a misplaced comment, an unused export and a stale comment,
// all of which the Low rule already permitted skipping.
//
// The fix is the move `josh review:level` already made one level up — replace the discretion with a
// test. Both halves are asserted, because either one alone re-opens the drift: without the reach test
// a cosmetic finding blocks, and without the failure-scenario test "this could be confusing" does.
const REVIEW_PROMPT = 'prompts/review.md'
const CHAIN_RULE = '.claude/skills/workflow-commands/chain-rule.md'
const SECTION_TITLE = 'Severity (decided by a test, never by discretion)'

const DEFINITION_MARKERS: ReadonlyArray<string> = [
	`## ${SECTION_TITLE}`,
	'**A finding is `medium` or higher only when both of these hold:**',
	'a runtime code path, a distributed artifact a consumer reads, **or the verification that guards either**',
	// Without the third member a vacuous marker suite is capped at `low` and always skippable, because
	// `package.json` ships neither `**/*.test.ts` nor `**/*-fixture.ts`.
	'The third member is not decoration.',
	'**You can write the concrete failure scenario**',
	// Test 2 is self-reported, so the cheap action — not attempting a scenario — yields the
	// non-blocking severity. The attempt obligation is what keeps that from being a free exit.
	'**Test 2 asks whether a scenario can be written, not whether you wrote one.**',
	'attempt the scenario for every finding that passes test 1, and to say so when the attempt failed',
	// The half that decides borderline cases, and the one a reviewer under pressure drops first.
	'**Fail either test and the finding is `low`.**',
	'a finding whose failure scenario you cannot write is `low` however uncomfortable it looks',
]

// The definition has to sit beside the two rules it could contradict: the level rule that already
// reviews documentation at `medium`, and the three-way disposition whose branch conditions are the
// same reach test worded differently. Each is asserted, because a severity rule that quietly ranked
// documentation below runtime code would leave two live rules disagreeing.
const CONSISTENCY_MARKERS: ReadonlyArray<string> = [
	'**A distributed artifact is on that list deliberately.**',
	'would contradict the level rule one section up',
	'**It agrees with the three-way disposition below.**',
	'a distributed artifact, and the verification guarding either, both count as reaching one',
	// The two ways of becoming a `low` do not share a disposition: only a test-1 failure is branch 3's.
	// Collapsing them would let the cheaper severity double as the cheaper exit.
	'**A `low` is not automatically droppable, and the two ways of becoming one are why.**',
	'**A finding that passed test 1 and was rated `low` for want of a failure scenario still reaches the user**',
]

// The existing treatment of the other two severities, asserted still present: this change decides
// which findings reach `medium`, and changing what a `high` or a `low` then does was never part of
// it. The round-cap suite pins the High rules themselves; what is pinned here is the sentence saying
// this section left them alone.
const UNCHANGED_MARKERS: ReadonlyArray<string> = [
	'**`high` and `low` are unchanged.**',
	'blocks the merge regardless of round count',
	'may be skipped with a one-line reason',
]

describe(`${REVIEW_PROMPT} — severity is a test`, () => {
	const content = read_unwrapped(REVIEW_PROMPT)

	it.each(DEFINITION_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	it.each(CONSISTENCY_MARKERS)('reconciles the neighboring rule with %j', (marker) => {
		expect(content).toContain(marker)
	})

	it.each(UNCHANGED_MARKERS)('leaves the other severities alone with %j', (marker) => {
		expect(content).toContain(marker)
	})

	// The finding template is where a severity is actually written down, so the pointer belongs on
	// that line — a reviewer filling the template is not otherwise sent to the definition. The
	// attempt-evidence line is there for the same reason: an obligation stated only in the definition
	// has no slot in the shape the reviewer is actually filling in.
	it.each([
		'State **severity** (`high` / `medium` / `low`) — decided by the two tests in "Severity" above, not by discretion',
		'write the attempt: `no failure scenario — <what you tried>`',
	])('points the finding template at the test with %j', (marker) => {
		expect(content).toContain(marker)
	})

	// Branch 3 and the pre-commit Low rule both said "a Low may be skipped"; with two ways of
	// becoming a `low` that sentence now lets a user-facing finding be dropped in one line.
	it.each([
		'A Low finding that does not reach the user — that is, one that failed test 1 of "Severity" above, and **only** that one',
		'"Low findings that do not reach the user may be skipped with a one-line reason"',
		'a `low` that does not reach the user may be skipped with a one-line reason',
	])('scopes the droppable Low with %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// The skill's severity check is where high/medium findings are counted inside a run, and a run that
// reads only the skill would otherwise count them by feel — the same gap the round-two rollout found
// in this file and in the resident gate.
const CHAIN_RULE_MARKERS: ReadonlyArray<string> = [
	'using the two tests in `prompts/review.md` → "Severity"',
	// The reach list is inlined here, so it has to carry all three members: the skill is where a run
	// counts severities, and a two-member copy caps a vacuous marker suite at `low` on its own.
	'a runtime code path, a distributed artifact a consumer reads, or the verification that guards either',
	'and** you can write its concrete failure scenario; failing either, it is `low`',
	'**A `low` is not automatically droppable**',
]

describe(`${CHAIN_RULE} — the count uses the test`, () => {
	const content = read_unwrapped(CHAIN_RULE)

	it.each(CHAIN_RULE_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// The resident pre-commit rule carried the blanket "Low findings may be skipped", which an agent can
// reach on a turn that never opens `prompts/review.md`. Left as it was, the cheaper severity would
// double as the cheaper exit in exactly the context with no definition in front of it.
describe('CLAUDE.md — the resident Low rule is scoped too', () => {
	it('does not let a user-facing Low be skipped', () => {
		expect(read_unwrapped('CLAUDE.md')).toContain(
			'Low findings that do not reach the user may be skipped with a one-line reason',
		)
	})
})
