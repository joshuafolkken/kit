import type { MachineSample } from '#scripts/gate/machine-capacity'
import type { ProcessTable, TableRead } from '#scripts/lane/lane-process-table'
import { describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_gather, type GatherPorts } from './run-board-gather'
import type { Quotas } from './run-board-quota-read'
import type { LocalRead } from './run-board-read'

// joshuafolkken/kit#7931: the machine and the quotas are read beside the lane read, and the round's
// result and its one process snapshot are what the reads taken one after another gave.

const NOW_MS = 1_000_000
const TABLE: ProcessTable = []
const SAMPLE: MachineSample = {
	cpu: { busy: 0, total: 0 },
	memory: { available_mb: 512, swapped_mb: 0, pressure_level: undefined },
	total_mb: 1024,
}
const QUOTAS: Quotas = { claude: undefined, codex: undefined }

interface Gate {
	ports: GatherPorts
	release: (local: LocalRead | undefined) => void
}

// Ports whose lane read holds until `release`, each read counted.
function gated_ports(): Gate {
	const local: { resolve?: (read: LocalRead | undefined) => void } = {}
	const answered = new Promise<LocalRead | undefined>((resolve) => {
		local.resolve = resolve
	})

	return {
		ports: {
			read_table: vi.fn<TableRead>(async () => TABLE),
			read_local: vi.fn(async (table: TableRead) => {
				await table()

				return await answered
			}),
			read_machine: vi.fn(async () => SAMPLE),
			read_usage: vi.fn<GatherPorts['read_usage']>(async (_before, table) => {
				await table()

				return undefined
			}),
			read_quotas: vi.fn(async () => QUOTAS),
			is_live: true,
			now: () => NOW_MS,
			sleep: vi.fn<GatherPorts['sleep']>(),
		},
		release: (read) => local.resolve?.(read),
	}
}

describe('run_board_gather.gather', () => {
	it('reads the machine and the quotas before the lane read has answered', async () => {
		const { ports, release } = gated_ports()
		const round = run_board_gather.gather(run_board_gather.FRESH_GATHER, ports, 'background')

		await vi.waitFor(() => {
			expect(ports.read_machine).toHaveBeenCalledOnce()
			expect(ports.read_quotas).toHaveBeenCalledOnce()
		})
		expect(ports.read_usage).not.toHaveBeenCalled()

		release(run_board_fixture.LOCAL)
		await round
	})
})

describe('run_board_gather.gather, its result', () => {
	it('gives the round the reads taken one after another gave, off one process snapshot', async () => {
		const { ports, release } = gated_ports()

		release(run_board_fixture.LOCAL)

		const state = await run_board_gather.gather(run_board_gather.FRESH_GATHER, ports, 'background')

		expect(state).toMatchObject({
			local: run_board_fixture.LOCAL,
			read_ms: NOW_MS,
			machine: { sample: SAMPLE, at_ms: NOW_MS },
			quotas: QUOTAS,
			usages: undefined,
			budget_waits: [],
			sampled_ms: NOW_MS,
		})
		expect(ports.read_table).toHaveBeenCalledOnce()
		expect(vi.mocked(ports.read_usage).mock.calls[0]?.[1]).toBe(
			vi.mocked(ports.read_local).mock.calls[0]?.[0],
		)
	})
})

describe('run_board_gather.gather, a round after a sample', () => {
	it('takes no sample before the machine is due again', async () => {
		const { ports, release } = gated_ports()

		release(run_board_fixture.LOCAL)

		const first = await run_board_gather.gather(run_board_gather.FRESH_GATHER, ports, 'background')
		const second = await run_board_gather.gather(first, ports, 'background')

		expect(ports.read_machine).toHaveBeenCalledOnce()
		expect(second.machine).toBe(first.machine)
	})
})
