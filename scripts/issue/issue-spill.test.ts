import { describe, expect, it } from 'vitest'
import { expected_effect_lint } from './expected-effect-lint'
import { issue_spill } from './issue-spill'

const ESTIMATE = '- 規模見積もり: 約 2 ファイル / 40 行（テスト除く）'
const ACCEPTANCE = '## 受け入れ条件'
const LEFT_ONE = '- [ ] left one'
const LEFT_ONE_TAIL = '  wrapped tail of left one'
const LEFT_TWO = '- [ ] left two'
const FENCED = '- [ ] fenced example'
const MOVED = [LEFT_ONE, LEFT_ONE_TAIL, LEFT_TWO]
const PROSE = 'prose that is not a declaration'

const BODY = [
	'## 背景',
	'',
	'- 種別: 非不具合',
	'- 目的: 機能追加',
	'- 規模見積もり: 約 4 ファイル / 100 行（テスト除く）',
	'',
	PROSE,
	'',
	ACCEPTANCE,
	'',
	'- [x] done one',
	LEFT_ONE,
	LEFT_ONE_TAIL,
	'- [x] done two',
	LEFT_TWO,
	'',
	'```',
	FENCED,
	'```',
	'',
	'## 補足',
	'',
	'- [ ] not a criterion',
].join('\n')

const SUBJECT = { issue_number: 5999, title: 'Add a thing', body: BODY }

describe('issue_spill.unchecked_lines', () => {
	it('returns the unchecked criteria with their continuation, outside fences and other sections', () => {
		expect(issue_spill.unchecked_lines(BODY)).toStrictEqual(MOVED)
	})

	it('takes sub-items and deep continuations with their unchecked criterion', () => {
		const nested = [
			'- [ ] handles these cases:',
			'  - case a',
			'  - [x] case b',
			'  - [ ] case c',
			'  - case d after an unchecked sub-item',
			'- [ ] wrapped',
			'      deep continuation',
		]
		const body = [ACCEPTANCE, '', '- [x] done', ...nested, '- [x] last', '  done tail'].join('\n')

		expect(issue_spill.unchecked_lines(body)).toStrictEqual(nested)
	})

	it('returns nothing when every criterion is checked', () => {
		expect(issue_spill.unchecked_lines(`${ACCEPTANCE}\n\n- [x] done`)).toStrictEqual([])
	})

	it('returns nothing without an acceptance section', () => {
		expect(issue_spill.unchecked_lines('## 背景\n\n- [ ] not here')).toStrictEqual([])
	})
})

describe('issue_spill.checked_count', () => {
	it('counts the checked criteria of the acceptance section only', () => {
		const body = `${BODY}\n- [x] checked outside the section`

		expect(issue_spill.checked_count(body)).toBe(2)
	})

	it('counts no fenced line', () => {
		expect(issue_spill.checked_count(`${ACCEPTANCE}\n\n\`\`\`\n- [x] fenced\n\`\`\``)).toBe(0)
	})

	it('is zero without an acceptance section', () => {
		expect(issue_spill.checked_count('## 背景\n\n- [x] not here')).toBe(0)
	})
})

describe('issue_spill.kept_body', () => {
	it('replaces the unchecked criteria with one link line where the first stood', () => {
		const kept = issue_spill.kept_body(BODY, 6100)

		expect(kept).toContain('- [x] done one\n- → #6100 に移した\n- [x] done two\n\n```')
		expect(kept).not.toContain('left one')
		expect(kept).not.toContain('left two')
		expect(kept).toContain(FENCED)
		expect(kept).toContain('## 補足\n\n- [ ] not a criterion')
	})
})

describe('issue_spill.follow_up_body', () => {
	const body = issue_spill.follow_up_body(SUBJECT, ESTIMATE)

	it('carries the background declarations with the given estimate, not the original', () => {
		expect(body).toContain(
			'## 背景\n\n#5999 から切り出し。\n\n- 種別: 非不具合\n- 目的: 機能追加\n',
		)
		expect(body).toContain(ESTIMATE)
		expect(body).not.toContain('約 4 ファイル')
		expect(body).not.toContain(PROSE)
	})

	it('moves the unchecked criteria under the acceptance heading', () => {
		expect(body).toContain(`${ACCEPTANCE}\n\n${MOVED.join('\n')}\n`)
		expect(body).not.toContain(FENCED)
		expect(body).toContain('## 現象')
		expect(body).toContain('## 期待結果')
	})

	it('titles the follow-up after the original', () => {
		expect(issue_spill.follow_up_title(SUBJECT)).toBe('Follow up #5999: Add a thing')
	})
})

describe('issue_spill.follow_up_body expected effect', () => {
	const effect = [
		expected_effect_lint.HEADING,
		'',
		'- 効く率: 週 3 回',
		'- 1 回あたりの得: 2 分',
		'- 外れたときの損: 0 秒',
		'- 出典: lane:stats',
		'',
	]
	const timed = [
		'## 背景',
		'',
		expected_effect_lint.DECLARATION_LINE,
		'',
		...effect,
		ACCEPTANCE,
		'',
		LEFT_ONE,
	].join('\n')

	it('carries the expected-effect section a run-time-shortening aim requires', () => {
		const body = issue_spill.follow_up_body({ ...SUBJECT, body: timed }, ESTIMATE)

		expect(body).toContain(effect.join('\n'))
		expect(expected_effect_lint.problems(body)).toStrictEqual([])
	})

	it('writes no expected-effect section when the original has none', () => {
		expect(issue_spill.follow_up_body(SUBJECT, ESTIMATE)).not.toContain(
			expected_effect_lint.HEADING,
		)
	})
})

describe('issue_spill.estimate_line', () => {
	it.each([
		['2 ファイル / 40 行', ESTIMATE],
		['約 2 ファイル / 40 行', ESTIMATE],
		['2ファイル/40行', ESTIMATE],
	])('reads %s as the declaration line', (given, expected) => {
		expect(issue_spill.estimate_line(given)).toBe(expected)
	})

	it.each(['', '2 files / 40 lines', '2 ファイル'])('refuses %j', (given) => {
		expect(issue_spill.estimate_line(given)).toBeUndefined()
	})
})
