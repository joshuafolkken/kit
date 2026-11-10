import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import { gate_labels } from './gate-labels'
import { gate_plan, type GateCheck } from './gate-plan'
import { gate_static_group } from './gate-static-group'

const { MEASURED_CORES } = gate_plan
// GitHub-hosted `ubuntu-latest`, which is what `.github/workflows/ci.yml` runs `josh gate` on.
const CI_CORES = 4
const WHOLE_TREE_LABELS = [gate_labels.EXPORTS_LABEL, gate_labels.METRICS_LABEL]

function labels(checks: ReadonlyArray<GateCheck>): ReadonlyArray<string> {
	return checks.map((check) => check.label)
}

function whole_tree_in(checks: ReadonlyArray<GateCheck>): ReadonlyArray<string> {
	return labels(checks.filter((check) => check.is_whole_tree === true))
}

describe('gate_plan without the unit suite', () => {
	it('keeps the static checks and drops only the unit one', () => {
		expect(gate_plan.select_gate_checks(false)).toEqual(gate_plan.STATIC_CHECKS)
		expect(gate_plan.select_gate_checks(true, true, true)).toEqual(gate_plan.GATE_CHECKS)
	})

	it('is the whole gate minus one check, not a different set', () => {
		expect(gate_plan.GATE_CHECKS).toHaveLength(gate_plan.STATIC_CHECKS.length + 1)
		expect(gate_plan.GATE_CHECKS.slice(0, -1)).toEqual(gate_plan.STATIC_CHECKS)
	})

	// joshuafolkken/kit#7030: CI's legs each run one static group, and each group's reserving checks
	// fit the four-core runner, so the whole-tree checks' new weights queue nothing there.
	it.each(Object.keys(gate_static_group.STATIC_GROUPS))(
		'admits every check of the %s leg on CI',
		(group) => {
			const plan = gate_plan.resolve_gate_plan(CI_CORES, 1, { is_unit_included: false })
			const checks = gate_static_group.narrow_checks(plan.checks, group)

			expect(gate_plan.resolve_concurrency(CI_CORES, 1, checks)).toBe(checks.length)
		},
	)

	// A worker cap is a number for a check this plan never starts, so it carries none — and the line
	// says where the suite went rather than printing a blank or an inherited count.
	it('carries no worker cap and says where the unit suite is', () => {
		const plan = gate_plan.resolve_gate_plan(MEASURED_CORES, 1, { is_unit_included: false })

		expect(plan.unit_worker_cap).toBeUndefined()
		expect(gate_plan.format_gate_plan(plan, MEASURED_CORES)).toBe(
			'plan: 7 of 7 checks at once, test:unit elsewhere (11 cores)',
		)
	})

	// The default keeps the unit suite on every entry point that does not ask otherwise: a flipped
	// default would silently stop running the unit suite everywhere.
	it('leaves every other caller the lane gate, unit suite included', () => {
		expect(gate_plan.resolve_gate_plan(MEASURED_CORES).checks).toEqual(gate_plan.LANE_GATE_CHECKS)
		expect(gate_plan.has_unit_check(gate_plan.resolve_gate_plan(CI_CORES).checks)).toBe(true)
	})
})

// joshuafolkken/kit#7030: a lane's own gate leaves the whole-tree checks out, and the ship's gate and
// CI run them, so no path to main skips them.
describe('gate_plan the whole-tree checks', () => {
	it('leaves exports and metrics out of the lane gate', () => {
		expect(labels(gate_plan.LANE_GATE_CHECKS)).not.toContain(gate_labels.EXPORTS_LABEL)
		expect(labels(gate_plan.LANE_GATE_CHECKS)).not.toContain(gate_labels.METRICS_LABEL)
	})

	it.each([true, false])('runs them in the ship and CI gates (kit: %s)', (is_kit_repository) => {
		const expected = gate_plan.whole_tree_labels(is_kit_repository)
		const ship = gate_plan.resolve_gate_plan(MEASURED_CORES, 1, {
			is_kit_repository,
			is_whole_tree_included: true,
		})
		const ci = gate_plan.resolve_gate_plan(MEASURED_CORES, 1, {
			is_kit_repository,
			is_unit_included: false,
		})

		expect(expected).toContain(gate_labels.EXPORTS_LABEL)
		expect(whole_tree_in(ship.checks)).toEqual(expected)
		expect(whole_tree_in(ci.checks)).toEqual(expected)
	})

	it('names exports and metrics in kit, and exports alone in a consumer', () => {
		expect(gate_plan.whole_tree_labels()).toEqual(WHOLE_TREE_LABELS)
		expect(gate_plan.whole_tree_labels(false)).toEqual([gate_labels.EXPORTS_LABEL])
	})

	it('reserves cores for each, so the core budget admits them', () => {
		const whole_tree = gate_plan.GATE_CHECKS.filter((check) => check.is_whole_tree === true)

		expect(whole_tree.map((check) => check.label)).toEqual(WHOLE_TREE_LABELS)
		expect(whole_tree.every((check) => check.reserved_cores > 0)).toBe(true)
	})
})

// joshuafolkken/kit#3408: the metrics ratchet's command is not in the published package, so a
// consumer's gate must not start it — and must still run everything else.
describe('gate_plan in a consumer repository', () => {
	it('drops only the kit-only checks', () => {
		const checks = gate_plan.select_gate_checks(true, false, true)

		expect(labels(checks)).not.toContain(gate_labels.METRICS_LABEL)
		expect(checks).toEqual(gate_plan.GATE_CHECKS.filter((check) => check.is_kit_only !== true))
	})

	it('marks a check kit-only exactly when its josh command is', () => {
		for (const check of gate_plan.STATIC_CHECKS) {
			expect(check.is_kit_only === true).toBe(COMMAND_MAP[check.target]?.is_kit_only === true)
		}
	})
})
