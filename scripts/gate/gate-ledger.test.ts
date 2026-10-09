import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { process_identity } from '#scripts/josh/process-identity'
import type { ProcessOwner } from '#scripts/josh/process-owner'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { core_budget, type LiveReservation } from './core-budget'
import { gate_ledger } from './gate-ledger'
import { machine_capacity } from './machine-capacity'

// joshuafolkken/kit#3501: a gate records the load it ran beside, read where none of its own checks
// runs, so `josh metrics` can leave out the gates another lane's work slowed.

const scratch = mkdtempSync(path.join(tmpdir(), 'gate-ledger-test-'))
const read_machine = vi.spyOn(machine_capacity, 'read_machine')
const QUIET_BUSY = machine_capacity.BASELINE_CORES
const BUSY_EXTERNAL = 3
const OUTCOME = { elapsed_ms: 1000, is_passed: true }
const live_reservations = vi.spyOn(core_budget, 'live_reservations')
const MID_GATE_CORES = 2
const SAMPLES = 3
const OWN: ProcessOwner = process_identity.own_fields()
const FOREIGN: ProcessOwner = { pid: process.pid + 1, process_start: 'another lane' }

function reads(...busy_cores: ReadonlyArray<number | undefined>): void {
	for (const busy of busy_cores) {
		read_machine.mockResolvedValueOnce({ busy_cores: busy, available_mb: undefined })
	}
}

function held(key: string, owner: ProcessOwner, weight: number): LiveReservation {
	return { key, reservation: { ...owner, weight, claimed_at: 0, admitted_at: 0 } }
}

function waiting(key: string, weight: number): LiveReservation {
	return { key, reservation: { ...FOREIGN, weight, claimed_at: 0 } }
}

// A gate that ran for `samples` sampling intervals between its two end readings.
async function recorded(name: string, samples = 0): Promise<number | undefined> {
	const ledger_path = path.join(scratch, `${name}.jsonl`)
	const begun = await gate_ledger.start(ledger_path)

	vi.advanceTimersByTime(gate_ledger.SAMPLE_INTERVAL_MS * samples)
	await gate_ledger.record(begun, [], OUTCOME)

	const [entry] = lane_ledger.read_entries(ledger_path)

	return entry?.kind === 'gate' ? entry.external_cores : NaN
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
	read_machine.mockReset()
	live_reservations.mockReset()
	live_reservations.mockReturnValue([])
})

afterEach(() => {
	vi.useRealTimers()
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('gate_ledger — the external load a gate ran beside', () => {
	it('records no external cores when the machine sat at its baseline at both ends', async () => {
		reads(QUIET_BUSY, QUIET_BUSY)

		await expect(recorded('quiet')).resolves.toBe(0)
	})

	it('records the busier of the two ends', async () => {
		reads(QUIET_BUSY, QUIET_BUSY + BUSY_EXTERNAL)

		await expect(recorded('busy-end')).resolves.toBe(BUSY_EXTERNAL)
	})

	it('records no reading when either end could not be read', async () => {
		reads(QUIET_BUSY, undefined)

		await expect(recorded('unread')).resolves.toBeUndefined()
	})

	it('reads nothing when no ledger was resolved', async () => {
		await gate_ledger.record(await gate_ledger.start(undefined), [], OUTCOME)

		expect(read_machine).not.toHaveBeenCalled()
		expect(live_reservations).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#3556: two end readings missed every lane whose lint, tests or `ship` ran only while
// the gate did, so the gate samples the core budget's ledger between its ends as well.
describe('gate_ledger — the load between the ends', () => {
	it('records another process admitted claim held mid-gate, though both ends were quiet', async () => {
		reads(QUIET_BUSY, QUIET_BUSY)
		live_reservations.mockReturnValue([held('other-lint', FOREIGN, MID_GATE_CORES)])

		await expect(recorded('busy-middle', SAMPLES)).resolves.toBe(MID_GATE_CORES)
	})

	it('records no external cores when the ledger held only this gate own claims', async () => {
		reads(QUIET_BUSY, QUIET_BUSY)
		live_reservations.mockReturnValue([held('own-unit', OWN, MID_GATE_CORES)])

		await expect(recorded('quiet-throughout', SAMPLES)).resolves.toBe(0)
	})

	it('does not count a claim still waiting for its place', async () => {
		reads(QUIET_BUSY, QUIET_BUSY)
		live_reservations.mockReturnValue([waiting('other-waiting', MID_GATE_CORES)])

		await expect(recorded('waiting', SAMPLES)).resolves.toBe(0)
	})

	it('records no reading when an end could not be read, whatever the middle held', async () => {
		reads(QUIET_BUSY, undefined)
		live_reservations.mockReturnValue([held('other-test', FOREIGN, MID_GATE_CORES)])

		await expect(recorded('unread-end', SAMPLES)).resolves.toBeUndefined()
	})

	it('stops sampling once the gate is recorded', async () => {
		reads(QUIET_BUSY, QUIET_BUSY)
		await recorded('stopped', SAMPLES)
		live_reservations.mockClear()

		vi.advanceTimersByTime(gate_ledger.SAMPLE_INTERVAL_MS * SAMPLES)

		expect(live_reservations).not.toHaveBeenCalled()
	})
})
