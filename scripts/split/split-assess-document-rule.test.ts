import { readdirSync } from 'node:fs'
import { package_file } from '#scripts/claude/skill-fixture'
import { read_repo_file } from '#scripts/document/ai-document-fixture'
import { decision_oracle } from '#scripts/rules/decision-oracle'
import { describe, expect, it } from 'vitest'
import { split_assess } from './split-assess'

// joshuafolkken/kit#2218: the acceptance criterion "split-assessment.md carries a route to this
// command" is pinned so the pointer cannot be dropped, and the oracle entry stays registered.

const WORKFLOW_COMMANDS = '.claude/skills/workflow-commands'
const SPLIT_ASSESSMENT = `${WORKFLOW_COMMANDS}/split-assessment.md`
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
	// joshuafolkken/kit#6602: size alone warns; only an independent requirement re-splits.
	it('treats the notice as a warning and keeps the independent-requirement split', () => {
		const document = read_repo_file(SPLIT_ASSESSMENT)

		expect(document).toContain(`## ${split_assess.NOTICE_SECTION}`)
		expect(document).toContain('The notice is a warning, not a stop')
		expect(document).toContain('Split again only for an independent added requirement')
		expect(document).toContain('pnpm josh issue:file --route split --found-during <N>')
		expect(document).toContain(
			'The quality gates, the clash and unread checks, and the review stay stops',
		)
		expect(document).not.toContain('split-unresolved')
		expect(document).not.toContain('Stop implementation before')
	})

	// joshuafolkken/kit#7011: size is judged before implementation only, stated in this one place.
	it('states once that a started implementation never splits or stops for size', () => {
		const document = read_repo_file(SPLIT_ASSESSMENT)

		expect(document).toContain('at filing (`issue:file`) and at `lane:plan`')
		expect(document).toContain('never splits, spills or stops for size')
	})

	it('leaves no mid-implementation split or spill guidance in the other workflow documents', () => {
		const guided = readdirSync(package_file(WORKFLOW_COMMANDS)).filter((name) =>
			/split notice|issue:spill/u.test(read_repo_file(`${WORKFLOW_COMMANDS}/${name}`)),
		)

		expect(guided).toEqual([])
	})

	it('lets one verified deliverable answer the notice without a child (ac-75da8719)', () => {
		const document = read_repo_file(SPLIT_ASSESSMENT)

		expect(document).toContain('One verified deliverable (every ship-draft acceptance row')
		expect(document).toContain('scripts/split/split-verified-single.ts')
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
		expect(document).toContain('median actual / declared ratios per axis, apart from speed')
		expect(document).toContain('unmeasured: 2')
		expect(document).toContain('`lane:plan` answers `split` past declared files × files ratio')
	})

	// joshuafolkken/kit#6647, joshuafolkken/kit#6602: `--single` waives every axis; a re-plan only warns.
	it('points one deliverable past any axis at --single and a re-plan at a warning', () => {
		const document = read_repo_file(SPLIT_ASSESSMENT)

		expect(document).toContain('`--single` or a re-plan → `size warning` (`lane-plan-size.ts`)')
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

		expect(template).toContain(
			'実測からの導出・未測定時の fallback・cap・基準（実装予算の 2 倍を宣言行数で）は',
		)
		expect(template).toContain(`split-assessment.md\` → "${split_assess.QUESTION_SECTION}"`)
	})

	it('counts follow-up files and points either axis at the question', () => {
		const template = read_repo_file(ISSUE_TEMPLATE)

		expect(template).toContain('文書・スナップショット・コマンド一覧の追従も数える')
		expect(template).toContain('目安・cap・基準を超えても 1 件にするなら')
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
		expect(document).toContain('Floor (also the unmeasured fallback)')
		expect(document).toContain('more than 8 changed files or more than 200 changed lines')
		expect(document).toContain('the cap (1.5 × guide)')
	})

	// joshuafolkken/kit#7074: the size bar is twice the implement budget.
	it('states the size bar as twice the budget', () => {
		expect(read_repo_file(SPLIT_ASSESSMENT)).toContain('the bar (2 × budget): split or say why')
	})
})
