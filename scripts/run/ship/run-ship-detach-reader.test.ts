import { randomUUID } from 'node:crypto'
import { stamp_file } from '#scripts/josh/stamp-file'
import { describe, expect, it, vi } from 'vitest'
import { run_ship_detach } from './run-ship-detach'

// joshuafolkken/kit#4245: a reader holding a process snapshot answers the recorded start times itself,
// so reading a ship record starts no `ps`.

const NUMBER = '4245'
const RECORDED_START = 'Tue Oct 20 08:39:04 2026'

function record_live_ship(): string {
	const repository = `/tmp/josh-ship-detach-reader-test-${randomUUID()}`

	stamp_file.replace_stamp(stamp_file.stamp_path(`josh-ship-result-${NUMBER}-`, repository), {
		pid: process.pid,
		process_start: RECORDED_START,
		launch_id: 'live',
	})

	return repository
}

describe('run_ship_detach.read_result with a start reader', () => {
	it.each([
		['matches', RECORDED_START, 'running'],
		['differs', 'Tue Oct 20 09:00:00 2026', 'abnormal'],
	])(
		'compares the recorded start through the reader given, where it %s',
		(_name, observed, result) => {
			const read = vi.fn(() => observed)

			expect(run_ship_detach.read_result(record_live_ship(), NUMBER, read)?.result).toBe(result)
			expect(read).toHaveBeenCalledWith(process.pid)
		},
	)
})
