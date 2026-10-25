import { describe, expect, it } from 'vitest'
import { PRIORITY_CRITICAL_LABEL, PRIORITY_HIGH_LABEL } from './issue-labels'
import { issue_priority } from './issue-priority'

// joshuafolkken/kit#4383: the priority issue:file applies from the body's declaration, and the floor a
// run-time-shortening Issue's stated reduction per merge sets.

const BASE = ['bug']
const SHORTENING_LINE = '- 目的: 時間短縮\n'
const HIGH_WITH_DEADLINE = '- 優先度: 高（期限）'
const URGENT_CONDITION_2 = '- 優先度: 緊急（条件 2）'
const PARK_PREFIX = '- 原因の park:'

function body(declaration: string, extra = ''): string {
	return `## 背景\n\n- 種別: 非不具合\n${extra}${declaration}\n\n## 期待効果\n\n`
}

const CRITICAL_FLOOR = '`critical`'

function reduction_line(percent: string): string {
	return `- 1 マージあたりの短縮: 4 分（レーン中央値 40 分 の ${percent}）\n`
}

function shortening(declaration: string, percent: string, extra = ''): string {
	return body(declaration, `${SHORTENING_LINE}${extra}`) + reduction_line(percent)
}

function lane_line(minutes: string): string {
	return `- 原因のレーン: ${minutes} 分（#4695）\n`
}

function lane(minutes: string, declaration = ''): string {
	return body(declaration, lane_line(minutes))
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
			CRITICAL_FLOOR,
		)
		expect(issue_priority.problem(shortening('- 優先度: 通常', '3%'), [])).toContain('`high`')
	})

	it('files a body that declares no priority at its reduction floor', () => {
		expect(issue_priority.problem(shortening('', '3%'), [])).toBeUndefined()
		expect(issue_priority.with_label(BASE, shortening('', '3%'))).toStrictEqual([
			...BASE,
			PRIORITY_HIGH_LABEL,
		])
	})

	it('accepts a declaration at or above the stated reduction', () => {
		expect(
			issue_priority.problem(shortening('- 優先度: 緊急（短縮 10%）', '10%'), []),
		).toBeUndefined()
		expect(issue_priority.problem(shortening(URGENT_CONDITION_2, '3%'), [])).toBeUndefined()
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

describe('issue_priority causing lane (joshuafolkken/kit#4749)', () => {
	it.each([
		['64', [PRIORITY_CRITICAL_LABEL]],
		['60.5', [PRIORITY_CRITICAL_LABEL]],
		['60', [PRIORITY_HIGH_LABEL]],
		['45', [PRIORITY_HIGH_LABEL]],
		['40', []],
	])('files a %s-minute causing lane with no declaration at %j', (minutes, labels) => {
		expect(issue_priority.problem(lane(minutes), [])).toBeUndefined()
		expect(issue_priority.with_label(BASE, lane(minutes))).toStrictEqual([...BASE, ...labels])
	})

	it('refuses a declaration below the causing lane, naming the critical floor', () => {
		const filed = issue_priority.problem(lane('64', HIGH_WITH_DEADLINE), [])

		expect(filed).toContain(CRITICAL_FLOOR)
		expect(filed).toContain('緊急')
		expect(filed).toContain('causing lane')
		expect(filed).toContain('原因のレーン …')
	})

	it('accepts an urgent declaration that names the causing lane as its basis', () => {
		expect(
			issue_priority.problem(lane('64', '- 優先度: 緊急（原因のレーン 64 分）'), []),
		).toBeUndefined()
	})

	it.each([
		['- 原因のレーン: 長い 分（#4695）'],
		['- 原因のレーン: 64 分'],
		['- 原因のレーン: 64 分（4695）'],
	])('refuses the malformed line %j', (line) => {
		expect(issue_priority.problem(body('', `${line}\n`), [])).toContain('lane:net')
	})
})

describe('issue_priority.floor_of with a causing lane', () => {
	it.each([
		['10%', '45', 'critical'],
		['3%', '64', 'critical'],
		['3%', '30', 'high'],
	])(
		'takes the higher floor of a %s reduction and a %s-minute lane: %s',
		(percent, minutes, level) => {
			const filed = shortening('', percent, lane_line(minutes))

			expect(issue_priority.floor_of(filed)).toBe(level)
		},
	)
})

const SECURITY_LINE = '- セキュリティ: Issue 本文がガードを通らずに読める\n'
const PARK_LINE = '- 原因の park: #4703\n'

describe.each([
	['security finding (H)', SECURITY_LINE, '- セキュリティ:'],
	['caused park (I)', PARK_LINE, PARK_PREFIX],
])('issue_priority %s (joshuafolkken/kit#4767)', (_name, line, prefix) => {
	it('files a body that declares no priority at high', () => {
		expect(issue_priority.problem(body('', line), [])).toBeUndefined()
		expect(issue_priority.with_label(BASE, body('', line))).toStrictEqual([
			...BASE,
			PRIORITY_HIGH_LABEL,
		])
	})

	it('refuses a normal declaration, naming the high floor and the line', () => {
		const filed = issue_priority.problem(body('- 優先度: 通常', line), [])

		expect(filed).toContain('`high`')
		expect(filed).toContain(prefix.slice('- '.length, -':'.length))
	})

	it('accepts a declaration at or above the floor', () => {
		expect(issue_priority.problem(body(HIGH_WITH_DEADLINE, line), [])).toBeUndefined()
		expect(issue_priority.problem(body(URGENT_CONDITION_2, line), [])).toBeUndefined()
	})

	it('does not judge the line when a priority label was typed', () => {
		const filed = body('- 優先度: 通常', line)

		expect(issue_priority.problem(filed, [PRIORITY_CRITICAL_LABEL])).toBeUndefined()
		expect(issue_priority.with_label([PRIORITY_CRITICAL_LABEL], filed)).toStrictEqual([
			PRIORITY_CRITICAL_LABEL,
		])
	})
})

describe('issue_priority malformed H / I lines (joshuafolkken/kit#4767)', () => {
	it.each([['- セキュリティ:'], ['- セキュリティ: <迂回される gate・ガード・権限>']])(
		'refuses the security line %j',
		(line) => {
			expect(issue_priority.problem(body('', `${line}\n`), [])).toContain('security finding')
		},
	)

	it.each([['- 原因の park: 4703'], ['- 原因の park: #<N>'], [PARK_PREFIX]])(
		'refuses the park line %j',
		(line) => {
			expect(issue_priority.problem(body('', `${line}\n`), [])).toContain('caused park')
		},
	)

	it('refuses the #4765-shaped body: a caused park declared normal', () => {
		const filed = `## 背景\n\n- 種別: 不具合\n- 原因の park: #4703\n- 優先度: 通常\n`

		expect(issue_priority.problem(filed, [])).toContain('`high`')
	})
})

// joshuafolkken/kit#4858: a fold into an open Issue skips issue:file, so it sets this floor itself.
describe('issue_priority.lane_label', () => {
	it('labels a causing lane by the same thresholds as its line in a body', () => {
		expect(issue_priority.lane_label(40)).toBeUndefined()
		expect(issue_priority.lane_label(41)).toBe(PRIORITY_HIGH_LABEL)
		expect(issue_priority.lane_label(60)).toBe(PRIORITY_HIGH_LABEL)
		expect(issue_priority.lane_label(61)).toBe(PRIORITY_CRITICAL_LABEL)
	})

	it('reads no floor from a causing-lane line without minutes', () => {
		expect(issue_priority.floor_of(body('', '- 原因のレーン: 不明\n'))).toBe('normal')
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
