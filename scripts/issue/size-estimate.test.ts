import { describe, expect, it } from 'vitest'
import { size_estimate } from './size-estimate'

// joshuafolkken/kit#4675: every filing declares its size estimate, and one over the split guide is
// refused unless it is filed as a split or says why it stays one Issue.

const SPLIT_ROUTE = 'route:split'
const MALFORMED_HINT = 'must be written'

function body_with(...lines: ReadonlyArray<string>): string {
	return ['## 背景', '', '- 種別: 非不具合', ...lines, '', '## 現象', '', 'x'].join('\n')
}

function estimate(files: number, lines: number): string {
	return `- 規模見積もり: 約 ${String(files)} ファイル / ${String(lines)} 行（テスト除く）`
}

const UNDER_GUIDE = body_with(estimate(8, 200))
const OVER_GUIDE = body_with(estimate(30, 900))

describe('size_estimate.problems', () => {
	it('refuses a body with no estimate', () => {
		expect(size_estimate.problems(body_with())).toEqual([
			expect.stringContaining('missing size estimate'),
		])
	})

	it('refuses a malformed estimate', () => {
		const problems = size_estimate.problems(body_with('- 規模見積もり: たくさん'))

		expect(problems).toEqual([expect.stringContaining(MALFORMED_HINT)])
	})

	// joshuafolkken/kit#5225: the refusal's last line is an example the check admits as pasted.
	it('ends the malformed refusal in a one-line example it admits', () => {
		const [found = ''] = size_estimate.problems(body_with('- 規模見積もり: 多い'))
		const example = found.split('\n').at(-1) ?? ''

		expect(example).toMatch(/^- 規模見積もり: 約 /u)
		expect(size_estimate.problems(body_with(example))).toEqual([])
	})

	it('accepts a well-formed estimate', () => {
		expect(size_estimate.problems(UNDER_GUIDE)).toEqual([])
	})

	it('accepts half-width parentheses', () => {
		const body = body_with('- 規模見積もり: 約 3 ファイル / 120 行 (テスト除く)')

		expect(size_estimate.problems(body)).toEqual([])
	})

	it('refuses an estimate with no file count', () => {
		const body = body_with('- 規模見積もり: 約 120 行（テスト除く）')

		expect(size_estimate.problems(body)).toEqual([expect.stringContaining(MALFORMED_HINT)])
	})

	it('exempts an epic body', () => {
		expect(size_estimate.problems('## Split rationale\n\nwhy\n')).toEqual([])
	})

	it('ignores a declaration outside the background section', () => {
		const body = `${body_with()}\n${estimate(3, 120)}`

		expect(size_estimate.problems(body)).toEqual([expect.stringContaining('missing')])
	})
})

describe('size_estimate.guide_problem', () => {
	it('passes an estimate under the guide', () => {
		expect(size_estimate.guide_problem(UNDER_GUIDE, undefined)).toBeUndefined()
	})

	it('refuses an estimate over the guide on both axes', () => {
		const problem = size_estimate.guide_problem(OVER_GUIDE, undefined)

		expect(problem).toContain('30 file(s) / 900 line(s)')
		expect(problem).toContain('more than 8 files or 200 lines')
		expect(problem).toContain('split-assessment.md → "The question"')
	})

	// joshuafolkken/kit#5384: either axis alone is over the guide.
	it('refuses an estimate over the guide on the line axis alone', () => {
		const body = body_with(estimate(3, 201))

		expect(size_estimate.guide_problem(body, undefined)).toContain('3 file(s) / 201 line(s)')
	})
})

describe('size_estimate.over_guide', () => {
	it('answers the estimate over the guide with no reason', () => {
		const body = body_with(estimate(9, 10))

		expect(size_estimate.over_guide(body, undefined)).toEqual({
			files: 9,
			lines: 10,
			verdict: 'split',
		})
	})

	it('answers nothing under the guide, or excused', () => {
		expect(size_estimate.over_guide(UNDER_GUIDE, undefined)).toBeUndefined()
		expect(size_estimate.over_guide(OVER_GUIDE, SPLIT_ROUTE)).toBeUndefined()
	})

	it('passes an estimate over the guide filed as a split', () => {
		expect(size_estimate.guide_problem(OVER_GUIDE, SPLIT_ROUTE)).toBeUndefined()
	})

	it('passes an estimate over the guide with a reason declared', () => {
		const body = body_with(estimate(30, 900), '- 分割しない理由: 1 コミットで入れないと壊れる')

		expect(size_estimate.guide_problem(body, undefined)).toBeUndefined()
	})

	it('refuses an over-guide estimate whose reason is empty', () => {
		const body = body_with(estimate(30, 900), '- 分割しない理由:')

		expect(size_estimate.guide_problem(body, undefined)).toBeDefined()
	})

	it('leaves a missing estimate to the lint', () => {
		expect(size_estimate.guide_problem(body_with(), undefined)).toBeUndefined()
	})
})
