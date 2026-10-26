import { read_repo_file } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'
import { expected_effect_lint } from './expected-effect-lint'

// joshuafolkken/kit#3902 as filed: a run-time-shortening proposal with no expected-effect estimate.
const ISSUE_3902_BACKGROUND = [
	'## 背景',
	'',
	'- 種別: 非不具合',
	'- 目的: 機能改善',
	'- 人の判断: 不要',
	'',
	'判断基準（`review` の中央値が `ci-wait` の中央値以上）を満たしているので、実装に進める。',
	'',
]
const ISSUE_3902_REST = [
	'## 現象',
	'',
	'- 子 1 件ごとに、round-1 レビューが終わるまで CI が始まらない。',
	'',
	'## 期待結果',
	'',
	'round-1 レビューの間に CI が走る。',
	'',
	'## 受け入れ条件',
	'',
	'- [ ] `josh ship --review` が round-1 レビューの開始と同時に PR を push する',
	'',
]
const DECLARED_3902 = [
	...ISSUE_3902_BACKGROUND.slice(0, 5),
	expected_effect_lint.DECLARATION_LINE,
	...ISSUE_3902_BACKGROUND.slice(5),
	...ISSUE_3902_REST,
].join('\n')
const EXPECTED_EFFECT = [
	'## 期待効果',
	'',
	'- 効く率: 19%（round-1 が修正を出さない子）',
	'- 1 回あたりの得: 2.0 分（`ci-wait` の中央値）',
	'- 外れたときの損: CI 1 回の二重実行',
	'- 出典: `pnpm josh lane:stats` → review 中央値 6.0 分 / ci-wait 中央値 2.0 分',
	'',
].join('\n')
const MISSING_HEADING = 'missing heading: ## 期待効果'

function missing_item(label: string): string {
	return `missing expected-effect item: - ${label}: <value>`
}

describe('expected-effect lint — joshuafolkken/kit#3902 regression', () => {
	it('accepts the body as filed, which declares no run-time-shortening aim', () => {
		const body = [...ISSUE_3902_BACKGROUND, ...ISSUE_3902_REST].join('\n')

		expect(expected_effect_lint.problems(body)).toEqual([])
	})

	it('rejects the body once it declares the aim without an expected-effect section', () => {
		expect(expected_effect_lint.problems(DECLARED_3902)).toEqual([MISSING_HEADING])
	})

	it('accepts the declared body once the expected-effect section is added', () => {
		expect(expected_effect_lint.problems(`${DECLARED_3902}${EXPECTED_EFFECT}`)).toEqual([])
	})
})

describe('expected-effect lint — the four items', () => {
	it.each(expected_effect_lint.ITEM_LABELS)('rejects a section without the %s line', (label) => {
		const section = EXPECTED_EFFECT.split('\n')
			.filter((line) => !line.startsWith(`- ${label}:`))
			.join('\n')

		expect(expected_effect_lint.problems(`${DECLARED_3902}${section}`)).toEqual([
			missing_item(label),
		])
	})

	it('rejects empty and placeholder values', () => {
		const section = '## 期待効果\n\n- 効く率:\n- 1 回あたりの得: <効いたときに浮く時間>\n'

		expect(expected_effect_lint.problems(`${DECLARED_3902}${section}`)).toEqual(
			expected_effect_lint.ITEM_LABELS.map((label) => missing_item(label)),
		)
	})

	it('accepts an upper-bound value that opens with <', () => {
		const section = EXPECTED_EFFECT.replace('CI 1 回の二重実行', '<1 分')

		expect(expected_effect_lint.problems(`${DECLARED_3902}${section}`)).toEqual([])
	})

	it('does not count items written inside a code fence', () => {
		const fenced = EXPECTED_EFFECT.replace('## 期待効果\n', '## 期待効果\n```\n').concat('```\n')

		expect(expected_effect_lint.problems(`${DECLARED_3902}${fenced}`)).toHaveLength(
			expected_effect_lint.ITEM_LABELS.length,
		)
	})
})

// joshuafolkken/kit#4958: `effect:audit` reads the stated values back.
describe('expected-effect lint — value_of', () => {
	it('answers the stated value, and nothing for an absent or placeholder item', () => {
		const body = `${DECLARED_3902}## 期待効果\n\n- 効く率: 9 割\n- 1 回あたりの得: <浮く時間>\n`

		expect(expected_effect_lint.value_of(body, '効く率')).toBe('9 割')
		expect(expected_effect_lint.value_of(body, '1 回あたりの得')).toBeUndefined()
		expect(expected_effect_lint.value_of(body, '外れたときの損')).toBeUndefined()
	})
})

describe('expected-effect lint — the declaration', () => {
	it('ignores the declaration outside the background section', () => {
		const body = [...ISSUE_3902_BACKGROUND, ...ISSUE_3902_REST].join('\n')

		expect(
			expected_effect_lint.problems(`${body}${expected_effect_lint.DECLARATION_LINE}\n`),
		).toEqual([])
	})

	it('ignores the declaration inside a code fence', () => {
		const body = [
			...ISSUE_3902_BACKGROUND.slice(0, 5),
			'```',
			expected_effect_lint.DECLARATION_LINE,
			'```',
			...ISSUE_3902_BACKGROUND.slice(5),
			...ISSUE_3902_REST,
		].join('\n')

		expect(expected_effect_lint.problems(body)).toEqual([])
	})
})

describe('issue-template.md carries the expected-effect declaration and items', () => {
	it('names the declaration, the heading and every item label the lint reads', () => {
		const template = read_repo_file('prompts/collaboration-workflow/issue-template.md')

		expect(template).toContain(expected_effect_lint.DECLARATION_LINE)
		expect(template).toContain(expected_effect_lint.HEADING)

		for (const label of expected_effect_lint.ITEM_LABELS) expect(template).toContain(`- ${label}:`)
	})
})
