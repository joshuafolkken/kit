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
		'git log --oneline -3 | head',
		'gh issue list --state open | head -30',
		'ls -la | wc -l',
		// A verification command that keeps its own status: no pipe, the far side of a `||`, or the
		// last segment of the pipeline, whose status *is* the pipeline's.
		'pnpm josh gate 2>&1',
		'pnpm josh gate > /tmp/gate.log 2>&1',
		'pnpm josh gate || echo failed',
		'echo a.ts | xargs pnpm josh lint:related',
		// **The way out the refusal itself recommends.** Under `pipefail` the pipeline carries the
		// check's status, so refusing this would deny the sanctioned form — and, because the shared
		// shell stamps before it refuses, would spend the run's one delivery on a compliant call and
		// leave a genuinely masked one later in the run without a refusal.
		'set -o pipefail; pnpm josh gate | tail -40',
		'set -euo pipefail && pnpm josh test:unit | tail -5',
		// A command chain inside a quoted body is text: this repository's issue and comment bodies
		// quote them constantly, and the chain split walks into the middle of one.
		'gh issue comment 1556 --body "cd x && pnpm josh gate | tail で確認"',
		// The commands that print an answer rather than a verdict. Refusing these would make the rule
		// about josh rather than about verification.
		'pnpm josh eval:scope | tail -1',
		'pnpm josh review:brief | head -40',
		'pnpm josh latest:scope | tail -1',
		// A quoted command line is text, not a call — and this repository's issue bodies quote them
		// constantly.
		'git commit -m "ran pnpm josh gate | tail -40"',
	])('leaves %j alone', (command) => {
		expect(piped_verification.is_masked_verification(command)).toBe(false)
	})
})
