import type { CarryRead, RunCarry } from '#scripts/run/carry/run-carry'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { backlogrun_replace, type ReplacePorts } from './backlogrun-replace'

// joshuafolkken/kit#3729: an idle run gives way to a different invocation — and only an idle one.

const GIT_DIRECTORY = '/repo/.git'
const TYPED = 'backlogrun #3724 --only'
const STARTED_AT = '2026-10-12T09:00:00.000Z'
const BEFORE = '2026-10-12T08:00:00.000Z'
const AFTER = '2026-10-12T10:00:00.000Z'
const LATER = '2026-10-12T11:00:00.000Z'
const CARRY: RunCarry = {
	invocation: 'backlogrun',
	started_at: STARTED_AT,
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}
const CARRIED: CarryRead = { kind: 'carried', carry: CARRY }
const DRAINED: ReadonlyArray<RunEvent> = [{ pos: 1, at: AFTER, kind: 'drain', text: 'drained' }]

interface Stage {
	read?: CarryRead
	events?: ReadonlyArray<RunEvent>
	is_retrospective_owed?: boolean
	lanes?: ReadonlyArray<string>
}

function ports_of(stage: Stage = {}): ReplacePorts {
	return {
		read_carry: () => stage.read ?? CARRIED,
		events: () => stage.events ?? DRAINED,
		is_retrospective_owed: () => stage.is_retrospective_owed ?? false,
		lanes: async () => stage.lanes ?? [],
	}
}

function launch_at(at: string): RunEvent {
	return { pos: 1, at, kind: 'child-launch', text: '#3701' }
}

async function answer(stage: Stage = {}, invocation: string = TYPED): Promise<boolean> {
	return await backlogrun_replace.is_replaceable(invocation, GIT_DIRECTORY, ports_of(stage))
}

describe('backlogrun_replace.is_replaceable', () => {
	it('replaces a drained run with no lane open when the invocation differs', async () => {
		await expect(answer()).resolves.toBe(true)
	})

	it('keeps a run typed with the same invocation, bare over bare included', async () => {
		await expect(answer({}, 'backlogrun')).resolves.toBe(false)
	})

	it('keeps a run with a lane open', async () => {
		await expect(answer({ lanes: ['3701'] })).resolves.toBe(false)
	})

	it('keeps a launch its parent has not claimed yet', async () => {
		await expect(answer({ read: { kind: 'none' } })).resolves.toBe(false)
		await expect(answer({ read: { kind: 'unreadable' } })).resolves.toBe(false)
	})
})

describe('backlogrun_replace.is_replaceable watching', () => {
	it('keeps a run that has not drained yet', async () => {
		const starting = [{ pos: 1, at: AFTER, kind: 'setup', text: 'starting session' }]

		await expect(answer({ events: starting })).resolves.toBe(false)
		await expect(answer({ events: [] })).resolves.toBe(false)
	})

	it('keeps a run whose only drain is an earlier invocation’s', async () => {
		const stale = [{ pos: 1, at: BEFORE, kind: 'drain', text: 'drained' }]

		await expect(answer({ events: stale })).resolves.toBe(false)
	})

	it('keeps a run that launched a child after its drain', async () => {
		const woken = [...DRAINED, launch_at(LATER)]

		await expect(answer({ events: woken })).resolves.toBe(false)
	})

	it('replaces a run that drained again after its last child', async () => {
		const drained = { pos: 2, at: LATER, kind: 'drain', text: 'drained' }

		await expect(answer({ events: [launch_at(AFTER), drained] })).resolves.toBe(true)
	})

	it('keeps a drained run that still owes its retrospective', async () => {
		await expect(answer({ is_retrospective_owed: true })).resolves.toBe(false)
	})

	it('keeps a run whose start time cannot be read', async () => {
		const read: CarryRead = { kind: 'carried', carry: { ...CARRY, started_at: 'not a time' } }

		await expect(answer({ read })).resolves.toBe(false)
	})
})
