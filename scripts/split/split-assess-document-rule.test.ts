import { read_repo_file } from '#scripts/document/ai-document-fixture'
import { decision_oracle } from '#scripts/rules/decision-oracle'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#2218: the acceptance criterion "split-assessment.md carries a route to this
// command" is pinned so the pointer cannot be dropped, and the oracle entry stays registered.

const SPLIT_ASSESSMENT = '.claude/skills/workflow-commands/split-assessment.md'
const COMMAND = 'split:assess'

describe('split-assessment.md points to the split:assess command', () => {
	it('names the command', () => {
		expect(read_repo_file(SPLIT_ASSESSMENT)).toContain(COMMAND)
	})

	it('says separability stays a judgement, not decided by size', () => {
		expect(read_repo_file(SPLIT_ASSESSMENT)).toContain('separability')
	})
})

describe('split:assess is a registered decision oracle', () => {
	it('is on the oracle list with the split | single vocabulary', () => {
		const oracle = decision_oracle.find_oracle(COMMAND)

		expect(oracle?.vocabulary).toEqual(['split', 'single'])
	})
})
