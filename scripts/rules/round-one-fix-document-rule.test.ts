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

	// joshuafolkken/kit#4834: a round-1 fix that moves the tree restarts test:pinned at the record.
	it('step 0 reads the restarted test:pinned before the ship', () => {
		expect(lane_step()).toContain(
			'on `test:pinned restarted`, read `pnpm josh run:review --pinned` and pin each unpinned place or take `--unpinned-ok` before the ship',
		)
	})

	// Step 0 alone is exempt: a lane child whose ship failed falls to step 1 and may reach `git -y`.
	it('scopes the round-1 fix gate before git -y to runs outside step 0', () => {
		const content = read_unwrapped(CHAIN_RULE)

		expect(content).toContain(
			'Outside step 0, a round-1 fix runs its scoped check and the gate before `git -y`.',
		)
		expect(content).not.toContain('Any round-1 fix runs its affected scoped check and the gate')
	})
})
