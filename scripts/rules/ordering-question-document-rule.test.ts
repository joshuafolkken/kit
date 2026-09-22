import { read_repo_file } from '#scripts/document/ai-document-fixture'
import { run_step } from '#scripts/run/run-step'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#2251: the ordering question of the rule-placement criterion lives in residency.md
// as the single source, applied right after question 0. A rule that decides *when or in what order* to
// act belongs in the run driver's state transitions (`run:step`), not prose — so CLAUDE.md and
// SKILL.md §3 carry a pointer rather than repeating it, rule-residency.md routes to it, and the
// manifests name the driver instead of re-narrating the sequence it computes. This is the same shape
// as decision-oracle-document-rule.test.ts built for question 0, and adds no second mechanism.

const RESIDENCY = 'prompts/collaboration-workflow/residency.md'
const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const RULE_RESIDENCY = '.claude/skills/workflow-commands/rule-residency.md'
const CLAUDE = 'CLAUDE.md'
const FULLRUN = '.claude/skills/workflow-commands/fullrun.md'
const BACKLOGRUN = '.claude/skills/workflow-commands/backlogrun.md'

// The unique marker for the ordering question in residency.md — the phrase appears only in the
// ordering-question criterion, never in question 0 or the two residency questions below it.
const ORDERING_JP_MARKER = 'いつ・どの順で'
// The English marker for the ordering-question pointer — appears once in SKILL.md §3, added by this
// change. Asserting it (not the pre-existing run:step) makes the SKILL.md guard fail if the §3 pointer
// is reverted, so the test pins this change's delta rather than a standing mention.
const ORDERING_EN_MARKER = 'ordering question'
// The driver command every document names as the pointer, exactly as question 0 names oracle:list.
const DRIVER_COMMAND = 'run:step'

describe('residency.md carries the ordering question as the single source', () => {
	it('states the ordering question in Japanese', () => {
		expect(read_repo_file(RESIDENCY)).toContain(ORDERING_JP_MARKER)
	})

	it('names run:step as the driver an ordering rule goes to', () => {
		expect(read_repo_file(RESIDENCY)).toContain(DRIVER_COMMAND)
	})
})

describe('CLAUDE.md carries the ordering-question pointer', () => {
	it('names run:step so agents know where an ordering rule goes', () => {
		expect(read_repo_file(CLAUDE)).toContain(DRIVER_COMMAND)
	})
})

describe('SKILL.md §3 points to residency.md for the ordering question', () => {
	// Marker unique to the §3 edit — run:step already appeared in SKILL.md's §2 manifest before this
	// change, so asserting the phrase is what makes reverting the §3 pointer fail the guard.
	it('names the ordering question and its driver', () => {
		const skill = read_repo_file(SKILL)

		expect(skill).toContain(ORDERING_EN_MARKER)
		expect(skill).toContain(DRIVER_COMMAND)
	})
})

describe('rule-residency.md routes to the ordering question', () => {
	it('names run:step alongside question 0', () => {
		expect(read_repo_file(RULE_RESIDENCY)).toContain(DRIVER_COMMAND)
	})
})

describe('the manifests route the run sequence to the driver, not prose', () => {
	// The driver is a live single source to route to: its verdict vocabulary is non-empty, so pointing
	// an ordering rule at it is not an empty promise.
	it('the driver names a non-empty verdict vocabulary', () => {
		expect(run_step.VOCABULARY.length).toBeGreaterThan(0)
	})

	// A manifest that re-narrated the ordered chain would be the second procedure-doc the ordering
	// question forbids; instead each names run:step and reads the sequence off it.
	it.each([FULLRUN, BACKLOGRUN])('%s points to run:step for the next action', (path) => {
		expect(read_repo_file(path)).toContain(DRIVER_COMMAND)
	})
})
