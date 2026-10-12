import type { CarryRead, RunCarry } from '#scripts/run/carry/run-carry'
import { describe, expect, it, vi } from 'vitest'
import { backlogrun_stop, type StopPorts, type StopReport } from './backlogrun-stop'

// joshuafolkken/kit#3708: `josh backlogrun --stop` stops the supervisor, the parent it launched and the
// run's record in that order, and leaves alone what it did not start.

const GIT_DIRECTORY = '/repo/.git'
const SUPERVISOR_PID = 4242
const PARENT_PID = 42
const SESSION_PID = 777
const WOKEN_PID = 555
const NONE: CarryRead = { kind: 'none' }
const UNREADABLE: CarryRead = { kind: 'unreadable' }
const CARRY: RunCarry = {
	invocation: 'backlogrun',
	started_at: '2026-10-12T09:00:00.000Z',
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}

interface Stage {
	supervisor?: number
	woke_pid?: number
	parent?: number
	read?: CarryRead
	live?: ReadonlyArray<number>
	lanes?: Array<string>
}

function carried(owner_pid?: number): CarryRead {
	return { kind: 'carried', carry: { ...CARRY, owner_pid } }
}

function harness(stage: Stage = {}): { ports: StopPorts; calls: Array<string> } {
	const calls: Array<string> = []
	const read = stage.read ?? NONE
	const ports: StopPorts = {
		stop_supervisor: vi.fn(() => {
			calls.push('supervisor')

			if (stage.supervisor === undefined) return undefined

			return { pid: stage.supervisor, woke_pid: stage.woke_pid }
		}),
		stop_session: vi.fn(() => {
			calls.push('session')
		}),
		stop_parent: vi.fn(() => {
			calls.push('parent')

			return stage.parent
		}),
		read_carry: vi.fn(() => read),
		is_live: vi.fn((pid: number) => (stage.live ?? []).includes(pid)),
		end_record: vi.fn(async () => {
			calls.push('record')

			return read
		}),
		lanes: vi.fn(async () => stage.lanes ?? []),
	}

	return { ports, calls }
}

async function stop(stage: Stage = {}): Promise<StopReport> {
	return await backlogrun_stop.stop(GIT_DIRECTORY, harness(stage).ports)
}

describe('backlogrun_stop.stop — a run that is going', () => {
	it('stops the supervisor, then the parent, then the record', async () => {
		const { ports, calls } = harness({
			supervisor: SUPERVISOR_PID,
			parent: PARENT_PID,
			read: carried(PARENT_PID),
			live: [PARENT_PID],
		})

		await expect(backlogrun_stop.stop(GIT_DIRECTORY, ports)).resolves.toStrictEqual({
			supervisor: SUPERVISOR_PID,
			parent: PARENT_PID,
			session: undefined,
			record: { kind: 'ended' },
			lanes: [],
		})
		expect(calls).toStrictEqual(['supervisor', 'parent', 'record'])
		expect(ports.end_record).toHaveBeenCalledExactlyOnceWith(GIT_DIRECTORY)
	})

	it('ends a record the supervisor’s own driver owns, still dying from its signal', async () => {
		const report = await stop({
			supervisor: SUPERVISOR_PID,
			read: carried(SUPERVISOR_PID),
			live: [SUPERVISOR_PID],
		})

		expect(report.record).toStrictEqual({ kind: 'ended' })
	})

	it('stops a parent that has not claimed a record yet, with no record to end', async () => {
		const { ports, calls } = harness({ parent: PARENT_PID })

		await expect(backlogrun_stop.stop(GIT_DIRECTORY, ports)).resolves.toMatchObject({
			parent: PARENT_PID,
			record: { kind: 'none' },
		})
		expect(calls).toStrictEqual(['supervisor', 'parent'])
	})
})

describe('backlogrun_stop.stop — a record left behind', () => {
	it.each([
		{ name: 'whose owner is gone', read: carried(SESSION_PID) },
		{ name: 'that names no owner', read: carried() },
		{ name: 'that cannot be read', read: UNREADABLE },
	])('ends a record $name', async ({ read }) => {
		const report = await stop({ read })

		expect(report).toMatchObject({ supervisor: undefined, parent: undefined })
		expect(report.record).toStrictEqual({ kind: 'ended' })
	})

	it('keeps a record a session it did not start still owns, and names the owner', async () => {
		const { ports } = harness({
			supervisor: SUPERVISOR_PID,
			read: carried(SESSION_PID),
			live: [SESSION_PID],
		})
		const report = await backlogrun_stop.stop(GIT_DIRECTORY, ports)

		expect(report.record).toStrictEqual({ kind: 'held', owner: SESSION_PID })
		expect(ports.end_record).not.toHaveBeenCalled()
		expect(backlogrun_stop.is_stopped(report)).toBe(false)
	})
})

const WOKEN: Stage = { supervisor: SUPERVISOR_PID, woke_pid: WOKEN_PID }

describe('backlogrun_stop.stop — a session the supervisor woke', () => {
	it('stops the woken session that owns the record, then ends the record', async () => {
		const { ports, calls } = harness({ ...WOKEN, read: carried(WOKEN_PID), live: [WOKEN_PID] })
		const report = await backlogrun_stop.stop(GIT_DIRECTORY, ports)

		expect(report).toMatchObject({ session: WOKEN_PID, record: { kind: 'ended' } })
		expect(calls).toStrictEqual(['supervisor', 'parent', 'session', 'record'])
		expect(ports.stop_session).toHaveBeenCalledExactlyOnceWith(WOKEN_PID)
		expect(backlogrun_stop.is_stopped(report)).toBe(true)
	})

	it('does not signal a woken session that no longer owns the record', async () => {
		const { ports } = harness({
			...WOKEN,
			read: carried(SUPERVISOR_PID),
			live: [SUPERVISOR_PID, WOKEN_PID],
		})
		const report = await backlogrun_stop.stop(GIT_DIRECTORY, ports)

		expect(report).toMatchObject({ session: undefined, record: { kind: 'ended' } })
		expect(ports.stop_session).not.toHaveBeenCalled()
	})

	it('still keeps a record another session owns beside a woken one', async () => {
		const { ports } = harness({
			...WOKEN,
			read: carried(SESSION_PID),
			live: [SESSION_PID, WOKEN_PID],
		})
		const report = await backlogrun_stop.stop(GIT_DIRECTORY, ports)

		expect(report.record).toStrictEqual({ kind: 'held', owner: SESSION_PID })
		expect(ports.stop_session).not.toHaveBeenCalled()
	})
})

describe('backlogrun_stop.stop — nothing running, and lanes', () => {
	it('stops nothing and ends nothing where nothing is running', async () => {
		const { ports } = harness()
		const report = await backlogrun_stop.stop(GIT_DIRECTORY, ports)

		expect(report).toStrictEqual({
			supervisor: undefined,
			parent: undefined,
			session: undefined,
			record: { kind: 'none' },
			lanes: [],
		})
		expect(ports.end_record).not.toHaveBeenCalled()
		expect(backlogrun_stop.is_stopped(report)).toBe(true)
	})

	it('hands back the lanes still running without stopping them', async () => {
		const report = await stop({ read: carried(), lanes: ['3701', '3702'] })

		expect(report.lanes).toStrictEqual(['3701', '3702'])
	})
})

const NOTHING: StopReport = {
	supervisor: undefined,
	parent: undefined,
	session: undefined,
	record: { kind: 'none' },
	lanes: [],
}

describe('backlogrun_stop.lines_of', () => {
	it('says one line where nothing was running', () => {
		expect(backlogrun_stop.lines_of(NOTHING)).toStrictEqual(['backlogrun: nothing is running'])
	})

	it('says each thing it stopped, in the order it stopped them', () => {
		const report = {
			...NOTHING,
			supervisor: SUPERVISOR_PID,
			parent: PARENT_PID,
			session: WOKEN_PID,
			record: { kind: 'ended' as const },
		}

		expect(backlogrun_stop.lines_of(report)).toStrictEqual([
			'backlogrun: stopped the supervisor (process 4242)',
			'backlogrun: stopped the parent session (process 42)',
			'backlogrun: stopped the session the supervisor woke (process 555)',
			"backlogrun: ended the run's record",
		])
	})

	it('names the owner of a record it kept', () => {
		const report = { ...NOTHING, record: { kind: 'held' as const, owner: SESSION_PID } }

		expect(backlogrun_stop.lines_of(report)).toStrictEqual([
			'backlogrun: process 777 owns the run and was not started by `josh backlogrun`; its record is kept — end the run from that session',
		])
	})

	it('counts and names the lanes it left running', () => {
		const report = { ...NOTHING, record: { kind: 'ended' as const }, lanes: ['3701', '3702'] }

		expect(backlogrun_stop.lines_of(report).at(-1)).toBe(
			'backlogrun: 2 lane(s) still running, not stopped: #3701 #3702',
		)
	})
})
