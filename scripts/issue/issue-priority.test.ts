import { describe, expect, it } from 'vitest'
import { PRIORITY_CRITICAL_LABEL, PRIORITY_HIGH_LABEL } from './issue-labels'
import { issue_priority } from './issue-priority'

// joshuafolkken/kit#4383: the priority issue:file applies from the body's declaration, and the floor a
// run-time-shortening Issue's stated reduction per merge sets.

const BASE = ['bug']
const SHORTENING_LINE = '- 目的: 時間短縮\n'
const HIGH_WITH_DEADLINE = '- 優先度: 高（期限）'

function body(declaration: string, extra = ''): string {
	return `## 背景\n\n- 種別: 非不具合\n${extra}${declaration}\n\n## 期待効果\n\n`
}

function shortening(declaration: string, percent: string): string {
	const line = `- 1 マージあたりの短縮: 4 分（レーン中央値 40 分 の ${percent}）`

	return `${body(declaration, SHORTENING_LINE)}${line}\n`
}

describe('issue_priority.declared_level', () => {
	it.each([
		['- 優先度: 緊急（条件 1）', 'critical'],
		['- 優先度: 緊急（短縮 12%）', 'critical'],
		['- 優先度: 高（持ち主の期限）', 'high'],
		['- 優先度: 通常', 'normal'],
		['', 'normal'],
	])('reads %j as %s', (declaration, level) => {
		expect(issue_priority.declared_level(body(declaration))).toBe(level)
	})

	it.each([
		['- 優先度: 緊急（なし）'],
		['- 優先度: 緊急（短縮 未計測）'],
		['- 優先度: 緊急（条件 <1-3> / 短縮 <値>）'],
		['- 優先度: 高（）'],
		['- 優先度: 高（<根拠>）'],
		['- 優先度: 高'],
		['- 優先度: 緊急'],
	])('refuses %j, which names no basis', (declaration) => {
		expect(issue_priority.declared_level(body(declaration))).toBeUndefined()
		expect(issue_priority.problem(body(declaration), [])).toContain('declare at most one priority')
	})

	it('refuses two declarations', () => {
		const twice = body(`- 優先度: 通常\n${HIGH_WITH_DEADLINE}`)

		expect(issue_priority.problem(twice, [])).toBeDefined()
	})
})

describe('issue_priority.floor_of', () => {
	it.each([
		['10%', 'critical'],
		['9.9%', 'high'],
		['3%', 'high'],
		['2.9%', 'normal'],
	])('ranks a %s reduction per merge as %s', (percent, level) => {
		expect(issue_priority.floor_of(shortening('', percent))).toBe(level)
	})

	it.each([['分の 10%'], ['分の10%'], ['分 の 10 %'], ['分 の 10％']])(
		'reads the percentage however it is spaced or which sign it uses: %j',
		(tail) => {
			const line = `- 1 マージあたりの短縮: 4 分（レーン中央値 40 ${tail}）\n`

			expect(issue_priority.floor_of(`${body('', SHORTENING_LINE)}${line}`)).toBe('critical')
		},
	)

	it('sets no floor on an Issue that does not declare the shortening aim', () => {
		const line = '- 1 マージあたりの短縮: 4 分（レーン中央値 40 分 の 10%）\n'

		expect(issue_priority.floor_of(`${body('')}${line}`)).toBe('normal')
	})
})

describe('issue_priority.problem', () => {
	it('refuses a declaration below the stated reduction', () => {
		expect(issue_priority.problem(shortening('- 優先度: 高（短縮 10%）', '10%'), [])).toContain(
			'`critical`',
		)
		expect(issue_priority.problem(shortening('', '3%'), [])).toContain('`high`')
	})

	it('accepts a declaration at or above the stated reduction', () => {
		expect(
			issue_priority.problem(shortening('- 優先度: 緊急（短縮 10%）', '10%'), []),
		).toBeUndefined()
		expect(issue_priority.problem(shortening('- 優先度: 緊急（条件 2）', '3%'), [])).toBeUndefined()
	})

	it('refuses a run-time-shortening Issue whose reduction line is missing or left as the placeholder', () => {
		const missing = body('- 優先度: 通常', SHORTENING_LINE)
		const placeholder = `${missing}- 1 マージあたりの短縮: <分>（レーン中央値 <分> の <%>）\n`

		for (const filed of [missing, placeholder]) {
			expect(issue_priority.problem(filed, [])).toContain('with its percentage filled in')
		}
	})

	it('does not judge the body when a priority label was typed', () => {
		expect(issue_priority.problem(body('- 優先度: 高'), [PRIORITY_CRITICAL_LABEL])).toBeUndefined()
	})
})

describe('issue_priority.with_label', () => {
	it('adds the declared level label', () => {
		expect(issue_priority.with_label(BASE, body('- 優先度: 緊急（条件 3）'))).toStrictEqual([
			...BASE,
			PRIORITY_CRITICAL_LABEL,
		])
		expect(issue_priority.with_label(BASE, body(HIGH_WITH_DEADLINE))).toStrictEqual([
			...BASE,
			PRIORITY_HIGH_LABEL,
		])
	})

	it('adds nothing for a normal declaration or none', () => {
		expect(issue_priority.with_label(BASE, body('- 優先度: 通常'))).toStrictEqual(BASE)
		expect(issue_priority.with_label(BASE, body(''))).toStrictEqual(BASE)
	})

	it('keeps a typed priority label over the declaration', () => {
		const typed = [PRIORITY_CRITICAL_LABEL]

		expect(issue_priority.with_label(typed, body(HIGH_WITH_DEADLINE))).toStrictEqual(typed)
	})
})
