import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { gate_ledger } from './gate-ledger'
import { machine_capacity } from './machine-capacity'

// joshuafolkken/kit#3501: a gate records the load it ran beside, read where none of its own checks
// runs, so `josh metrics` can leave out the gates another lane's work slowed.

const scratch = mkdtempSync(path.join(tmpdir(), 'gate-ledger-test-'))
const read_machine = vi.spyOn(machine_capacity, 'read_machine')
const QUIET_BUSY = machine_capacity.BASELINE_CORES
const BUSY_EXTERNAL = 3
const OUTCOME = { elapsed_ms: 1000, is_passed: true }

function reads(...busy_cores: ReadonlyArray<number | undefined>): void {
	for (const busy of busy_cores) {
		read_machine.mockResolvedValueOnce({ busy_cores: busy, available_mb: undefined })
	}
}

async function recorded(name: string): Promise<number | undefined> {
	const ledger_path = path.join(scratch, `${name}.jsonl`)

	await gate_ledger.record(await gate_ledger.start(ledger_path), [], OUTCOME)

	const [entry] = lane_ledger.read_entries(ledger_path)

	return entry?.kind === 'gate' ? entry.external_cores : NaN
}

beforeEach(() => {
	read_machine.mockReset()
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
	})
})
