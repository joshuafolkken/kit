import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { process_identity } from '#scripts/josh/process-identity'
import { process_identity_fixture } from '#scripts/josh/process-identity-fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { core_budget, type LiveReservation } from './core-budget'

// joshuafolkken/kit#2351: the gate's CPU budget was decided once at start, so overlapping gates each
// reserved the whole machine and the peak ran past the core count. What is pinned here is the ledger's
// admission arithmetic — FIFO, budget-bounded, head-always-admitted — the liveness rule that keeps a
// leaked place from filling the budget forever, and the solo path that admits without waiting.

// The machine the gate's weights were measured on: Apple M3 Pro, 11 logical cores.
const MEASURED_CORES = 11
// A solo gate's four claims: the static checks' reserved cores and the unit suite's solo cap. Their sum
// is exactly the budget, which is what makes a solo gate admit all four at once.
const SOLO_GATE_WEIGHTS: ReadonlyArray<number> = [2, 1, 1, 7]
const { DEAD_PID, GROUP_PID, NEGATIVE_PID } = process_identity_fixture
const PROBE_PREFIX = 'josh-core-budget-test-'
const DEAD_MARKER = `${core_budget.RESERVED_PREFIX}dead.json`
const ALIVE_MARKER = `${core_budget.RESERVED_PREFIX}alive.json`

function reservation(weight: number, claimed_at: number, key: string): LiveReservation {
	return { key, reservation: { pid: process.pid, weight, claimed_at } }
}

// One gate's four reservations, claimed in order and offset per gate so the ledger orders whole gates
// before their siblings — the shape overlapping gates produce.
function gate_reservations(gate_index: number, unit_weight: number): Array<LiveReservation> {
	const base = gate_index * SOLO_GATE_WEIGHTS.length
	const weights = [...SOLO_GATE_WEIGHTS.slice(0, -1), unit_weight]

	return weights.map((weight, offset) =>
		reservation(weight, base + offset, `g${String(gate_index)}-c${String(offset)}`),
	)
}

function probe_directory(): string {
	return mkdtempSync(path.join(tmpdir(), PROBE_PREFIX))
}

function write_marker(directory: string, name: string, payload: unknown): void {
	writeFileSync(path.join(directory, name), JSON.stringify(payload))
}

describe('core_budget.admitted_keys — FIFO admission within the budget', () => {
	// The property the whole change rests on: a solo gate's four claims sum to the budget, so every one
	// is admitted and its concurrency is unchanged.
	it('admits every check of a gate that is alone on the machine', () => {
		const gate = gate_reservations(0, SOLO_GATE_WEIGHTS.at(-1) ?? 0)

		expect(core_budget.admitted_keys(gate, MEASURED_CORES).size).toBe(gate.length)
	})

	// A place is never jumped: the first claim that does not fit stops the walk, so admission follows
	// claim order rather than seizing whatever fits.
	it('defers the claims past the budget in claim order', () => {
		const reservations = [
			reservation(8, 1, 'first'),
			reservation(2, 2, 'second'),
			reservation(2, 3, 'third'),
		]

		expect(core_budget.admitted_keys(reservations, MEASURED_CORES)).toEqual(
			new Set(['first', 'second']),
		)
	})

	// A single check heavier than the whole machine must run rather than wait for room that never comes.
	it('always admits the head even when it alone exceeds the budget', () => {
		const reservations = [reservation(20, 1, 'huge'), reservation(1, 2, 'next')]

		expect(core_budget.admitted_keys(reservations, MEASURED_CORES)).toEqual(new Set(['huge']))
	})
})

describe('core_budget.admitted_load — the peak stays within the budget', () => {
	// The reproduction of the saturation joshuafolkken/kit#2351 was filed for: 6 and 8 gates' worth of
	// claims on one machine, where the weight actually admitted at once never exceeds the core count.
	it.each([[6], [7], [8]])('keeps %i concurrent gates within the logical core count', (gates) => {
		const unit_weight = Math.max(1, Math.floor(MEASURED_CORES / gates))
		const reservations = Array.from({ length: gates }, (_unused, index) =>
			gate_reservations(index, unit_weight),
		).flat()

		expect(core_budget.admitted_load(reservations, MEASURED_CORES)).toBeLessThanOrEqual(
			MEASURED_CORES,
		)
	})
})

describe('core_budget.live_reservations — who counts as holding a place', () => {
	let directory: string

	beforeEach(() => {
		directory = probe_directory()
	})

	afterEach(() => {
		rmSync(directory, { recursive: true, force: true })
	})

	it('counts a marker whose process is still alive', () => {
		write_marker(directory, ALIVE_MARKER, {
			...process_identity.own_fields(),
			weight: 2,
			claimed_at: 1,
		})

		expect(core_budget.live_reservations(directory)).toHaveLength(1)
	})

	// A leaked place must not fill the budget forever: a marker recording a dead or non-process pid is
	// counted out, and the dead one is swept so a reissued pid cannot revive it.
	it.each([[DEAD_PID], [GROUP_PID], [NEGATIVE_PID]])('ignores a marker recording pid %i', (pid) => {
		write_marker(directory, DEAD_MARKER, { pid, weight: 2, claimed_at: 1 })

		expect(core_budget.live_reservations(directory)).toHaveLength(0)
	})

	it('removes the marker of a process that is gone', () => {
		write_marker(directory, DEAD_MARKER, { pid: DEAD_PID, weight: 2, claimed_at: 1 })
		core_budget.live_reservations(directory)

		expect(existsSync(path.join(directory, DEAD_MARKER))).toBe(false)
	})
})

// The weight one gate's unit step reserves solo, and the whole budget a blocking place holds.
const SOLO_UNIT_WEIGHT = 7
// The wait cap the reservation is admitted at once the clock passes it, small so the injected clock
// reaches it in one sleep.
const TEST_WAIT_CAP_MS = 10

function marker_count(directory: string): number {
	return readdirSync(directory).filter((name) => name.startsWith(core_budget.RESERVED_PREFIX))
		.length
}

// A live place that fills the whole budget on its own, claimed before anything this run does, so a new
// reservation cannot fit until it is freed.
function write_blocking_marker(directory: string): void {
	write_marker(directory, ALIVE_MARKER, {
		...process_identity.own_fields(),
		weight: MEASURED_CORES,
		claimed_at: 0,
	})
}

async function with_probe<T>(run: (directory: string) => Promise<T>): Promise<T> {
	const directory = probe_directory()

	try {
		return await run(directory)
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
}

// The solo path: nothing else holds a place, so the claim is the ledger's head and is admitted on the
// first read — the loop body never runs and no sleep is paid.
async function reserve_admits_solo_without_waiting(): Promise<void> {
	await with_probe(async (directory) => {
		const sleep = vi.fn(async () => {
			throw new Error('a solo reservation must not wait')
		})
		const handle = await core_budget.reserve(SOLO_UNIT_WEIGHT, {
			directory,
			budget: MEASURED_CORES,
			sleep,
		})

		expect(sleep).not.toHaveBeenCalled()
		expect(marker_count(directory)).toBe(1)

		core_budget.release(handle)

		expect(marker_count(directory)).toBe(0)
	})
}

// The wait path: a place opens while the reservation is polling, and the next read admits it. The
// injected sleep frees the blocking place, standing in for a sibling gate finishing.
async function reserve_admits_once_freed(): Promise<void> {
	await with_probe(async (directory) => {
		write_blocking_marker(directory)
		const sleep = vi.fn(async () => {
			rmSync(path.join(directory, ALIVE_MARKER), { force: true })
		})

		await core_budget.reserve(SOLO_UNIT_WEIGHT, {
			directory,
			budget: MEASURED_CORES,
			now: () => 1,
			sleep,
		})

		expect(sleep).toHaveBeenCalledTimes(1)
	})
}

// The wait cap: the budget never clears, but the reservation still returns at minimum width once the
// clock passes the deadline rather than stalling the machine for good.
async function reserve_admits_at_wait_cap(): Promise<void> {
	await with_probe(async (directory) => {
		write_blocking_marker(directory)
		const clock = { value: 0 }
		const sleep = vi.fn(async () => {
			clock.value += TEST_WAIT_CAP_MS
		})

		await core_budget.reserve(SOLO_UNIT_WEIGHT, {
			directory,
			budget: MEASURED_CORES,
			wait_cap_ms: TEST_WAIT_CAP_MS,
			now: () => clock.value,
			sleep,
		})

		expect(marker_count(directory)).toBe(2)
	})
}

describe('core_budget.reserve — waiting on the machine-wide budget', () => {
	it('admits a solo reservation without waiting', reserve_admits_solo_without_waiting)
	it('is admitted once a blocking place is freed', reserve_admits_once_freed)
	it('admits at the wait cap when the budget never clears', reserve_admits_at_wait_cap)
})
