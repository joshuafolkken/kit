import { run_carry } from '#scripts/run/carry/run-carry'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backlog_arrival_added } from './backlog-arrival-added'
import { backlog_drive_record } from './backlog-drive-record'

// joshuafolkken/kit#6788: the two answers the ask interval takes from the run's own record.

const make_directory = temporary_directory()
const SINCE_MS = Date.parse('2026-11-08T14:04:18Z')

afterEach(() => {
	vi.restoreAllMocks()
})

function carried(invocation: string): void {
	const directory = make_directory('josh-drive-record-')

	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(directory)
	run_carry.begin_carry(run_carry.carry_path(directory), invocation)
}

describe('backlog_drive_record.record_ports — named_left', () => {
	it('answers true while a named issue is left', async () => {
		carried('backlogrun #6707 --only')

		await expect(backlog_drive_record.record_ports().named_left()).resolves.toBe(true)
	})

	it('answers false for a run that names no issue', async () => {
		carried('backlogrun')

		await expect(backlog_drive_record.record_ports().named_left()).resolves.toBe(false)
	})

	it('answers false outside a repository', async () => {
		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(undefined)

		await expect(backlog_drive_record.record_ports().named_left()).resolves.toBe(false)
	})
})

describe('backlog_drive_record.record_ports — added_since', () => {
	it('asks the event stream since the given instant', async () => {
		const added = vi.spyOn(backlog_arrival_added, 'is_added_since').mockResolvedValue(true)

		await expect(backlog_drive_record.record_ports().added_since(SINCE_MS)).resolves.toBe(true)
		expect(added).toHaveBeenCalledWith(SINCE_MS)
	})
})
