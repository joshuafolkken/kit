import { randomUUID } from 'node:crypto'
import { durable_state } from '#scripts/josh/durable-state'
import { stamp_file } from '#scripts/josh/stamp-file'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_ship_detach } from './run-ship-detach'

// joshuafolkken/kit#4245: a reader holding a process snapshot answers the recorded start times itself,
// so reading a ship record starts no `ps`.

const NUMBER = '4245'
const RECORDED_START = 'Tue Oct 20 08:39:04 2026'
const REUSED_START = 'Tue Oct 20 09:00:00 2026'

function record_live_ship(): string {
	const repository = `/tmp/josh-ship-detach-reader-test-${randomUUID()}`

	const result = durable_state.path(`${durable_state.PREFIX.SHIP_RESULT}${NUMBER}-`, repository)

	stamp_file.replace_stamp(result, {
		pid: process.pid,
		process_start: RECORDED_START,
		launch_id: 'live',
	})

	return repository
}

describe('run_ship_detach.read_result with a start reader', () => {
	afterEach(() => vi.restoreAllMocks())

	it.each([
		['matches', RECORDED_START, 'running'],
		['differs', REUSED_START, 'abnormal'],
	])(
		'compares the recorded start through the reader given, where it %s',
		(_name, observed, result) => {
			const read = vi.fn(() => observed)

			expect(run_ship_detach.read_result(record_live_ship(), NUMBER, read)?.result).toBe(result)
			expect(read).toHaveBeenCalledWith(process.pid)
		},
	)

	it.each([
		['EPERM', RECORDED_START, 'running'],
		['EPERM', undefined, 'running'],
		['EPERM', REUSED_START, 'abnormal'],
		['ESRCH', RECORDED_START, 'abnormal'],
	])('handles signal refusal %s with observed identity %s as %s', (code, observed, result) => {
		const repository = record_live_ship()

		vi.spyOn(process, 'kill').mockImplementation(() => {
			throw Object.assign(new Error('signal refused'), { code })
		})

		expect(run_ship_detach.read_result(repository, NUMBER, () => observed)?.result).toBe(result)
	})
})
