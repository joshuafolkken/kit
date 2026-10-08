import { describe, expect, it } from 'vitest'
import type { Metrics } from './metrics-logic'
import { metrics_ratchet, type Baseline } from './metrics-ratchet'

const BASELINE_PATH = '.josh/metrics-baseline.json'
const ACCEPTED = { reason: 'New guard for #1', date: '2026-10-08' }

const BASE_METRICS: Metrics = {
	scripts: { files: 10, code_lines: 1000, comment_lines: 400, comment_ratio: 0.4 },
	rules: { files: 3, lines: 200 },
	guards: 5,
}
const BASELINE: Baseline = { ...BASE_METRICS, accepted: ACCEPTED }

function metrics_with(overrides: Partial<Metrics>): Metrics {
	return { ...BASE_METRICS, ...overrides }
}

describe('metrics_ratchet.compare', () => {
	it('fails on a grown total, naming its baseline and current values', () => {
		const verdict = metrics_ratchet.compare(BASELINE, metrics_with({ guards: 6 }))

		expect(verdict).toStrictEqual({
			kind: 'regressed',
			regressions: [{ name: 'guards', baseline: 5, current: 6 }],
		})
	})

	it('reports a growth even when another total shrank', () => {
		const current = metrics_with({ guards: 4, rules: { files: 3, lines: 201 } })
		const verdict = metrics_ratchet.compare(BASELINE, current)

		expect(verdict.kind).toBe('regressed')
	})

	it('lowers the baseline to the current totals and keeps the last accepted reason', () => {
		const current = metrics_with({ rules: { files: 3, lines: 190 } })

		expect(metrics_ratchet.compare(BASELINE, current)).toStrictEqual({
			kind: 'improved',
			baseline: { ...current, accepted: ACCEPTED },
		})
	})

	it('answers unchanged when no compared total moved', () => {
		const current = metrics_with({ scripts: { ...BASELINE.scripts, files: 11 } })

		expect(metrics_ratchet.compare(BASELINE, current)).toStrictEqual({ kind: 'unchanged' })
	})
})

describe('metrics_ratchet.accept', () => {
	it('records the current totals with the reason and date beside them', () => {
		const current = metrics_with({ guards: 9 })

		expect(metrics_ratchet.accept(current, ACCEPTED.reason, ACCEPTED.date)).toStrictEqual({
			...current,
			accepted: ACCEPTED,
		})
	})
})

describe('metrics_ratchet.parse_baseline', () => {
	it('reads a baseline written as JSON, with or without an accepted reason', () => {
		const accepted = JSON.stringify(BASELINE)
		const unaccepted = JSON.stringify(BASE_METRICS)

		expect(metrics_ratchet.parse_baseline(accepted)).toStrictEqual(BASELINE)
		expect(metrics_ratchet.parse_baseline(unaccepted)).toStrictEqual(BASE_METRICS)
	})

	it('answers undefined for malformed text or a missing total', () => {
		expect(metrics_ratchet.parse_baseline('not json')).toBeUndefined()
		expect(metrics_ratchet.parse_baseline(JSON.stringify({ guards: 1 }))).toBeUndefined()
	})
})

describe('metrics_ratchet.render_regressions', () => {
	it('lists each grown total and states how to raise the baseline', () => {
		const text = metrics_ratchet.render_regressions(
			[{ name: 'rules.lines', baseline: 200, current: 210 }],
			BASELINE_PATH,
		)

		expect(text).toContain(`1 total(s) grew past the baseline in ${BASELINE_PATH}`)
		expect(text).toContain('rules.lines  baseline 200 → current 210')
		expect(text).toContain('pnpm josh metrics --accept --reason')
	})
})
