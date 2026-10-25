import { describe, expect, it } from 'vitest'
import { plan_consumers_section } from './plan-consumers-section'

// joshuafolkken/kit#4273: a plan names the existing consumers of what it adds or changes, or says
// "none" with its reason; `issue:plan` refuses one that does neither.

const { HEADING, refusal_of } = plan_consumers_section

function plan_with(section: string): string {
	return [
		'## 計画',
		'',
		'### 方針',
		'',
		'- step',
		'',
		HEADING,
		'',
		section,
		'',
		'### テスト',
		'',
		'- t',
	].join('\n')
}

describe('plan_consumers_section.refusal_of — passes a filled section', () => {
	it.each([
		{ name: 'a consumer list', section: '- `run:board`: `scripts/run/run-board.ts` — fix' },
		{ name: 'なし with a full-width reason', section: '- なし（新しい概念を足さない）' },
		{ name: 'なし with a half-width reason', section: 'なし (docs only)' },
		{
			name: 'なし with its reason wrapped onto a second line',
			section: '- なし（新しい概念を\n  足さない）',
		},
		{
			name: 'a なし nested under a consumer entry',
			section: '- `run:board`: `a.ts` — fix\n  - なし',
		},
		{
			name: 'a fenced `#` line inside the section',
			section: '- `run:board`: `a.ts` — fix\n\n```sh\n# comment\n```\n\n- `run:prep`: `b.ts` — fix',
		},
	])('passes $name', ({ section }) => {
		expect(refusal_of(plan_with(section))).toBeUndefined()
	})
})

describe('plan_consumers_section.refusal_of — refuses a missing or unanswered section', () => {
	it('refuses a plan without the section, naming the heading and plan:consumers', () => {
		const refusal = refusal_of('## 計画\n\n### 方針\n\n- step\n')

		expect(refusal).toContain(HEADING)
		expect(refusal).toContain('plan:consumers')
	})

	it('refuses the heading quoted inside a code fence', () => {
		expect(refusal_of(['```', HEADING, '- a', '```'].join('\n'))).toContain('no `')
	})

	it('refuses a section whose next heading follows at once', () => {
		expect(refusal_of(plan_with(''))).toContain('is empty')
	})

	it.each([
		{ name: 'a bare なし', section: '- なし' },
		{ name: 'a bare なし after a fenced `#` line', section: '```\n# c\n```\n- なし' },
		{ name: 'なし with empty parentheses', section: 'なし（）' },
		{ name: 'なし with an unparenthesized word', section: 'なし 理由' },
	])('refuses $name', ({ section }) => {
		expect(refusal_of(plan_with(section))).toContain('without a reason')
	})
})

// joshuafolkken/kit#4923: the section's entries are readers, so dispatch reads a plan without it.
describe('plan_consumers_section.without', () => {
	it('drops the section up to the next heading, keeping the rest', () => {
		expect(plan_consumers_section.without(plan_with('- `a.ts` reads it'))).toBe(
			['## 計画', '', '### 方針', '', '- step', '', '### テスト', '', '- t'].join('\n'),
		)
	})

	it('keeps a fenced heading inside the section from ending it', () => {
		const plan = ['## 計画', HEADING, '```', '# c', '```', '- `a.ts`', '### テスト'].join('\n')

		expect(plan_consumers_section.without(plan)).toBe(['## 計画', '### テスト'].join('\n'))
	})

	it('returns a plan without the section unchanged', () => {
		const plan = '## 計画\n- `a.ts`'

		expect(plan_consumers_section.without(plan)).toBe(plan)
	})
})
