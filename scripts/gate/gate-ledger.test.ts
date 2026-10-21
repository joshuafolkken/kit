import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { process_identity } from '#scripts/josh/process-identity'
import type { ProcessOwner } from '#scripts/josh/process-owner'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { related_scope } from '#scripts/test/test-related-scope'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { core_budget, type LiveReservation } from './core-budget'
import { gate_ledger } from './gate-ledger'
import { gate_plan } from './gate-plan'
import { machine_capacity } from './machine-capacity'

// joshuafolkken/kit#3501: a gate records the load it ran beside, read where none of its own checks
// runs, so `josh metrics` can leave out the gates another lane's work slowed.

const scratch = mkdtempSync(path.join(tmpdir(), 'gate-ledger-test-'))
const read_machine = vi.spyOn(machine_capacity, 'read_machine')
const QUIET_BUSY = gate_ledger.BACKGROUND_CORES
const BUSY_EXTERNAL = 3
const OUTCOME = { elapsed_ms: 1000, is_passed: true }
const live_reservations = vi.spyOn(core_budget, 'live_reservations')
const MID_GATE_CORES = 2
const SAMPLES = 3
const CHECK_CPU_MS = 6812.4
const CHECK_CPU_ROUNDED = 6812
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

	// joshuafolkken/kit#3903: a reused check is marked so `josh lane:stats` never times its zero.
	it('records every check, its verdict and whether it was reused', async () => {
		reads(QUIET_BUSY, QUIET_BUSY)

		const ledger_path = path.join(scratch, 'checks.jsonl')
		const lint = { label: 'lint', command: 'josh lint', exit_code: 1, output: '', elapsed_ms: 5 }
		const check = { ...lint, label: 'check', exit_code: 0, elapsed_ms: 0, reused_at: 'then' }

		await gate_ledger.record(await gate_ledger.start(ledger_path), [lint, check], OUTCOME)

		const [entry] = lane_ledger.read_entries(ledger_path)

		expect(entry?.kind === 'gate' ? entry.checks : undefined).toStrictEqual([
			{ label: 'lint', elapsed_ms: 5, is_passed: false, is_reused: false },
			{ label: 'check', elapsed_ms: 0, is_passed: true, is_reused: true },
		])
	})

	it('reads nothing when no ledger was resolved', async () => {
		await gate_ledger.record(await gate_ledger.start(undefined), [], OUTCOME)

		expect(read_machine).not.toHaveBeenCalled()
		expect(live_reservations).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4362: without each check's CPU, a core weight could not be re-measured.
describe('gate_ledger — each check CPU', () => {
	it('records the CPU a check spent, in whole milliseconds, where the gate read it', async () => {
		reads(QUIET_BUSY, QUIET_BUSY)

		const ledger_path = path.join(scratch, 'cpu.jsonl')
		const lint = { label: 'lint', command: 'josh lint', exit_code: 0, output: '', elapsed_ms: 5 }
		const measured = { ...lint, cpu_ms: CHECK_CPU_MS }
		const unread = { ...lint, label: 'check', cpu_ms: undefined }

		await gate_ledger.record(await gate_ledger.start(ledger_path), [measured, unread], OUTCOME)

		const [entry] = lane_ledger.read_entries(ledger_path)

		expect(entry?.kind === 'gate' ? entry.checks : undefined).toStrictEqual([
			{
				label: 'lint',
				elapsed_ms: 5,
				is_passed: true,
				is_reused: false,
				cpu_ms: CHECK_CPU_ROUNDED,
			},
			{ label: 'check', elapsed_ms: 5, is_passed: true, is_reused: false },
		])
	})

	// joshuafolkken/kit#4451: the unit claim's asked and granted width and its wait, per run.
	it('records the core-budget claim a check ran under, and none for one that claimed none', async () => {
		reads(QUIET_BUSY, QUIET_BUSY)

		const ledger_path = path.join(scratch, 'claim.jsonl')
		const claim = { requested: 7, granted: 3, waited_ms: 120_000 }
		const lint = { label: 'lint', command: 'josh lint', exit_code: 0, output: '', elapsed_ms: 5 }

		await gate_ledger.record(
			await gate_ledger.start(ledger_path),
			[{ ...lint, claim }, lint],
			OUTCOME,
		)

		const [entry] = lane_ledger.read_entries(ledger_path)

		expect(entry).toMatchObject({ checks: [{ claim }, { label: 'lint' }] })
		expect(entry?.kind === 'gate' ? entry.checks?.[1] : undefined).not.toHaveProperty('claim')
	})
})

// joshuafolkken/kit#4397: a whole-gate reuse and the unit leg's full-suite fallback both reach the ledger.
describe('gate_ledger — the reuses and the fallbacks', () => {
	it('records the reason kind the unit leg fell back to the whole suite for', async () => {
		reads(QUIET_BUSY, QUIET_BUSY)

		const ledger_path = path.join(scratch, 'fallback.jsonl')
		const scope = { mode: 'all' as const, files: [], reason: related_scope.UNREADABLE_REASON }
		const output = related_scope.describe_scope(scope, scratch)
		const unit = {
			label: gate_plan.UNIT_LABEL,
			command: 'josh test:related',
			exit_code: 0,
			output,
			elapsed_ms: 9,
		}

		await gate_ledger.record(await gate_ledger.start(ledger_path), [unit], OUTCOME)

		const [entry] = lane_ledger.read_entries(ledger_path)

		expect(entry?.kind === 'gate' ? entry.checks : undefined).toMatchObject([
			{ label: gate_plan.UNIT_LABEL, fallback: 'unreadable' },
		])
	})

	it('records a reused whole gate as a passed, reused line with no checks', async () => {
		const ledger_path = path.join(scratch, 'reused.jsonl')

		await gate_ledger.record_reused(ledger_path, OUTCOME.elapsed_ms)

		expect(lane_ledger.read_entries(ledger_path)).toMatchObject([
			{ kind: 'gate', elapsed_ms: OUTCOME.elapsed_ms, is_passed: true, is_reused: true },
		])
	})

	it('writes no reused line when no ledger was resolved', async () => {
		const record_gate = vi.spyOn(lane_ledger, 'record_gate')

		await gate_ledger.record_reused(undefined, OUTCOME.elapsed_ms)

		expect(record_gate).not.toHaveBeenCalled()
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
