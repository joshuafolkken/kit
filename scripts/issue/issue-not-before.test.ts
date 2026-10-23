import { describe, expect, it } from 'vitest'
import { issue_lint_cli } from './issue-lint-cli'
import { issue_not_before } from './issue-not-before'

const DATE = '2026-10-20T09:30Z'
const NOW_BEFORE = Date.parse('2026-10-20T09:29Z')
const NOW_AFTER = Date.parse('2026-10-20T09:31Z')

function body_with(line: string): string {
	return `## 背景\n\n- 種別: 非不具合\n${line}\n\n## 現象\n\n## 期待結果\n\n## 受け入れ条件\n`
}

const DATED_BODY = body_with(`- 実施可能日: ${DATE}`)

describe('issue_not_before.is_due', () => {
	it('is not due before the declared time', () => {
		expect(issue_not_before.is_due(DATED_BODY, NOW_BEFORE)).toBe(false)
	})

	it('is due from the declared time on', () => {
		expect(issue_not_before.is_due(DATED_BODY, Date.parse(DATE))).toBe(true)
		expect(issue_not_before.is_due(DATED_BODY, NOW_AFTER)).toBe(true)
	})

	it('is due when the body declares no time, or has no body', () => {
		expect(issue_not_before.is_due(body_with(''), NOW_BEFORE)).toBe(true)
		expect(issue_not_before.is_due(undefined, NOW_BEFORE)).toBe(true)
	})

	it('ignores a declaration outside the background section', () => {
		const body = `${body_with('')}\n- 実施可能日: ${DATE}\n`

		expect(issue_not_before.is_due(body, NOW_BEFORE)).toBe(true)
	})
})

describe('issue_not_before.waiting_ms', () => {
	it('is the declared time while it is ahead', () => {
		expect(issue_not_before.waiting_ms(DATED_BODY, NOW_BEFORE)).toBe(Date.parse(DATE))
	})

	it('is undefined once due, with no declaration, or with a malformed one', () => {
		expect(issue_not_before.waiting_ms(DATED_BODY, NOW_AFTER)).toBeUndefined()
		expect(issue_not_before.waiting_ms(body_with(''), NOW_BEFORE)).toBeUndefined()
		expect(
			issue_not_before.waiting_ms(body_with('- 実施可能日: 2026-02-30T09:30Z'), 0),
		).toBeUndefined()
	})
})

describe('issue_not_before.waiting_date', () => {
	it('is the declared time as written while it is ahead', () => {
		expect(issue_not_before.waiting_date(DATED_BODY, NOW_BEFORE)).toBe(DATE)
	})

	it('is undefined once due, or with no declaration', () => {
		expect(issue_not_before.waiting_date(DATED_BODY, NOW_AFTER)).toBeUndefined()
		expect(issue_not_before.waiting_date(body_with(''), NOW_BEFORE)).toBeUndefined()
	})
})

describe('issue_not_before.waiting_reason', () => {
	it('names the time before it is due', () => {
		expect(issue_not_before.waiting_reason(DATED_BODY, NOW_BEFORE)).toBe(`not before ${DATE}`)
	})

	it('says nothing once it is due', () => {
		expect(issue_not_before.waiting_reason(DATED_BODY, NOW_AFTER)).toBeUndefined()
	})
})

describe('the start-time declaration in issue:lint', () => {
	it('accepts the UTC spelling', () => {
		expect(issue_lint_cli.problems(DATED_BODY)).toEqual([])
	})

	it.each([
		'2026-10-20',
		'2026-10-20T09:30+09:00',
		'2026-13-40T09:30Z',
		'2026-02-30T09:30Z',
		'2026-10-20T24:00Z',
		'',
	])('refuses %j', (value) => {
		const found = issue_lint_cli.problems(body_with(`- 実施可能日: ${value}`))

		expect(found).toEqual([expect.stringContaining('YYYY-MM-DDTHH:MMZ')])
	})
})

describe('a start condition written as its own heading in issue:lint', () => {
	// The body #4430 was filed with: a free-text condition under its own heading, never read.
	const ISSUE_4430_BODY = `${body_with('')}\n## 実施可能条件\n\n#4426 のマージ後に、マージが 30 件以上ある\n`
	const CONDITION_LINE = '`- 実施可能条件: #<PR> のマージ後 <K> マージ`'
	const DATE_LINE = '`- 実施可能日: YYYY-MM-DDTHH:MMZ`'

	it('refuses the condition heading and shows the background declaration', () => {
		expect(issue_lint_cli.problems(ISSUE_4430_BODY)).toEqual([
			expect.stringContaining(CONDITION_LINE),
		])
	})

	it.each([
		['### 実施可能日', DATE_LINE],
		['## 実施可能日（UTC）', DATE_LINE],
		['# 実施可能条件', CONDITION_LINE],
	])('refuses the heading %j and shows the background declaration', (heading, declaration) => {
		const body = `${body_with('')}\n${heading}\n\n${DATE}\n`

		expect(issue_lint_cli.problems(body)).toEqual([expect.stringContaining(declaration)])
	})

	it('reads a line that only starts with a hash as no heading', () => {
		const body = `${body_with('')}\n#実施可能条件\n`

		expect(issue_lint_cli.problems(body)).toEqual([])
	})

	it('accepts the declaration lines under the background heading alone', () => {
		const body = body_with(`- 実施可能日: ${DATE}\n- 実施可能条件: #4426 のマージ後 30 マージ`)

		expect(issue_lint_cli.problems(body)).toEqual([])
	})

	it('ignores the heading inside a code fence', () => {
		const body = `${body_with('')}\n\`\`\`md\n## 実施可能条件\n\`\`\`\n`

		expect(issue_lint_cli.problems(body)).toEqual([])
	})
})
