import { read_repo_file } from '#scripts/document/ai-document-fixture'
import { decision_oracle } from '#scripts/rules/decision-oracle'
import { describe, expect, it } from 'vitest'
import { split_assess } from './split-assess'

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

// joshuafolkken/kit#4302: the steps a run takes on the pre-gate notice live in one section, and the
// notice points at exactly that heading.
describe('split-assessment.md carries the pre-gate notice steps', () => {
	it('has the section the notice names, with both actions', () => {
		const document = read_repo_file(SPLIT_ASSESSMENT)

		expect(document).toContain(`## ${split_assess.NOTICE_SECTION}`)
		expect(document).toContain('Keep it one Issue')
		expect(document).toContain('Carve the rest out')
	})
})

describe('split:assess is a registered decision oracle', () => {
	it('is on the oracle list with the split | single vocabulary', () => {
		const oracle = decision_oracle.find_oracle(COMMAND)

		expect(oracle?.vocabulary).toEqual(['split', 'single'])
	})
})
