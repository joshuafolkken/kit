import { describe, expect, it } from 'vitest'
import { piped_verification } from './piped-verification'

// The trigger of the piped-verification rule, judged from the command alone (joshuafolkken/kit#1556).
//
// **The half that decides whether this hook is worth having is the second list.** Narrowing a listing
// with `| head` is the ordinary way to read one, and a guard that refused those would fire on the
// commonest shape in the transcript — which the enumeration treats as worse than no guard at all. The
// firing and the once-per-run bound are `delivered-rules.test.ts`'s, where the row lives.

// The shape the Issue was filed on: a gate whose failure the pipeline reports as a success.
const PIPED_GATE_COMMAND = 'pnpm josh gate 2>&1 | tail -40'
// The fixtures the compliance suite shares with the trigger suite: the three ways a check keeps its
// own status, the two read-only shapes the rule deliberately does not reach, and a command that runs
// no check at all.
const REDIRECTED_GATE = 'pnpm josh gate 2>&1'
const GATE_OR_ECHO = 'pnpm josh gate || echo failed'
const PIPEFAIL_GATE = 'set -o pipefail; pnpm josh gate | tail -40'
const PIPED_LISTING = 'git log --oneline -3 | head'
const PIPED_ANSWER = 'pnpm josh eval:scope | tail -1'
const NO_VERIFICATION = 'ls -la'

describe('is_masked_verification', () => {
	it.each([
		PIPED_GATE_COMMAND,
		'pnpm josh lint:related a.ts | head -20',
		'cd /tmp/lane && pnpm josh test:unit | tail -5',
		'josh cspell:dot | grep -i error',
		// The alias is the same command, and it is derived from the command map rather than restated.
		'pnpm josh ga | tail',
		'pnpm josh gate | tail -40 | grep failed',
	])('reads %j as a masked verification', (command) => {
		expect(piped_verification.is_masked_verification(command)).toBe(true)
	})

	it.each([
		// Read-only listings — the whole reason the trigger is scoped to pass/fail commands.
		PIPED_LISTING,
		'gh issue list --state open | head -30',
		'ls -la | wc -l',
		// A verification command that keeps its own status: no pipe, the far side of a `||`, or the
		// last segment of the pipeline, whose status *is* the pipeline's.
		REDIRECTED_GATE,
		'pnpm josh gate > /tmp/gate.log 2>&1',
		GATE_OR_ECHO,
		'echo a.ts | xargs pnpm josh lint:related',
		// **The way out the refusal itself recommends.** Under `pipefail` the pipeline carries the
		// check's status, so refusing this would deny the sanctioned form — and, because the shared
		// shell stamps before it refuses, would spend the run's one delivery on a compliant call and
		// leave a genuinely masked one later in the run without a refusal.
		PIPEFAIL_GATE,
		'set -euo pipefail && pnpm josh test:unit | tail -5',
		// A command chain inside a quoted body is text: this repository's issue and comment bodies
		// quote them constantly, and the chain split walks into the middle of one.
		'gh issue comment 1556 --body "cd x && pnpm josh gate | tail で確認"',
		// The commands that print an answer rather than a verdict. Refusing these would make the rule
		// about josh rather than about verification.
		PIPED_ANSWER,
		'pnpm josh review:brief | head -40',
		'pnpm josh latest:scope | tail -1',
		// A quoted command line is text, not a call — and this repository's issue bodies quote them
		// constantly.
		'git commit -m "ran pnpm josh gate | tail -40"',
	])('leaves %j alone', (command) => {
		expect(piped_verification.is_masked_verification(command)).toBe(false)
	})
})

// **The compliance side of the same rule** (joshuafolkken/kit#1643). `rule-value.ts` needs two more
// answers about a call: whether it ran a check at all, and whether that check's verdict survived. The
// trigger above fires only on the masked spelling, so without the first a run that never piped a check
// would drop out of the reading and the rate would be taken over runs that masked at least once.
describe('runs_verification and keeps_verdict_intact', () => {
	const INTACT: ReadonlyArray<string> = [REDIRECTED_GATE, GATE_OR_ECHO, PIPEFAIL_GATE]

	it.each([...INTACT, PIPED_GATE_COMMAND])(
		'reads %j as a run that reached the rule at all',
		(command) => {
			expect(piped_verification.runs_verification(command)).toBe(true)
		},
	)

	it.each([
		// Read-only listings and the answer commands are outside the rule, so they are outside its
		// denominator too — counting them would make the rate a statement about josh rather than
		// about verification.
		PIPED_LISTING,
		PIPED_ANSWER,
		NO_VERIFICATION,
	])('leaves %j out of the denominator', (command) => {
		expect(piped_verification.runs_verification(command)).toBe(false)
	})

	it.each(INTACT)('credits %j with a verdict that survived', (command) => {
		expect(piped_verification.keeps_verdict_intact(command)).toBe(true)
	})

	it.each([
		PIPED_GATE_COMMAND,
		// A line that masks one check while running another unmasked is not credited for the half it
		// got right.
		'pnpm josh gate | tail -40 && pnpm josh lint',
		NO_VERIFICATION,
	])('does not credit %j', (command) => {
		expect(piped_verification.keeps_verdict_intact(command)).toBe(false)
	})
})
