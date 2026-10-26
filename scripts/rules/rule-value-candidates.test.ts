import { describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { rule_value, type RuleReading } from './rule-value'
import { rule_value_candidates } from './rule-value-candidates'

// `file-body` is refused on every occurrence (`decide`); `issue-comments` once per run.
const EVERY_OCCURRENCE = 'file-body'
const ONCE_PER_RUN = 'issue-comments'
const { MIN_RUNS_FOR_RETIREMENT } = rule_value_candidates

function reading(id: string, overrides: Partial<RuleReading> = {}): RuleReading {
	const blank = rule_value.measure([]).find((candidate) => candidate.id === id)

	if (blank === undefined) throw new Error(`no reading for ${id}`)

	return { ...blank, ...overrides }
}

function has_decide(id: string): boolean {
	return delivered_rules.MEASURED_RULES.some((rule) => rule.id === id && rule.decide !== undefined)
}

describe('rule_value_candidates.retire_candidates — reached 0 over enough runs', () => {
	const unreached = reading(ONCE_PER_RUN)
	const unmeasured = reading(EVERY_OCCURRENCE)
	const reached = reading('direct-issue-read', { sessions: 1 })

	it('lists an unreached measurable rule once the window reaches the threshold', () => {
		const ids = rule_value_candidates.retire_candidates(
			[unreached, reached],
			MIN_RUNS_FOR_RETIREMENT,
		)

		expect(unreached.is_measurable).toBe(true)
		expect(ids).toStrictEqual([ONCE_PER_RUN])
	})

	// Its trigger is the violation, so `reached 0` reads "never broken", not "never arose".
	it('never lists an unmeasured rule, however many runs', () => {
		const ids = rule_value_candidates.retire_candidates([unmeasured], MIN_RUNS_FOR_RETIREMENT)

		expect(unmeasured.is_measurable).toBe(false)
		expect(ids).toStrictEqual([])
	})

	it('judges nothing below the threshold', () => {
		const ids = rule_value_candidates.retire_candidates(
			[unreached, unmeasured],
			MIN_RUNS_FOR_RETIREMENT - 1,
		)

		expect(ids).toStrictEqual([])
	})
})

describe('rule_value_candidates.condense_candidates — a hook keeps it on every occurrence', () => {
	it('lists a refused every-occurrence rule and not a refused once-per-run one', () => {
		expect(has_decide(EVERY_OCCURRENCE)).toBe(true)
		expect(has_decide(ONCE_PER_RUN)).toBe(false)

		const ids = rule_value_candidates.condense_candidates([
			reading(EVERY_OCCURRENCE, { sessions: 2, refusals: 1 }),
			reading(ONCE_PER_RUN, { sessions: 2, refusals: 1 }),
		])

		expect(ids).toStrictEqual([EVERY_OCCURRENCE])
	})

	it('leaves out an every-occurrence rule its hook never refused', () => {
		expect(rule_value_candidates.condense_candidates([reading(EVERY_OCCURRENCE)])).toStrictEqual([])
	})
})

describe('rule_value_candidates.render — one line per kind', () => {
	it('names each candidate and the window it was judged over', () => {
		const text = rule_value_candidates.render(
			{ retire: ['a', 'b'], condense: ['c'] },
			MIN_RUNS_FOR_RETIREMENT,
		)

		expect(text).toBe(
			[
				'candidates:',
				`  retire (reached 0; ${String(MIN_RUNS_FOR_RETIREMENT)} runs, threshold ${String(MIN_RUNS_FOR_RETIREMENT)}): a, b`,
				'  condense (refused on every occurrence by its hook): c',
			].join('\n'),
		)
	})

	it('reads none where a kind has no candidate', () => {
		const text = rule_value_candidates.render({ retire: [], condense: [] }, 1)

		expect(text).toContain(`): ${rule_value_candidates.NONE}\n`)
		expect(text.endsWith(`hook): ${rule_value_candidates.NONE}`)).toBe(true)
	})
})
