import { describe, expect, it } from 'vitest'
import { PRIORITY_CRITICAL_LABEL, PRIORITY_HIGH_LABEL } from './issue-labels'
import { issue_priority } from './issue-priority'

// joshuafolkken/kit#4383: the priority issue:file applies from the body's declaration, and the floor a
// run-time-shortening Issue's stated reduction per merge sets.

const BASE = ['bug']
const SHORTENING_LINE = '- 目的: 時間短縮\n'
const HIGH_WITH_DEADLINE = '- 優先度: 高（期限）'
const HIGH_AT_TEN = '- 優先度: 高（短縮 10%）'
const URGENT_CONDITION_2 = '- 優先度: 緊急（条件 2）'
const PARK_PREFIX = '- 原因の park:'
const MALFORMED_LANE = '- 原因のレーン: 64 分（4695）'
const DECLARATION_REFUSAL = 'declare at most one priority'

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
		expect(issue_priority.problem(body(declaration), [])).toContain(DECLARATION_REFUSAL)
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

// joshuafolkken/kit#4886: a mechanism's summed share is judged by the same floor.
describe('issue_priority.percent_floor', () => {
	it.each([
		[10, 'critical'],
		[3, 'high'],
		[2.9, 'normal'],
		[undefined, 'normal'],
	])('ranks a %s%% share as %s', (percent, level) => {
		expect(issue_priority.percent_floor(percent)).toBe(level)
	})
})

describe('issue_priority.problem', () => {
	it('refuses a declaration below the stated reduction', () => {
		expect(issue_priority.problem(shortening(HIGH_AT_TEN, '10%'), [])).toContain(CRITICAL_FLOOR)
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

// joshuafolkken/kit#4870: a causing lane sets no floor; the reduction its fix states does.
describe('issue_priority causing lane (joshuafolkken/kit#4749)', () => {
	it.each([['64'], ['60.5'], ['45'], ['40']])(
		'files a %s-minute causing lane with no declaration at no priority',
		(minutes) => {
			expect(issue_priority.problem(lane(minutes), [])).toBeUndefined()
			expect(issue_priority.with_label(BASE, lane(minutes))).toStrictEqual(BASE)
		},
	)

	it.each([['48'], ['65']])(
		'ranks a %s-minute causing lane with a 4%% reduction high, not by its minutes',
		(minutes) => {
			const filed = shortening('', '4%', lane_line(minutes))

			expect(issue_priority.floor_of(filed)).toBe('high')
			expect(issue_priority.problem(filed, [])).toBeUndefined()
			expect(issue_priority.with_label(BASE, filed)).toStrictEqual([...BASE, PRIORITY_HIGH_LABEL])
		},
	)

	it.each([['- 原因のレーン: 長い 分（#4695）'], ['- 原因のレーン: 64 分'], [MALFORMED_LANE]])(
		'refuses the malformed line %j',
		(line) => {
			expect(issue_priority.problem(body('', `${line}\n`), [])).toContain('lane:net')
		},
	)
})

describe('issue_priority causing lane beside its reduction (joshuafolkken/kit#4870)', () => {
	it('refuses a run-time-shortening Issue with a causing lane under the 2% filing floor', () => {
		const filed = issue_priority.problem(shortening('', '1.9%', lane_line('48')), [])

		expect(filed).toContain('under 2%')
		expect(filed).toContain('about 50 merges')
		expect(filed).toContain('fold it into an open Issue')
	})

	it('files a run-time-shortening Issue with no causing lane under the filing floor as before', () => {
		expect(issue_priority.problem(shortening('', '1%'), [])).toBeUndefined()
		expect(issue_priority.floor_of(shortening('', '1%'))).toBe('normal')
	})

	it('accepts a declaration naming the high floor of a 4% reduction beside a 65-minute lane', () => {
		const filed = shortening('- 優先度: 高（短縮 4%）', '4%', lane_line('65'))

		expect(issue_priority.problem(filed, [])).toBeUndefined()
	})

	it('no longer takes the causing lane as an urgent basis', () => {
		const filed = lane('64', '- 優先度: 緊急（原因のレーン 64 分）')

		expect(issue_priority.problem(filed, [])).toContain(DECLARATION_REFUSAL)
		expect(issue_priority.problem(filed, [])).not.toContain('原因のレーン')
	})

	it('files a causing lane at the 3% high reduction', () => {
		const filed = shortening('', '3%', lane_line('48'))

		expect(issue_priority.problem(filed, [])).toBeUndefined()
	})

	it.each([
		[HIGH_AT_TEN, '10%'],
		['- 優先度: 通常', '3%'],
	])('names no causing lane as a basis when refusing %j at %s', (declaration, percent) => {
		const filed = shortening(declaration, percent, lane_line('65'))
		const refusal = issue_priority.problem(filed, [])

		expect(refusal).toContain('ranks this Issue')
		expect(refusal).not.toContain('原因のレーン')
		expect(refusal).not.toContain('causing lane')
	})
})

describe('issue_priority.floor_of with a causing lane', () => {
	it.each([
		['10%', '45', 'critical'],
		['3%', '64', 'high'],
		['3%', '30', 'high'],
	])('takes the floor of a %s reduction beside a %s-minute lane: %s', (percent, minutes, level) => {
		const filed = shortening('', percent, lane_line(minutes))

		expect(issue_priority.floor_of(filed)).toBe(level)
	})
})

// joshuafolkken/kit#4859: the minutes backlog ranking orders one priority by.
describe('issue_priority.lane_minutes', () => {
	it('reads the longest causing lane under the background heading', () => {
		const filed = body('', `${lane_line('4')}${lane_line('16.5')}`)

		expect(issue_priority.lane_minutes(filed)).toBe(16.5)
	})

	it.each([
		['no body', undefined],
		['no causing lane', body('')],
		['a malformed line', body('', `${MALFORMED_LANE}\n`)],
	])('answers 0 for %s', (_case, text) => {
		expect(issue_priority.lane_minutes(text)).toBe(0)
	})
})

// joshuafolkken/kit#4861: the minutes one cause lost rank it within its lane, and set no floor.
describe('issue_priority.lost_minutes', () => {
	const CAUSE_LINE = '- 原因の損失: 16 分\n'

	it('reads the largest cause-loss line ahead of the causing lane', () => {
		const filed = body('', `${lane_line('98')}- 原因の損失: 4 分\n${CAUSE_LINE}`)

		expect(issue_priority.lost_minutes(filed)).toBe(16)
	})

	it('falls back to the causing lane when no cause-loss line is declared', () => {
		expect(issue_priority.lost_minutes(lane('98'))).toBe(98)
	})

	it.each([
		['an absent body', undefined],
		['a body declaring neither', body('')],
	])('reads 0 from %s', (_case, text) => {
		expect(issue_priority.lost_minutes(text)).toBe(0)
	})

	it.each([['- 原因の損失: 16'], ['- 原因の損失: 16分'], ['- 原因の損失: 約 16 分']])(
		'refuses the cause-loss line %j',
		(line) => {
			expect(issue_priority.problem(body('', `${line}\n`), [])).toContain("cause's lost minutes")
		},
	)

	it('accepts a well-formed cause-loss line', () => {
		expect(issue_priority.problem(body('', CAUSE_LINE), [])).toBeUndefined()
	})

	it('sets no floor, nor does the causing lane beside it', () => {
		const short_lane = body('', `${lane_line('30')}- 原因の損失: 90 分\n`)
		const long_lane = body('', `${lane_line('98')}- 原因の損失: 2 分\n`)

		expect(issue_priority.floor_of(short_lane)).toBe('normal')
		expect(issue_priority.floor_of(long_lane)).toBe('normal')
	})
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
