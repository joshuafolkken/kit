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
// What `epicrun` runs at, and the count the field measurement of joshuafolkken/kit#1515 was taken
// under: six lanes, each gate sizing itself from the core count alone.
const LANE_COUNT = 6
// Two lanes still leave every check a core of the measured machine, so this is the boundary the
// narrowing must not cross: the point where sharing is real and the fan-out is still affordable.
const PAIRED_LANES = 2
// More lanes than the machine has cores, which is the arithmetic `MIN_SHARED_CORES` exists for.
const OVERSUBSCRIBED_LANES = 99

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

describe('gate_plan.resolve_concurrency under concurrency', () => {
	// joshuafolkken/kit#1547: joshuafolkken/kit#1515 divided the machine for the unit suite alone,
	// leaving each lane's other three checks unbounded — six lanes therefore put 24 checks on 11
	// cores, where one gate took 254.1s with lint alone at 252.9s against 5.2s solo. eslint, tsc and
	// cspell take no worker count between them, so how many run at once is the only quantity left.
	it('narrows to one check at a time when six lanes share the machine', () => {
		expect(gate_plan.resolve_concurrency(MEASURED_CORES, LANE_COUNT)).toBe(1)
	})

	// The narrowing is proportional rather than a switch: two lanes still fit every check, so a pair
	// of gates keeps the fan-out that was measured faster than running them back to back.
	it('leaves a pair of lanes the whole fan-out', () => {
		expect(gate_plan.resolve_concurrency(MEASURED_CORES, PAIRED_LANES)).toBe(
			gate_plan.GATE_CHECKS.length,
		)
	})

	// The property the whole change rests on: at one run the division is `cores / 1`, so a solo gate
	// and a CI runner are handed the number they were always handed — the same number by arithmetic,
	// not a branch that could later be got wrong.
	it.each([MEASURED_CORES, CI_CORES, MID_SIZED_CORES, 1])(
		'is unchanged on %i cores for a gate that is the only run',
		(cores) => {
			expect(gate_plan.resolve_concurrency(cores, 1)).toBe(gate_plan.resolve_concurrency(cores))
		},
	)

	// A count that is not a number must leave the machine undivided rather than sail through the
	// clamp: `Math.max(1, NaN)` is `NaN`, every `reserved > share` comparison against it is false,
	// and the gate would admit all four checks in exactly the condition meant to narrow it. A count
	// below one is nonsense too, and reading it as one run leaves behavior where it was.
	it.each([NaN, 0, -1])('leaves the machine undivided for a run count of %p', (runs) => {
		expect(gate_plan.resolve_concurrency(MEASURED_CORES, runs)).toBe(
			gate_plan.resolve_concurrency(MEASURED_CORES),
		)
	})

	// More lanes never means more checks in flight, and the far end of that curve must still start a
	// gate rather than return a width of zero — which would run no check and report a green gate.
	it('never widens, and never stops, as lanes are added', () => {
		const widths = Array.from({ length: OVERSUBSCRIBED_LANES }, (_unused, index) =>
			gate_plan.resolve_concurrency(MEASURED_CORES, index + 1),
		)

		expect(widths).toEqual([...widths].toSorted((left, right) => right - left))
		expect(widths.at(-1)).toBe(1)
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

	// joshuafolkken/kit#1515: the reserve table is a measurement of one gate on an idle machine, and
	// six lanes each reading it put 42 workers on 11 cores at a load average of 14.97. Six concurrent
	// suites produced ten `Test timed out in 10000ms` failures; at the share below they produced none.
	it('divides the machine when other unit runs are in flight', () => {
		expect(gate_plan.resolve_unit_worker_cap(MEASURED_CORES, LANE_COUNT)).toBe(1)
		expect(gate_plan.resolve_unit_worker_cap(MEASURED_CORES, 2)).toBe(5)
	})

	// The share beats the "leave a small machine alone" rule rather than the other way round: leaving
	// an eight-core machine uncapped is a decision about one gate, and six of them on it is not that.
	it('divides a machine below the measured one too, once it is shared', () => {
		expect(gate_plan.resolve_unit_worker_cap(MID_SIZED_CORES, LANE_COUNT)).toBe(1)
	})

	// The property the whole change rests on: a solo gate is sized exactly as it was, so CI and every
	// quiet machine behave as before and only the measured-broken condition changes.
	it('is unchanged for a gate that is the only run on the machine', () => {
		expect(gate_plan.resolve_unit_worker_cap(MEASURED_CORES, 1)).toBe(
			gate_plan.resolve_unit_worker_cap(MEASURED_CORES),
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

	// A lane owner reading a gate that took one worker must not be left deriving the reason from a
	// number that looks wrong. The solo line is unchanged, which is what keeps `josh time`'s detector
	// and every existing reader unaffected (joshuafolkken/kit#1515).
	//
	// **Both numbers move together now** (joshuafolkken/kit#1547): the width in front is what the
	// three checks that take no worker count are narrowed by, and the worker count behind it is the
	// unit suite's share, so a shared gate says on one line how it was cut down and why.
	it('says how many runs the machine is being shared with', () => {
		const plan = gate_plan.resolve_gate_plan(MEASURED_CORES, LANE_COUNT)

		expect(gate_plan.format_gate_plan(plan, MEASURED_CORES, LANE_COUNT)).toBe(
			'plan: 1 of 4 checks at once, test:unit at 1 workers (11 cores, 6 unit runs)',
		)
	})

	it('says nothing about sharing when the gate is the only run', () => {
		expect(gate_plan.format_machine(MEASURED_CORES, 1)).toBe('11 cores')
	})
})
