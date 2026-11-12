import { describe, expect, it } from 'vitest'
import { gate_checks, type GateCheck } from './gate-checks'
import { gate_labels } from './gate-labels'

const { EXPORTS_LABEL, LOCKFILE_LABEL, METRICS_LABEL, UNIT_LABEL } = gate_labels

function labels(checks: ReadonlyArray<GateCheck>): ReadonlyArray<string> {
	return checks.map((check) => check.label)
}

describe('gate_checks.select_gate_checks', () => {
	it('adds the unit check last only when the unit suite is included', () => {
		expect(labels(gate_checks.select_gate_checks(true, true, true)).at(-1)).toBe(UNIT_LABEL)
		expect(labels(gate_checks.select_gate_checks(false))).not.toContain(UNIT_LABEL)
	})

	it('drops the kit-only checks outside kit', () => {
		const consumer = labels(gate_checks.select_gate_checks(false, false, true))

		expect(consumer).not.toContain(METRICS_LABEL)
		expect(consumer).not.toContain(LOCKFILE_LABEL)
		expect(consumer).toContain(EXPORTS_LABEL)
	})

	it('includes the whole-tree checks by default only without the unit suite', () => {
		expect(labels(gate_checks.select_gate_checks(false))).toContain(EXPORTS_LABEL)
		expect(labels(gate_checks.select_gate_checks(true))).not.toContain(EXPORTS_LABEL)
	})
})

describe('gate_checks.selected_checks', () => {
	it('reads an empty selection as the lane gate', () => {
		expect(gate_checks.selected_checks({})).toEqual(gate_checks.LANE_GATE_CHECKS)
	})

	it('passes an explicit selection through to select_gate_checks', () => {
		const selection = { is_unit_included: false, is_kit_repository: false }

		expect(gate_checks.selected_checks(selection)).toEqual(
			gate_checks.select_gate_checks(false, false),
		)
	})
})

describe('gate_checks.whole_tree_labels', () => {
	it('names both whole-tree checks in kit and only the shared one in a consumer', () => {
		expect(gate_checks.whole_tree_labels()).toEqual([EXPORTS_LABEL, METRICS_LABEL])
		expect(gate_checks.whole_tree_labels(false)).toEqual([EXPORTS_LABEL])
	})
})

describe('gate_checks.has_unit_check', () => {
	it('answers from the checks rather than a flag', () => {
		expect(gate_checks.has_unit_check(gate_checks.GATE_CHECKS)).toBe(true)
		expect(gate_checks.has_unit_check(gate_checks.STATIC_CHECKS)).toBe(false)
	})
})
