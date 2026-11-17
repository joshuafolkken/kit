import type { EstimateRecord } from '#scripts/lane/lane-ledger-schema-estimate'
import { describe, expect, it, vi } from 'vitest'
import { run_board_estimate_record, type Estimate } from './run-board-estimate-record'

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
