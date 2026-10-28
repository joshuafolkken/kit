import { describe, expect, it } from 'vitest'
import { implementation_cut } from './implementation-cut'
import { permission_guards } from './permission-guards'
import { rule_value, type RuleReading } from './rule-value'
import { rule_value_fixture } from './rule-value-fixture'

const { reading_for, result_line, session } = rule_value_fixture

const FILING = 'pnpm josh issue:file "x" --body-file b.md'
const IMPLEMENTATION_CUT = 'implementation-cut'

// The rows that cannot declare a compliance call, in enumeration order — asserted below.
const UNMEASURABLE_ROWS: ReadonlyArray<string> = [
	'third-party-write',
	// Not publishing a credential is the absence of a call, and the body file a past call named may
	// be gone by the time its transcript is scored.
	'credential-body',
	'raw-field-body',
	'round-one-check-related',
	'test-declared',
	'lane-background',
	'lane-split-park',
	'lane-interactive-ask',
	'lane-carry-conflict',
	'lane-switch-main',
	'lane-direct-tool',
	'josh-git-bare',
	'git-force',
	'worktree-mutation',
	'file-body',
	// The permission guards declare no compliance call either, and enumerate in their own order.
	...permission_guards.ROWS.map((row) => row.id),
	'poll-loop',
	// A budget guard: it fires on a context threshold the child cannot observe, so taking the cut
	// before the crossing is no act a run could make unaided (joshuafolkken/kit#5267).
	IMPLEMENTATION_CUT,
	'investigation',
]

describe('rule_value.measure — rules nothing can score', () => {
	it('reports a rule that declares no compliance test as unmeasured, never as zero', () => {
		// Scoring it 0 would read as "never kept", which is a claim the missing predicate cannot make.
		// Every enumerated row declares one since joshuafolkken/kit#1643, so the guarantee is asserted
		// against the reading rather than against whichever row happened to lack a predicate.
		const unmeasured: RuleReading = {
			id: 'unmeasured',
			sessions: 3,
			unaided_kept: 0,
			refusals: 0,
			rewrites: 0,
			is_measurable: false,
		}

		expect(rule_value.unaided_rate(unmeasured)).toBeUndefined()
	})

	// **Every rule but the ones that cannot have a compliance test** (joshuafolkken/kit#1764,
	// joshuafolkken/kit#2118, joshuafolkken/kit#2119, joshuafolkken/kit#2120, joshuafolkken/kit#2201).
	// The investigation row declares none because no call-shaped test can tell a delegation of the
	// reading from any other dispatch; the test-declared row declares none because its verdict is a
	// working-tree read the transcript never records, so no recorded call reveals whether the commit
	// carried a test; the three Bash-string gaps (`git-force`, `worktree-mutation`, `file-body`) declare none because the
	// act each guards against is destructive or billed and the safe alternative is the *absence* of a
	// call — a push never made, a stash never raw, an Edit that is not a Bash call at all;
	// `third-party-write` declares none for the same reason (joshuafolkken/kit#2122) — not writing to
	// another owner's tracker is the absence of a call, not a call; and `lane-interactive-ask` declares
	// none for the same reason (joshuafolkken/kit#2201) — not asking a person is the absence of a call,
	// and the compliance a routed child does make is the park `lane-park` already scores; `lane-split-park`
	// declares none for the same reason (joshuafolkken/kit#3296) — not parking a promoted epic is the
	// absence of a call. **`rule-body`
	// left this list in joshuafolkken/kit#2324**: the placement-verdict stand-down made keeping the rule
	// a *recorded* act — running `pnpm josh oracle:list` and `pnpm josh run:step` — so a call now reveals
	// the compliance the #2272 doctrine said none could, and the row declares a `keeps`. The module's
	// doctrine is that a rule with no recorded compliance call reads unmeasured rather than as compliant.
	// Naming them exactly keeps the guard over every other row, the batching one and the oracle-consulted
	// rows included, rather than exempting a whole registry to make room for the exceptions.
	it('declares a compliance test on every rule but the ones that cannot have one', () => {
		const unmeasured = rule_value
			.measure([[session(FILING)]])
			.filter((reading) => !reading.is_measurable)
			.map((reading) => reading.id)

		expect(unmeasured).toStrictEqual(UNMEASURABLE_ROWS)
	})

	// joshuafolkken/kit#5267: a budget guard read `0% unaided` on every run that reached it.
	it('gives the implementation-phase cut no unaided rate on a run it refused', () => {
		const refused = `${session('ls')}\n${result_line(implementation_cut.IMPLEMENTATION_CUT_REASON)}`
		const reading = reading_for(IMPLEMENTATION_CUT, [[refused]])

		expect(reading.refusals).toBe(1)
		expect(rule_value.unaided_rate(reading)).toBeUndefined()
	})
})
