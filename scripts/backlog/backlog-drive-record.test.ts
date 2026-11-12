import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_carry_added } from '#scripts/run/carry/run-carry-added'
import { run_stalled_park } from '#scripts/run/park/run-stalled-park'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backlog_arrival_added } from './backlog-arrival-added'
import { backlog_drive_record } from './backlog-drive-record'

// joshuafolkken/kit#6788: the two answers the ask interval takes from the run's own record.

const make_directory = temporary_directory()
const SINCE_MS = Date.parse('2026-11-08T14:04:18Z')
const ISSUE = '6878'

afterEach(() => {
	vi.restoreAllMocks()
})

function carried(invocation: string): { target: string; carry: RunCarry | undefined } {
	const directory = make_directory('josh-drive-record-')
	const target = run_carry.carry_path(directory)

	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(directory)

	return { target, carry: run_carry.begin_carry(target, invocation) }
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

	// joshuafolkken/kit#6839: the roots `run:add` gave a pool run hold its drain until they are done.
	it('answers true for a run that names no issue while a root run:add gave it is left', async () => {
		const { target, carry } = carried('backlogrun')

		if (carry === undefined) throw new Error('the scratch record was not created')
		run_carry_added.add_issues(target, carry, [{ issue: 6839, is_priority: false }])

		await expect(backlog_drive_record.record_ports().named_left()).resolves.toBe(true)
	})

	it('answers false outside a repository', async () => {
		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(undefined)

		await expect(backlog_drive_record.record_ports().named_left()).resolves.toBe(false)
	})
})

// joshuafolkken/kit#7016: both questions ask through the tick's one shared stream read.
async function shared_read(): Promise<[]> {
	return []
}

describe('backlog_drive_record.record_ports — added_since', () => {
	it('asks the event stream since the given instant through the shared read', async () => {
		const added = vi.spyOn(backlog_arrival_added, 'is_added_since').mockResolvedValue(true)
		const ports = backlog_drive_record.record_ports(shared_read)

		await expect(ports.added_since(SINCE_MS)).resolves.toBe(true)
		expect(added).toHaveBeenCalledWith(SINCE_MS, shared_read)
	})
})

describe('backlog_drive_record.record_ports — raised_since', () => {
	it('asks the event stream for a lane:limit raise through the shared read', async () => {
		const raised = vi.spyOn(backlog_arrival_added, 'is_raised_since').mockResolvedValue(true)
		const ports = backlog_drive_record.record_ports(shared_read)

		await expect(ports.raised_since(SINCE_MS)).resolves.toBe(true)
		expect(raised).toHaveBeenCalledWith(SINCE_MS, shared_read)
	})
})

// joshuafolkken/kit#6878: a refused launch is parked `run:stalled`, its cause the launch's answer.
describe('backlog_drive_record.record_ports — stall', () => {
	it('parks the issue run:stalled under the launch outcome with the retry as next step', async () => {
		const apply = vi.spyOn(run_stalled_park, 'apply').mockResolvedValue(true)

		await backlog_drive_record.record_ports().stall(ISSUE, 'unopened')

		expect(apply).toHaveBeenCalledWith(
			ISSUE,
			expect.stringContaining(`pnpm josh run:add ${ISSUE} --retry`),
			'launch unopened',
		)
	})
})
