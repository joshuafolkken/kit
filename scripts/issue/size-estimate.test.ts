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

const REASON = '- 分割しない理由: 1 コミットで入れないと壊れる'
// joshuafolkken/kit#5654: the guide and the cap judge the declaration doubled, so 4 / 100 sits at the guide.
const UNDER_GUIDE = body_with(estimate(4, 100))
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
		const problem = size_estimate.guide_problem(body_with(estimate(6, 150)), undefined)

		expect(problem).toContain('6 file(s) / 150 line(s)')
		expect(problem).toContain('more than 8 files or 200 lines')
		expect(problem).toContain('split-assessment.md → "The question"')
	})

	// joshuafolkken/kit#5384: either axis alone is over the guide.
	it('refuses an estimate over the guide on the line axis alone', () => {
		const body = body_with(estimate(3, 101))

		expect(size_estimate.guide_problem(body, undefined)).toContain('3 file(s) / 101 line(s)')
	})

	it('passes 3 files / 80 lines, under the guide once doubled', () => {
		const body = body_with(estimate(3, 80))

		expect(size_estimate.guide_problem(body, undefined)).toBeUndefined()
	})

	it('prints the factor and the doubled estimate', () => {
		const problem = size_estimate.guide_problem(body_with(estimate(5, 90)), undefined)

		expect(problem).toContain('size estimate 5 file(s) / 90 line(s) × 2 = 10 file(s) / 180 line(s)')
	})
})

describe('size_estimate measured growth', () => {
	it('uses separate files and lines medians without an implement rate', () => {
		const body = body_with(estimate(6, 150))

		expect(
			size_estimate.over_guide(body, undefined, undefined, { files: 1, lines: 1 }),
		).toBeUndefined()
		expect(
			size_estimate.over_guide(body, undefined, undefined, { files: 1.5, lines: 1 }),
		).toBeDefined()
		expect(
			size_estimate.over_guide(body, undefined, undefined, { files: 1, lines: 1.5 }),
		).toBeDefined()
	})

	it('falls back only on the missing axis', () => {
		const body = body_with(estimate(5, 101))

		expect(size_estimate.over_guide(body, undefined, undefined, { files: 1 })).toBeDefined()
		expect(size_estimate.over_guide(body, undefined, undefined, { lines: 1 })).toBeDefined()
		expect(
			size_estimate.over_guide(body, undefined, undefined, { files: 1, lines: 1 }),
		).toBeUndefined()
	})

	it('compares grown files and lines with the cap using strict boundaries', () => {
		const growth = { files: 1.5, lines: 3 }
		const within = body_with(estimate(8, 100))
		const files = body_with(estimate(9, 100))
		const lines = body_with(estimate(8, 101))

		expect(size_estimate.over_cap(within, undefined, undefined, growth)).toBeUndefined()
		expect(size_estimate.over_cap(files, undefined, undefined, growth)).toBeDefined()
		expect(size_estimate.over_cap(lines, undefined, undefined, growth)).toBeDefined()
	})
})

// joshuafolkken/kit#5935: the split child's exemption holds at filing; `backlog:next` warns on it.
describe('size_estimate.split_over_guide', () => {
	it('answers a split child over the guide for the offer warning', () => {
		expect(size_estimate.split_over_guide(OVER_GUIDE, SPLIT_ROUTE)).toEqual({
			files: 30,
			lines: 900,
			verdict: 'split',
		})
	})

	it('answers no split warning within the guide or off the split route', () => {
		expect(size_estimate.split_over_guide(UNDER_GUIDE, SPLIT_ROUTE)).toBeUndefined()
		expect(size_estimate.split_over_guide(OVER_GUIDE, undefined)).toBeUndefined()
		expect(size_estimate.split_over_guide(body_with(), SPLIT_ROUTE)).toBeUndefined()
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
		const body = body_with(estimate(6, 150), REASON)

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

// joshuafolkken/kit#5502: past the cap a filing with no declared reason is refused.
// joshuafolkken/kit#5654: the doubled declaration is what meets the cap, so 6 / 150 sits at it
// (joshuafolkken/kit#6066 lowered it to one and a half times the guide).
describe('size_estimate cap', () => {
	it('passes 6 files / 150 lines with a reason declared', () => {
		const body = body_with(estimate(6, 150), REASON)

		expect(size_estimate.guide_problem(body, undefined)).toBeUndefined()
		expect(size_estimate.over_cap(body, undefined)).toBeUndefined()
	})

	it('refuses 7 files with no reason declared', () => {
		const problem = size_estimate.guide_problem(body_with(estimate(7, 150)), undefined)

		expect(problem).toContain('7 file(s) / 150 line(s) × 2 = 14 file(s) / 300 line(s)')
		expect(problem).toContain('exceeds the cap (more than 12 files or 300 lines) with no')
		expect(problem).toContain('--route split')
		expect(problem).toContain('- 分割しない理由: <理由>')
	})

	it('refuses 151 lines with no reason declared', () => {
		const body = body_with(estimate(6, 151))

		expect(size_estimate.over_cap(body, undefined)).toEqual({
			files: 6,
			lines: 151,
			verdict: 'split',
		})
	})

	// joshuafolkken/kit#6602: the declared reason is the pre-start decision, so it excuses the cap.
	it('passes 9 files / 400 lines with a reason declared', () => {
		const body = body_with(estimate(9, 400), REASON)

		expect(size_estimate.guide_problem(body, undefined)).toBeUndefined()
		expect(size_estimate.over_cap(body, undefined)).toBeUndefined()
	})

	it('passes a split child over the cap', () => {
		expect(size_estimate.guide_problem(OVER_GUIDE, SPLIT_ROUTE)).toBeUndefined()
		expect(size_estimate.over_cap(OVER_GUIDE, SPLIT_ROUTE)).toBeUndefined()
	})
})

// joshuafolkken/kit#5758: a decision that widens the scope restates the estimate `lane:plan` reads.
describe('size_estimate.stated_line', () => {
	it('reads the estimate line a decision record states', () => {
		const record = ['### Bundle #5710', '', `  ${estimate(11, 300)}`, '- 理由: 同梱'].join('\n')

		expect(size_estimate.stated_line(record)).toBe(estimate(11, 300))
	})

	it('reads none from a record without a parsable estimate', () => {
		expect(size_estimate.stated_line('### Hold\n\n- 規模見積もり: 多い')).toBeUndefined()
		expect(size_estimate.stated_line(['```', estimate(11, 300), '```'].join('\n'))).toBeUndefined()
	})
})

describe('size_estimate.restated', () => {
	it('replaces the background estimate so declared_size reads the new one', () => {
		const body = size_estimate.restated(body_with(estimate(2, 60)), estimate(11, 300))

		expect(size_estimate.declared_size(body)).toMatchObject({ files: 11, lines: 300 })
		expect(body).toBe(body_with(estimate(11, 300)))
	})

	// joshuafolkken/kit#7210: a line in either language is replaced whole, its indentation kept.
	it.each([
		'  - 規模見積もり: 約 2 ファイル / 60 行（テスト除く）',
		'  - Size estimate: about 2 files / 60 lines (excluding tests)',
	])('replaces the estimate line %s whatever its language', (line) => {
		const body = size_estimate.restated(body_with(line), estimate(11, 300))

		expect(body).toBe(body_with(`  ${estimate(11, 300)}`))
	})

	it('leaves an estimate outside the background section alone', () => {
		const body = ['## 背景', '', 'x', '', '## 現象', '', estimate(2, 60)].join('\n')

		expect(size_estimate.restated(body, estimate(11, 300))).toBe(body)
	})

	it('leaves a body that declares no estimate unchanged', () => {
		expect(size_estimate.restated(body_with(), estimate(11, 300))).toBe(body_with())
	})
})
