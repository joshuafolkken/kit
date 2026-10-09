import { describe, expect, it } from 'vitest'
import { metrics_baseline_merge } from './metrics-baseline-merge'
import { metrics_logic, type Metrics } from './metrics-logic'
import type { Baseline } from './metrics-ratchet'

// joshuafolkken/kit#3517: two lanes that each moved the totals against the same main merge without a
// conflict, each side's change added to the other's.

const BASE: Metrics = {
	scripts: { files: 10, code_lines: 1000, comment_lines: 400, comment_ratio: 0.4 },
	rules: { files: 3, lines: 200 },
	guards: 5,
	ai_cost: { resident_bytes: 9000, on_demand_bytes: 300_000 },
}
const OURS_ACCEPTED = { reason: 'Ours grew for #2', date: '2026-10-09' }
const THEIRS_ACCEPTED = { reason: 'Theirs grew for #1', date: '2026-10-08' }

const OURS_RAISED: Baseline = {
	...BASE,
	scripts: { files: 11, code_lines: 1100, comment_lines: 400, comment_ratio: 0.36 },
	accepted: OURS_ACCEPTED,
}
const THEIRS_RAISED: Baseline = {
	...BASE,
	scripts: { files: 12, code_lines: 1050, comment_lines: 500, comment_ratio: 0.48 },
	guards: 6,
	accepted: THEIRS_ACCEPTED,
}

function text(baseline: Baseline): string {
	return metrics_logic.baseline_text(baseline)
}

function parsed(merged: string | undefined): unknown {
	return merged === undefined ? undefined : JSON.parse(merged)
}

describe('metrics_baseline_merge.merge', () => {
	it('adds both raises to the totals and recomputes the comment ratio', () => {
		const merged = metrics_baseline_merge.merge(text(BASE), text(OURS_RAISED), text(THEIRS_RAISED))

		expect(parsed(merged)).toStrictEqual({
			...BASE,
			scripts: { files: 13, code_lines: 1150, comment_lines: 500, comment_ratio: 0.43 },
			guards: 6,
			accepted: OURS_ACCEPTED,
		})
	})

	it('keeps a lowered total lowered while the other side raises it', () => {
		const ours: Baseline = { ...BASE, rules: { files: 3, lines: 190 } }
		const theirs: Baseline = { ...BASE, rules: { files: 4, lines: 230 } }
		const merged = metrics_baseline_merge.merge(text(BASE), text(ours), text(theirs))

		expect(parsed(merged)).toStrictEqual({ ...BASE, rules: { files: 4, lines: 220 } })
	})

	it('takes theirs accepted record when ours has none', () => {
		const theirs: Baseline = { ...BASE, accepted: THEIRS_ACCEPTED }
		const merged = metrics_baseline_merge.merge(text(BASE), text(BASE), text(theirs))

		expect(parsed(merged)).toStrictEqual({ ...BASE, accepted: THEIRS_ACCEPTED })
	})

	it('keeps theirs newer accepted record when ours left the base record unchanged', () => {
		const base_accepted = { reason: 'Base grew for #0', date: '2026-10-07' }
		const base: Baseline = { ...BASE, accepted: base_accepted }
		const ours: Baseline = { ...base, guards: 4 }
		const theirs: Baseline = { ...BASE, accepted: THEIRS_ACCEPTED }
		const merged = metrics_baseline_merge.merge(text(base), text(ours), text(theirs))

		expect(parsed(merged)).toStrictEqual({ ...BASE, guards: 4, accepted: THEIRS_ACCEPTED })
	})

	it('answers undefined when a side is not a readable baseline', () => {
		expect(metrics_baseline_merge.merge('', text(BASE), text(BASE))).toBeUndefined()
		expect(metrics_baseline_merge.merge(text(BASE), '{}', text(BASE))).toBeUndefined()
	})
})
