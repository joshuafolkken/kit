import type { EstimateRecord } from '#scripts/lane/lane-ledger-schema-estimate'
import { describe, expect, it, vi } from 'vitest'
import {
	run_board_estimate_record,
	type Estimate,
	type EstimateReads,
} from './run-board-estimate-record'
import { run_board_fixture } from './run-board-fixture'
import type { LocalRead } from './run-board-read'

const { LOCAL } = run_board_fixture

// joshuafolkken/kit#7775: a dispatch writes the run's finish estimate once, and nothing where none is
// estimated.

const ISSUE = 7775
const RUN = '2026-11-17T00:00:00.000Z'
const NOW = Date.parse('2026-11-17T10:00:00.000Z')
const LEFT_MS = 3_600_000

type Write = ReturnType<typeof vi.fn<(record: EstimateRecord) => Promise<void>>>

function write_of(): Write {
	return vi.fn<(record: EstimateRecord) => Promise<void>>().mockResolvedValue(undefined)
}

function ports_of(estimate: Estimate | undefined): {
	read: () => Promise<Estimate | undefined>
	write: Write
} {
	return { read: async () => await estimate, write: write_of() }
}

async function failed_read(): Promise<Estimate | undefined> {
	throw new Error('gh')
}

type ReadPlan = ReturnType<typeof vi.fn<EstimateReads['read_plan']>>

// The live `left_of` runs against the run's local read and an untitled plan, so the board's layout is
// read for real.
function reads_of(local: LocalRead | undefined): EstimateReads & { read_plan: ReadPlan } {
	const read_plan = vi
		.fn<EstimateReads['read_plan']>()
		.mockResolvedValue(run_board_fixture.plan_titled('estimate'))

	return {
		left_of: run_board_estimate_record.left_of,
		read_local: async () => await local,
		read_plan,
	}
}

describe('run_board_estimate_record.record', () => {
	it('writes one record finishing the estimate after now', async () => {
		vi.spyOn(Date, 'now').mockReturnValue(NOW)
		const ports = ports_of({ run: RUN, left_ms: LEFT_MS })

		await run_board_estimate_record.record(ISSUE, ports)

		expect(ports.write.mock.calls).toEqual([
			[{ issue: ISSUE, run: RUN, finish_at: new Date(NOW + LEFT_MS).toISOString() }],
		])
	})

	it('writes nothing where nothing is estimated', async () => {
		const ports = ports_of({ run: RUN, left_ms: undefined })

		await run_board_estimate_record.record(ISSUE, ports)

		expect(ports.write).not.toHaveBeenCalled()
	})

	it('writes nothing outside a run', async () => {
		const ports = ports_of(undefined)

		await run_board_estimate_record.record(ISSUE, ports)

		expect(ports.write).not.toHaveBeenCalled()
	})

	it('never throws where the read fails', async () => {
		const write = write_of()

		await expect(
			run_board_estimate_record.record(ISSUE, { read: failed_read, write }),
		).resolves.toBeUndefined()
		expect(write).not.toHaveBeenCalled()
	})
})

describe('run_board_estimate_record.read_estimate', () => {
	it('estimates nothing outside a run', async () => {
		const reads = reads_of(undefined)

		await expect(run_board_estimate_record.read_estimate(NOW, reads)).resolves.toBeUndefined()
		expect(reads.read_plan).not.toHaveBeenCalled()
	})

	it('estimates nothing for a run that has ended', async () => {
		const reads = reads_of({ ...LOCAL, ended_ms: LOCAL.started_ms + LEFT_MS })

		await expect(run_board_estimate_record.read_estimate(NOW, reads)).resolves.toBeUndefined()
		expect(reads.read_plan).not.toHaveBeenCalled()
	})

	it('names a live run by its start and reads the board for what is left', async () => {
		const reads = reads_of(LOCAL)
		const estimate = await run_board_estimate_record.read_estimate(LOCAL.started_ms, reads)

		expect(estimate).toEqual({
			run: new Date(LOCAL.started_ms).toISOString(),
			left_ms: undefined,
		})
		expect(reads.read_plan).toHaveBeenCalledExactlyOnceWith(LOCAL.scope)
	})
})
