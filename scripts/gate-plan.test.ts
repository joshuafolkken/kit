import { describe, expect, it } from 'vitest'
import { gate_plan } from './gate-plan'

// joshuafolkken/kit#1258: the gate started four checks whatever the machine was, and vitest opened
// one worker per core inside one of them. The plan is what makes both numbers decidable, so the
// numbers are asserted here rather than only observed on the machine they were measured on.

// The machine the reserves were measured on: Apple M3 Pro, 11 logical cores.
const { MEASURED_CORES } = gate_plan
// GitHub-hosted `ubuntu-latest`, which is what `.github/workflows/ci.yml` runs `josh gate` on.
const CI_CORES = 4
// The band a fixed four-core reservation would hurt most: half an eight-core machine, against a
// third of the measured one.
const MID_SIZED_CORES = 8
// Well past the point where every check is admitted, so the monotonicity check covers the whole
// shape of the curve rather than only the machines anyone has today.
const CORE_COUNTS_PROBED = 20

describe('gate_plan.resolve_concurrency', () => {
	it('runs every check at once on a machine that can host them', () => {
		expect(gate_plan.resolve_concurrency(MEASURED_CORES)).toBe(gate_plan.GATE_CHECKS.length)
	})

	// The three reserving checks want four cores between them, so a four-core runner is the smallest
	// machine that still fans out to all four. CI sits exactly here, which is what makes this change
	// a no-op there.
	it('still runs every check at once on a four-core runner', () => {
		expect(gate_plan.resolve_concurrency(CI_CORES)).toBe(gate_plan.GATE_CHECKS.length)
	})

	// Below that the checks queue instead of fighting: this is the half of the plan that keeps a
	// small machine working rather than thrashing.
	it.each([
		[3, 2],
		[2, 1],
		[1, 1],
	])('admits %i cores worth of checks as %i at a time', (available, expected) => {
		expect(gate_plan.resolve_concurrency(available)).toBe(expected)
	})

	// A machine reporting nothing usable must still run the gate, one check at a time, rather than
	// returning a width of zero — which would run no check at all and report a green gate.
	it('never drops below one check at a time', () => {
		expect(gate_plan.resolve_concurrency(0)).toBe(1)
	})

	// More cores never means fewer checks: a plan that dipped would be read as a measurement error
	// on whichever machine hit the dip.
	it('never narrows as the machine grows', () => {
		const widths = Array.from({ length: CORE_COUNTS_PROBED }, (_unused, cores) =>
			gate_plan.resolve_concurrency(cores),
		)

		expect(widths).toEqual([...widths].toSorted((left, right) => left - right))
	})
})

describe('gate_plan.resolve_unit_worker_cap', () => {
	// 11 cores less the 4 the other three hold. The figures for this one are the capped-vs-uncapped
	// A/B — a different comparison from the concurrent-vs-serial pair the other files quote, and
	// stated as such so the two are not read as disagreeing measurements of one thing: the cap held
	// wall time inside run-to-run noise and burned 5–6% less CPU, 101s against 107s.
	it('leaves the unit suite the cores the other checks do not hold', () => {
		expect(gate_plan.resolve_unit_worker_cap(MEASURED_CORES)).toBe(
			MEASURED_CORES - gate_plan.RESERVED_CORES,
		)
	})

	// A machine smaller than the measured one keeps the behavior the gate had before the plan
	// existed, rather than an extrapolation of a single measurement.
	it('leaves the choice to vitest below the machine it was measured on', () => {
		expect(gate_plan.resolve_unit_worker_cap(CI_CORES)).toBeUndefined()
		expect(gate_plan.resolve_unit_worker_cap(MEASURED_CORES - 1)).toBeUndefined()
	})

	// The band a fixed reservation would hurt without saying so: four of eight cores handed away
	// pins the longest check at 4 workers, where the suite was measured at 16.7s against 11.7s at 8.
	it('never hands a mid-sized machine the worker count measured as the slow one', () => {
		expect(gate_plan.resolve_unit_worker_cap(MID_SIZED_CORES)).toBeUndefined()
	})

	it('keeps capping as the machine grows past the measured one', () => {
		expect(gate_plan.resolve_unit_worker_cap(MEASURED_CORES + 1)).toBe(
			MEASURED_CORES + 1 - gate_plan.RESERVED_CORES,
		)
	})
})

describe('gate_plan.GATE_CHECKS', () => {
	// The unit suite sizes its own pool from the machine, so counting it among the reserves would
	// reserve cores against the very check the cap is for.
	it('reserves nothing for the check it caps instead', () => {
		const unit = gate_plan.GATE_CHECKS.find((check) => check.label === gate_plan.UNIT_LABEL)

		expect(unit?.reserved_cores).toBe(0)
	})

	it('reserves what the other three were measured to hold', () => {
		expect(gate_plan.RESERVED_CORES).toBe(4)
	})
})

describe('gate_plan.format_gate_plan', () => {
	it('names the width, the cap and the core count', () => {
		const plan = gate_plan.resolve_gate_plan(MEASURED_CORES)

		expect(gate_plan.format_gate_plan(plan, MEASURED_CORES)).toBe(
			'plan: 4 of 4 checks at once, test:unit at 7 workers (11 cores)',
		)
	})

	// An uncapped run has to say so rather than print nothing where the number goes: "unrestricted"
	// is a decision the plan made, and a blank would read as one it failed to make.
	it('says so when the unit suite is left uncapped', () => {
		const plan = gate_plan.resolve_gate_plan(CI_CORES)

		expect(gate_plan.format_gate_plan(plan, CI_CORES)).toContain('test:unit unrestricted')
	})
})
