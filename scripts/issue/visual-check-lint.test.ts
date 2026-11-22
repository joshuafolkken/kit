import { describe, expect, it } from 'vitest'
import { visual_check_lint } from './visual-check-lint'

const VISUAL_ONLY = '- 人の判断: 要（マージ前の目視確認 — 実ボードでの見た目）'
const VISUAL_CRITERION = '- [ ] マージ前に人が実ボードの見た目を確認している'
const POST_MERGE_KEY = '- マージ後の確認:'
const REASON = '- マージ前の目視の理由: 公開すると取り消せない'
const NOT_NEEDED = '- 人の判断: 不要'

function body_with(
	background: ReadonlyArray<string>,
	criteria: ReadonlyArray<string> = [],
): string {
	return [
		'## 背景',
		'',
		'- 種別: 非不具合',
		...background,
		'',
		'## 受け入れ条件',
		'',
		...criteria,
	].join('\n')
}

describe('visual_check_lint.problems — refused', () => {
	it('refuses a judgement needed for a visual check alone, pointing at the post-merge check', () => {
		const found = visual_check_lint.problems(body_with([VISUAL_ONLY]))

		expect(found).toHaveLength(1)
		expect(found[0]).toContain(POST_MERGE_KEY)
		expect(found[0]).toContain(NOT_NEEDED)
	})

	it('refuses the #8505 criterion asking a person to look before merge', () => {
		const found = visual_check_lint.problems(body_with([NOT_NEEDED], [VISUAL_CRITERION]))

		expect(found).toHaveLength(1)
		expect(found[0]).toContain(VISUAL_CRITERION)
		expect(found[0]).toContain(POST_MERGE_KEY)
	})

	it('refuses both the declaration and the criterion in one body', () => {
		expect(visual_check_lint.problems(body_with([VISUAL_ONLY], [VISUAL_CRITERION]))).toHaveLength(2)
	})
})

describe('visual_check_lint.problems — passed', () => {
	it.each([
		['a policy decision', ['- 人の判断: 要（方針の判断）']],
		['an external account', ['- 人の判断: 要（外部アカウント）']],
		[
			'a visual check beside a policy decision',
			['- 人の判断: 要（方針の判断 / マージ前の目視確認）'],
		],
		['a post-merge check', [NOT_NEEDED, `${POST_MERGE_KEY} 実ボードの見た目`]],
		['a declared pre-merge reason', [VISUAL_ONLY, REASON]],
	])('passes %s', (_name, background) => {
		expect(visual_check_lint.problems(body_with(background))).toStrictEqual([])
	})

	it('passes a criterion asking a person to look when the pre-merge reason is declared', () => {
		expect(visual_check_lint.problems(body_with([REASON], [VISUAL_CRITERION]))).toStrictEqual([])
	})

	it('refuses an unfilled placeholder reason', () => {
		const placeholder = '- マージ前の目視の理由: <理由>'

		expect(visual_check_lint.problems(body_with([VISUAL_ONLY, placeholder]))).toHaveLength(1)
	})

	it('does not count a fenced example', () => {
		const fenced = ['```', VISUAL_CRITERION, '```']

		expect(
			visual_check_lint.problems(body_with([NOT_NEEDED, '```', VISUAL_ONLY, '```'], fenced)),
		).toStrictEqual([])
	})

	it('passes a criterion the AI checks by reading the frame', () => {
		const criterion = '- [ ] `run:board --frame` の出力に見出しが出る'

		expect(visual_check_lint.problems(body_with([NOT_NEEDED], [criterion]))).toStrictEqual([])
	})
})
