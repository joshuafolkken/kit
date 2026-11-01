import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_read } from './run-board-read'
import { run_board_read_fixture } from './run-board-read-fixture'
import { run_board_throughput } from './run-board-throughput'

// joshuafolkken/kit#5710: the 📈 throughput rows are derived on the read, off the whole stream — every
// run's — so the redraw thread is handed the rows, never the stream itself.

const { AFTER, ENDED_AT, INSIDE, arrange } = run_board_read_fixture
const ENDED_RUN = {
	invocation: 'backlogrun #3431 --only',
	started_at: '2026-10-08T09:00:00.000Z',
	ended_at: ENDED_AT,
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_read.read_local throughput', () => {
	it('reads the throughput rows off the whole stream, not only the run’s own events', async () => {
		arrange({ kind: 'none' }, ENDED_RUN)
		const rows_of = vi.spyOn(run_board_throughput, 'rows_of').mockReturnValue([])

		await expect(run_board_read.read_local()).resolves.toMatchObject({
			events: [INSIDE],
			throughput: [],
		})
		expect(rows_of).toHaveBeenCalledWith([INSIDE, AFTER], expect.any(Number))
	})
})
