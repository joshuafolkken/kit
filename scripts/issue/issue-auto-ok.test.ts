import { describe, expect, it } from 'vitest'
import { issue_auto_ok, type AutoOkFiling } from './issue-auto-ok'

// joshuafolkken/kit#3853: `issue:file` judges `auto-ok` against the criteria `run-backlog.md` records —
// the labels that keep a person in the loop and the body's declaration of whether a person's
// judgement is needed — for every filing, including one a person asked for.

const NOT_NEEDED_BODY = '## 背景\n\n- 種別: 非不具合\n- 人の判断: 不要\n'
const NEEDED_BODY = '## 背景\n\n- 種別: 非不具合\n- 人の判断: 要（外部アカウント）\n'
const UNDECLARED_BODY = '## 背景\n\n- 種別: 非不具合\n'
const BOTH_BODY = '## 背景\n\n- 人の判断: 不要\n- 人の判断: 要\n'
const FENCED_BODY = '## 背景\n\n```md\n- 人の判断: 不要\n```\n'
const OUTSIDE_BACKGROUND_BODY = '## 背景\n\n- 種別: 非不具合\n\n## 期待結果\n\n- 人の判断: 不要\n'

function filing_of(overrides: Partial<AutoOkFiling>): AutoOkFiling {
	return {
		is_opted_out: false,
		is_cross_repository: false,
		labels: ['depth:0', 'enhancement'],
		body: NOT_NEEDED_BODY,
		...overrides,
	}
}

describe('issue_auto_ok.decide — applied', () => {
	it('applies auto-ok when no exclusion holds and the body declares no judgement is needed', () => {
		const decision = issue_auto_ok.decide(filing_of({}))

		expect(decision.is_applied).toBe(true)
		expect(issue_auto_ok.line_of(decision)).toBe(
			'auto-ok: applied — no exclusion holds and the body declares no judgement is needed',
		)
	})
})

describe('issue_auto_ok.decide — withheld by the filing', () => {
	it('does not apply auto-ok when the body declares a judgement is needed', () => {
		const decision = issue_auto_ok.decide(filing_of({ body: NEEDED_BODY }))

		expect(decision.is_applied).toBe(false)
		expect(issue_auto_ok.line_of(decision)).toBe(
			'auto-ok: not applied — the body declares `- 人の判断: 要`',
		)
	})

	it('does not apply auto-ok when --no-auto-ok is declared', () => {
		const decision = issue_auto_ok.decide(filing_of({ is_opted_out: true }))

		expect(issue_auto_ok.line_of(decision)).toBe('auto-ok: not applied — --no-auto-ok declared')
	})

	it('does not apply auto-ok to a filing into another repository', () => {
		const decision = issue_auto_ok.decide(filing_of({ is_cross_repository: true }))

		expect(issue_auto_ok.line_of(decision)).toBe(
			'auto-ok: not applied — the Issue is filed to another repository',
		)
	})
})

describe('issue_auto_ok.decide — an excluded label', () => {
	it.each([
		'release',
		'breaking-change',
		'deferred',
		'needs-human-review',
		'epic',
		'Needs-Human-Review',
	])('does not apply auto-ok to a filing labelled %s, and names the label', (label) => {
		const decision = issue_auto_ok.decide(filing_of({ labels: ['depth:0', label] }))

		expect(decision.is_applied).toBe(false)
		expect(decision.reason).toContain(`a \`${label.toLowerCase()}\` Issue`)
	})
})

describe('issue_auto_ok.exclusion_of', () => {
	it('answers undefined when no label keeps a person in the loop', () => {
		expect(issue_auto_ok.exclusion_of(['enhancement', 'run:lane'])).toBeUndefined()
	})

	it('answers the first exclusion in its order', () => {
		const decision = issue_auto_ok.exclusion_of(['epic', 'release'])

		expect(decision?.reason).toBe('a `release` Issue — a release is Tier C')
	})
})

describe('issue_auto_ok.declaration_problem', () => {
	it.each([NOT_NEEDED_BODY, NEEDED_BODY])('accepts a body declaring exactly one answer', (body) => {
		expect(issue_auto_ok.declaration_problem(body)).toBeUndefined()
	})

	it.each([UNDECLARED_BODY, BOTH_BODY, FENCED_BODY, OUTSIDE_BACKGROUND_BODY])(
		'refuses a body without exactly one declaration under the background, naming how to write it',
		(body) => {
			const problem = issue_auto_ok.declaration_problem(body)

			expect(problem).toContain('`- 人の判断: 不要`')
			expect(problem).toContain('`- 人の判断: 要（<which one>）`')
		},
	)
})
