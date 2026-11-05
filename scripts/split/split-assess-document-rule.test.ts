import { read_repo_file } from '#scripts/document/ai-document-fixture'
import { decision_oracle } from '#scripts/rules/decision-oracle'
import { describe, expect, it } from 'vitest'
import { split_assess } from './split-assess'

// joshuafolkken/kit#2218: the acceptance criterion "split-assessment.md carries a route to this
// command" is pinned so the pointer cannot be dropped, and the oracle entry stays registered.

const SPLIT_ASSESSMENT = '.claude/skills/workflow-commands/split-assessment.md'
const ISSUE_TEMPLATE = 'prompts/collaboration-workflow/issue-template.md'
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
	it('requires stopping, splitting the rest and shipping the green part (ac-816d7c3f)', () => {
		const document = read_repo_file(SPLIT_ASSESSMENT)

		expect(document).toContain(`## ${split_assess.NOTICE_SECTION}`)
		expect(document).toContain('Stop implementation before')
		expect(document).toContain('Keep only the green part')
		expect(document).toContain('pnpm josh issue:file --route split --found-during <N>')
		expect(document).toContain('gate and ship the green part')
		expect(document).toContain('`split-unresolved` even with a')
		expect(document).not.toContain('Keep it one Issue')
	})
})

// joshuafolkken/kit#4675: a filing over the guide is refused with a pointer at the question's heading.
describe('split-assessment.md carries the heading a filing refusal names', () => {
	it('has the question section', () => {
		expect(read_repo_file(SPLIT_ASSESSMENT)).toContain(`## ${split_assess.QUESTION_SECTION}`)
	})
})

// joshuafolkken/kit#5533: the question states `lane:plan`'s growth bar as the factor the code holds.
describe('split-assessment.md states the lane:plan growth bar', () => {
	it('names the factor with lane:plan in the question section', () => {
		const document = read_repo_file(SPLIT_ASSESSMENT)

		expect(split_assess.DECLARED_GROWTH_FACTOR).toBe(2)
		expect(document).toContain('`lane:plan` answers `split` past\ntwice the declared files')
	})
})

describe('split:assess is a registered decision oracle', () => {
	it('is on the oracle list with the split | single vocabulary', () => {
		const oracle = decision_oracle.find_oracle(COMMAND)

		expect(oracle?.vocabulary).toEqual(['split', 'single'])
	})
})

describe('the issue template uses the shared split guide', () => {
	it('references the measured derivation, fallback and cap (ac-f05d82e6)', () => {
		const template = read_repo_file(ISSUE_TEMPLATE)

		expect(template).toContain('実測からの導出・未測定時の fallback・cap は')
		expect(template).toContain(`split-assessment.md\` → "${split_assess.QUESTION_SECTION}"`)
	})

	it('counts follow-up files and points either axis at the question', () => {
		const template = read_repo_file(ISSUE_TEMPLATE)

		expect(template).toContain('文書・スナップショット・コマンド一覧の追従も数える')
		expect(template).toContain('ファイル数または行数が分割の目安')
		expect(template).toContain(`split-assessment.md\` → "${split_assess.QUESTION_SECTION}"`)
	})
})

describe('the split question explains the measured guide', () => {
	it('derives both axes from the budget with an unmeasured fallback and cap (ac-a00be54f)', () => {
		const document = read_repo_file(SPLIT_ASSESSMENT)

		expect(document).toContain('same trailing 3-day period as the implement budget')
		expect(document).toContain('implement minutes per 100 actual changed lines')
		expect(document).toContain('implement budget ÷ measured minutes per 100 lines × 100')
		expect(document).toContain('line guide × (fallback file guide / fallback line guide)')
		expect(document).toContain('Without a measured rate, fall back to')
		expect(document).toContain('more than 8 changed files or more than 200 changed lines')
		expect(document).toContain('the cap, 1.5 times the guide')
	})
})
