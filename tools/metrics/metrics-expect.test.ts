import { describe, expect, it } from 'vitest'
import { metrics_expect } from './metrics-expect'
import type { Metrics } from './metrics-logic'
import { metrics_ratchet, type Approval } from './metrics-ratchet'

// joshuafolkken/kit#8860: a lane declares the growth before its first gate (`josh metrics --expect`).

const EXPECT = '--expect'
const REASON_FLAG = '--reason'
const REASON = 'Adds the declaration command'
const DATE = '2026-11-23'
const LATER = '2026-11-24'
const GUARDS = 'guards'
const RULE_LINES = 'rules.lines'
const CODE_LINES = 'scripts.code_lines'
const COMMENT_RATIO = 'scripts.comment_ratio'
const GUARDS_THREE = 'guards=3'
const ABOVE_ZERO = 'a growth above 0'
const ONE_REASON = 'one non-empty --reason'
const USAGE = 'usage'

const BASE: Metrics = {
	scripts: { files: 10, code_lines: 1000, comment_lines: 400, comment_ratio: 0.4 },
	rules: { files: 3, lines: 200 },
	guards: 5,
	ai_cost: { resident_bytes: 9000, on_demand_bytes: 300_000 },
	prose: { long_paragraphs: 800, excess_bold: 2100 },
}

function metrics_with(overrides: Partial<Metrics>): Metrics {
	return { ...BASE, ...overrides }
}

function approval_of(growth: Record<string, number>): Approval {
	return { reason: REASON, date: DATE, growth }
}

function refusal_of(argv: ReadonlyArray<string>): string {
	const parsed = metrics_expect.parse(argv)

	return parsed?.kind === 'refused' ? parsed.message : ''
}

describe('metrics_expect.parse', () => {
	it('reads every --expect and the trimmed reason (ac-df494071)', () => {
		const argv = [EXPECT, GUARDS_THREE, EXPECT, `${RULE_LINES}=20`, REASON_FLAG, ` ${REASON} `]

		expect(metrics_expect.parse(argv)).toStrictEqual({
			kind: 'expect',
			expectation: { growth: { [GUARDS]: 3, [RULE_LINES]: 20 }, reason: REASON },
		})
	})

	it('is not the --expect form for any other argv', () => {
		expect(metrics_expect.parse([])).toBeUndefined()
		expect(metrics_expect.parse(['--accept', REASON_FLAG, REASON])).toBeUndefined()
	})

	it('refuses a total the ratchet does not compare', () => {
		expect(refusal_of([EXPECT, 'scripts.files=3', REASON_FLAG, REASON])).toContain(ABOVE_ZERO)
	})

	it('refuses a growth that is not a number above zero', () => {
		for (const growth of ['0', '-5', 'many', '']) {
			const argv = [EXPECT, `${GUARDS}=${growth}`, REASON_FLAG, REASON]

			expect(refusal_of(argv)).toContain(ABOVE_ZERO)
		}

		expect(refusal_of([EXPECT, GUARDS, REASON_FLAG, REASON])).toContain(ABOVE_ZERO)
	})

	it('refuses an empty, a missing or a repeated reason', () => {
		expect(refusal_of([EXPECT, GUARDS_THREE, REASON_FLAG, ' '])).toContain(ONE_REASON)
		expect(refusal_of([EXPECT, GUARDS_THREE])).toContain(ONE_REASON)
		expect(refusal_of([EXPECT, GUARDS_THREE, REASON_FLAG, REASON, REASON_FLAG, REASON])).toContain(
			ONE_REASON,
		)
	})

	it('refuses an unknown flag and a flag without its value with the usage', () => {
		expect(refusal_of([EXPECT, GUARDS_THREE, '--json', REASON])).toContain(USAGE)
		expect(refusal_of([EXPECT, GUARDS_THREE, REASON_FLAG])).toContain(USAGE)
	})
})

describe('metrics_expect.parse in any flag order', () => {
	it('reads the --expect form whatever flag comes first', () => {
		expect(metrics_expect.parse([REASON_FLAG, REASON, EXPECT, GUARDS_THREE])).toStrictEqual({
			kind: 'expect',
			expectation: { growth: { [GUARDS]: 3 }, reason: REASON },
		})
	})
})

describe('metrics_ratchet.compare with a declared growth', () => {
	const declared = [approval_of({ [GUARDS]: 3, [RULE_LINES]: 20 })]

	it('passes a growth within the declaration (ac-3c327c3d, ac-0e46b3fa)', () => {
		const current = metrics_with({ guards: 7, rules: { files: 3, lines: 220 } })

		expect(metrics_ratchet.compare(BASE, current, declared)).toStrictEqual({ kind: 'approved' })
	})

	it('fails a total grown past its declared ceiling (ac-3c327c3d)', () => {
		const verdict = metrics_ratchet.compare(BASE, metrics_with({ guards: 9 }), declared)

		expect(verdict).toStrictEqual({
			kind: 'regressed',
			regressions: [{ name: GUARDS, base: 5, current: 9, growth: 4, approved: 3 }],
		})
	})

	it('fails a total the declaration does not name (ac-3c327c3d)', () => {
		const current = metrics_with({ scripts: { ...BASE.scripts, code_lines: 1001 } })

		expect(metrics_ratchet.compare(BASE, current, declared).kind).toBe('regressed')
	})
})

describe('metrics_ratchet.raised', () => {
	const declared = approval_of({ [GUARDS]: 5, [RULE_LINES]: 20 })

	it('keeps a declared ceiling an accept measured below (ac-a8740432)', () => {
		const accepted = { reason: 'accepted', date: LATER, growth: { [GUARDS]: 2, [CODE_LINES]: 10 } }

		expect(metrics_ratchet.raised(declared, accepted)).toStrictEqual({
			reason: 'accepted',
			date: LATER,
			growth: { [GUARDS]: 5, [RULE_LINES]: 20, [CODE_LINES]: 10 },
		})
	})

	it('raises a ceiling the new approval exceeds', () => {
		const raised = metrics_ratchet.raised(declared, approval_of({ [GUARDS]: 8 }))

		expect(raised.growth).toStrictEqual({ [GUARDS]: 8, [RULE_LINES]: 20 })
	})

	it('is the new approval alone when the branch recorded none', () => {
		const approval = approval_of({ [GUARDS]: 1 })

		expect(metrics_ratchet.raised(undefined, approval)).toBe(approval)
	})

	it('leaves a declaration whose ceiling still covers the growth unrefreshed (ac-a8740432)', () => {
		expect(
			metrics_ratchet.refresh(declared, BASE, metrics_with({ guards: 6 }), LATER),
		).toBeUndefined()
	})
})

describe('metrics_ratchet.RATCHETED_NAMES', () => {
	it('names every compared total', () => {
		expect(metrics_ratchet.RATCHETED_NAMES).toStrictEqual([
			CODE_LINES,
			COMMENT_RATIO,
			RULE_LINES,
			GUARDS,
			'ai_cost.resident_bytes',
			'ai_cost.on_demand_bytes',
			'prose.long_paragraphs',
			'prose.excess_bold',
		])
	})
})
