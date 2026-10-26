import { read_unwrapped } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#4830: a lane child that fixed a round-1 finding reopened `run:review` and ran
// round 1 again, because nothing said `review:record` stamps the fixed tree and ship reuses that
// round, and the "gate before `git -y`" line read as binding a lane — where only `run:review` runs it.

const CHAIN_RULE = '.claude/skills/workflow-commands/chain-rule.md'
const LANE_STEP = '0. **A lane child**'
const MAIN_LINE_STEP = '1. Run `pnpm josh main:merge`'

function lane_step(): string {
	const content = read_unwrapped(CHAIN_RULE)

	return content.slice(content.indexOf(LANE_STEP), content.indexOf(MAIN_LINE_STEP))
}

describe('chain-rule — a lane child records and ships after a round-1 fix', () => {
	it('step 0 says the record covers the fixed tree and run:review is not reopened', () => {
		const step = lane_step()

		expect(step).toContain('it stamps the fixed tree, so ship reuses this round 1')
		expect(step).toContain('never reopen `run:review`')
	})

	// joshuafolkken/kit#4835: a round-1 fix that reaches the run tooling makes the interaction review due.
	it('step 0 runs the interaction brief the record prints before the ship', () => {
		expect(lane_step()).toContain(
			'on `Interaction review now due`, record that pass before the ship, running it first if none ran beside round 1',
		)
	})

	// joshuafolkken/kit#4781: a lane child that ran round 1 with one reviewer left the interaction
	// review to run alone in ship, so step 0 names the second reviewer and its record.
	it('step 0 runs two reviewers on two briefs and records the second as the interaction pass', () => {
		expect(lane_step()).toContain(
			'on two briefs, two `reviewer`s side by side, the second recorded with `review:record --interaction --issue <N>`',
		)
	})

	// joshuafolkken/kit#4834: a round-1 fix that moves the tree restarts test:pinned at the record;
	// joshuafolkken/kit#4895: the ship's pre-detach reads it, so nothing waits on it in the foreground.
	it('step 0 leaves the restarted test:pinned to the ship', () => {
		expect(lane_step()).toContain(
			'on `test:pinned restarted`, go on to the ship without waiting — its pre-detach reads that check',
		)
		expect(lane_step()).not.toContain('run:review --pinned')
	})

	// Step 0 alone is exempt: a lane child whose ship failed falls to step 1 and may reach `git -y`.
	it('scopes the round-1 fix gate before git -y to runs outside step 0', () => {
		const content = read_unwrapped(CHAIN_RULE)

		expect(content).toContain(
			'Outside step 0, round-1 fixes run one scoped check and the gate before `git -y`.',
		)
		expect(content).not.toContain('Any round-1 fix runs its affected scoped check and the gate')
	})
})

describe('chain-rule — a review round’s fixes are checked once', () => {
	// joshuafolkken/kit#4949: a lane child ran check:related after each round-1 finding it fixed,
	// and the earlier run added nothing the later one did not answer.
	it('checks a round’s fixes with one check:related after the last, not one per finding', () => {
		expect(read_unwrapped(CHAIN_RULE)).toContain(
			"after every edit, a review round's fixes once after the last",
		)
	})
})

// joshuafolkken/kit#4983: ship's sync merges main and its scoped pair re-checks the tree, so a lane
// child's own main:merge and its last check:related before the ship were run twice.
describe('chain-rule — a lane child leaves the merge and the last check to ship', () => {
	it('step 0 runs no main:merge and names the conflict stop ship returns', () => {
		expect(lane_step()).toContain("(no `main:merge`: ship's sync merges main, stopping `conflict`)")
	})

	it('step 0 runs no check:related after the round’s fixes or before a re-detach', () => {
		const step = lane_step()

		// The interaction brief refuses a tree the scoped pair has not passed, as round 1's does.
		expect(step).toContain("round's fixes, no `check:related` after them unless a brief follows")
		expect(step).toContain('`check:related`, `check` or `metrics` before it or a re-detach')
		expect(step).not.toContain('all made before one `pnpm josh check:related`')
	})

	it('step 0 says when ship reuses the pre-review green', () => {
		expect(lane_step()).toContain(
			'ship reuses the scoped pair green on this tree and base (no fix, main unmoved)',
		)
	})

	it('a lane child resolves ship’s conflict stop without check:related', () => {
		const content = read_unwrapped(CHAIN_RULE)

		expect(content).toContain(
			"A lane child's resolution of ship's `conflict` stop: markers removed → the re-detach the stop prints",
		)
		expect(content).not.toContain('markers removed → `pnpm josh check:related`')
	})
})
