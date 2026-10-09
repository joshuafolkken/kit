import { read_repo_file } from '#scripts/document/ai-document-fixture'
import { decision_oracle } from '#scripts/rules/decision-oracle'
import { describe, expect, it } from 'vitest'
import { rule_list } from './rule-list'

// joshuafolkken/kit#2117: question 0 of the rule-placement criterion lives in residency.md as the
// single source, and both CLAUDE.md and SKILL.md §3 carry a pointer rather than repeating it.
// Two things can rot independently: residency.md can drop the question, and CLAUDE.md can lose the
// pointer. joshuafolkken/kit#2891 merged rule-residency.md into residency.md, so the third guard —
// that file going back to saying only two questions exist — has no file left to watch.

const RESIDENCY = 'prompts/collaboration-workflow/residency.md'
const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const CLAUDE = 'CLAUDE.md'
const RULE_DELIVERY = 'prompts/collaboration-workflow/rule-delivery.md'

// The unique marker for question 0 in residency.md. The phrase appears only in the question 0
// criterion — the previous criterion used a "question 1 / question 2" numbering.
const QUESTION_0_JP_MARKER = '機械的に読める入力だけから計算できるか'
// The oracle listing command that documents must name as the pointer.
const ORACLE_COMMAND = 'oracle:list'

describe('residency.md carries question 0 as the single source', () => {
	it('states question 0 in Japanese', () => {
		expect(read_repo_file(RESIDENCY)).toContain(QUESTION_0_JP_MARKER)
	})

	it('names oracle:list as the enumeration command', () => {
		expect(read_repo_file(RESIDENCY)).toContain(ORACLE_COMMAND)
	})

	it('names the decision oracle count to show it is not empty', () => {
		expect(decision_oracle.DECISION_ORACLES.length).toBeGreaterThanOrEqual(20)
	})
})

// joshuafolkken/kit#3256 moved question 0 out of residency: it matters only on the turn a rule is
// placed, where the rule-prose hook delivers it. CLAUDE.md keeps the pointer to the criterion.
// joshuafolkken/kit#3395: CLAUDE.md routes to the delivery enumeration, which lists residency.md.
describe('CLAUDE.md reaches the residency criterion through the delivery enumeration', () => {
	it('names rule-delivery.md, which lists residency.md', () => {
		expect(read_repo_file(CLAUDE)).toContain(RULE_DELIVERY)
		expect(read_repo_file(RULE_DELIVERY)).toContain('pnpm josh rule:list')
		expect(rule_list.render()).toContain('`residency.md`')
	})
})

describe('SKILL.md §3 points to residency.md for question 0', () => {
	it('mentions oracle:list', () => {
		expect(read_repo_file(SKILL)).toContain(ORACLE_COMMAND)
	})
})

describe('SKILL.md §3 names the single source', () => {
	it('routes to residency.md rather than a second copy', () => {
		expect(read_repo_file(SKILL)).toContain(
			'**The residency criterion is `prompts/collaboration-workflow/residency.md`, its single source',
		)
	})
})
