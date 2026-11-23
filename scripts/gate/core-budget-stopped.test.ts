import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { process_identity } from '#scripts/josh/process-identity'
import { process_state } from '#scripts/josh/process-state'
import type { CoreWaitRecord } from '#scripts/lane/lane-ledger-schema'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { core_budget } from './core-budget'
import { free_cores } from './free-cores'

// joshuafolkken/kit#8869: a lane `lane:pause` stopped kept its steps' places in the ledger, so a running
// lane's claim waited 30 s on `cpu-unrelieved` with the CPU idle. A stopped owner's place is not
// counted, its marker stays, and it counts again once the process runs.

const BUDGET = 11
const STOPPED_MARKER = `${core_budget.RESERVED_PREFIX}stopped.json`
const make_directory = temporary_directory()
const children: Array<ChildProcess> = []

function sleeper(): number {
	const child = spawn('/bin/sleep', ['60'], { stdio: 'ignore' })

	children.push(child)
	if (child.pid === undefined) throw new Error('/bin/sleep did not start')

	return child.pid
}

async function stopped_sleeper(): Promise<number> {
	const pid = sleeper()

	process.kill(pid, 'SIGSTOP')
	await vi.waitFor(() => {
		expect(process_state.stopped_pids([pid]).has(pid)).toBe(true)
	})

	return pid
}

// A running place that fills the whole budget, held by `pid`.
function write_full_marker(directory: string, pid: number): string {
	const target = path.join(directory, STOPPED_MARKER)
	const process_start = process_identity.read_start(pid)

	writeFileSync(
		target,
		JSON.stringify({ pid, process_start, weight: BUDGET, claimed_at: 0, admitted_at: 0 }),
	)

	return target
}

async function unread_machine(): Promise<{ busy_cores: undefined; available_mb: undefined }> {
	return { busy_cores: undefined, available_mb: undefined }
}

afterEach(() => {
	for (const child of children.splice(0)) child.kill('SIGKILL')
})

describe('core_budget.counted_reservations — a stopped owner', () => {
	it('leaves out a stopped owner and keeps its marker', async () => {
		const directory = make_directory('josh-core-budget-stopped-')
		const target = write_full_marker(directory, await stopped_sleeper())

		expect(core_budget.counted_reservations(directory)).toStrictEqual([])
		expect(existsSync(target)).toBe(true)
	})

	it('counts the owner again once it runs', async () => {
		const directory = make_directory('josh-core-budget-resumed-')
		const pid = await stopped_sleeper()

		write_full_marker(directory, pid)
		process.kill(pid, 'SIGCONT')
		await vi.waitFor(() => {
			expect(process_state.stopped_pids([pid]).has(pid)).toBe(false)
		})

		expect(core_budget.counted_reservations(directory)).toHaveLength(1)
	})
})

describe('free_cores.read — a stopped owner', () => {
	it("does not mask outside load with a stopped owner's place", async () => {
		const directory = make_directory('josh-free-cores-stopped-')
		const outside_load = 5

		write_full_marker(directory, await stopped_sleeper())
		const free = await free_cores.read({
			available_cores: BUDGET,
			read_machine: async () => ({ busy_cores: outside_load, available_mb: undefined }),
			directory,
		})

		expect(free.cores).toBe(BUDGET - outside_load)
	})
})

describe('core_budget.reserve — a ledger filled by a stopped owner', () => {
	it('admits on budget-fit without waiting and records the reserved cores', async () => {
		const directory = make_directory('josh-core-budget-fit-')
		const records: Array<CoreWaitRecord> = []
		const sleep = vi.fn(async () => {
			throw new Error('a claim with room on the machine must not wait')
		})

		write_full_marker(directory, await stopped_sleeper())
		const handle = await core_budget.reserve(2, {
			directory,
			budget: BUDGET,
			read_machine: unread_machine,
			sleep,
			record_wait: async (record) => {
				records.push(record)
			},
		})

		core_budget.release(handle)

		expect(handle.admission.decision?.reason).toBe('budget-fit')
		expect(records).toStrictEqual([expect.objectContaining({ reserved_cores: 0, waited_ms: 0 })])
	})
})
