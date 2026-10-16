import { randomUUID } from 'node:crypto'
import { stamp_file } from '#scripts/josh/stamp-file'
import { describe, expect, it } from 'vitest'
import { run_ship_detach } from './run-ship-detach'

// joshuafolkken/kit#3901: two overlapping ships are ordered by when each was launched, so only the
// launch time of a ship still running is read — a stopped one orders nothing.

const NUMBER = '3901'
const CLAIM_WINDOW_MS = 120_000

function write_launch(launched_at: number): string {
	const repository = `/tmp/josh-ship-running-since-test-${randomUUID()}`

	stamp_file.replace_stamp(stamp_file.stamp_path(`josh-ship-result-${NUMBER}-`, repository), {
		pid: process.pid,
		launch_id: 'bare',
		launched_at,
	})

	return repository
}

describe('run_ship_detach.running_since', () => {
	it('reads the launch time of a running ship', () => {
		const launched_at = Date.now()

		expect(run_ship_detach.running_since(write_launch(launched_at), NUMBER)).toBe(launched_at)
	})

	it('reads a ship that is no longer running as having no launch time', () => {
		const repository = write_launch(Date.now() - CLAIM_WINDOW_MS - 1)

		expect(run_ship_detach.running_since(repository, NUMBER)).toBeUndefined()
	})

	it('reads an issue with no ship record as having no launch time', () => {
		expect(run_ship_detach.running_since(`/tmp/${randomUUID()}`, NUMBER)).toBeUndefined()
	})
})
