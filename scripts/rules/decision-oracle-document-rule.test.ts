import { read_repo_file } from '#scripts/document/ai-document-fixture'
import { decision_oracle } from '#scripts/rules/decision-oracle'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#2117: question 0 of the rule-placement criterion lives in residency.md as the
// single source, and both CLAUDE.md and SKILL.md §3 carry a pointer rather than repeating it.
// Three things can rot independently: residency.md can drop the question, CLAUDE.md can lose the
// pointer, and rule-residency.md can go back to saying only two questions exist.

const RESIDENCY = 'prompts/collaboration-workflow/residency.md'
const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const RULE_RESIDENCY = '.claude/skills/workflow-commands/rule-residency.md'
const CLAUDE = 'CLAUDE.md'

// The unique marker for question 0 in residency.md. The phrase appears only in the question 0
// criterion — the previous criterion used 第 1 問 / 第 2 問 numbering.
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

describe('CLAUDE.md carries the question 0 pointer', () => {
	it('names oracle:list so agents know where to look', () => {
		expect(read_repo_file(CLAUDE)).toContain(ORACLE_COMMAND)
	})
})

describe('SKILL.md §3 points to residency.md for question 0', () => {
	it('mentions oracle:list', () => {
		expect(read_repo_file(SKILL)).toContain(ORACLE_COMMAND)
	})
})

describe('rule-residency.md is updated to reflect three questions', () => {
	it('no longer says only "two questions"', () => {
		const content = read_repo_file(RULE_RESIDENCY)

		// The old wording "keeps the two questions" should no longer appear unchanged;
		// after #2117 it should reference question 0 in addition.
		expect(content).not.toContain('§3 keeps the two questions that decide')
	})

	it('names oracle:list or question 0', () => {
		const content = read_repo_file(RULE_RESIDENCY)

		expect(content.includes(ORACLE_COMMAND) || content.includes(QUESTION_0_JP_MARKER)).toBe(true)
	})
})
