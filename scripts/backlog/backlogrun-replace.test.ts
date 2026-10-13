import type { CarryRead, RunCarry } from '#scripts/run/carry/run-carry'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { backlogrun_replace, type ReplacePorts, type ReplaceVerdict } from './backlogrun-replace'

// joshuafolkken/kit#3729: an idle run gives way to a different invocation — and only an idle one.
// joshuafolkken/kit#3733: a run that is kept says which condition kept it.

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
const REPLACE: ReplaceVerdict = { kind: 'replace' }
const UNREADABLE = "the run's record could not be read"
const STARTING = 'the run is still starting: it has not written its record yet'
const NOT_WATCHING = 'the run is not watching: it is still starting or has a child at work'

interface Stage {
	read?: CarryRead
	events?: ReadonlyArray<RunEvent>
	is_retrospective_owed?: boolean
	lanes?: ReadonlyArray<string>
	unread?: ReadonlyArray<string>
	pending?: string
}

function ports_of(stage: Stage = {}): ReplacePorts {
	return {
		read_carry: () => stage.read ?? CARRIED,
		events: () => stage.events ?? DRAINED,
		is_retrospective_owed: () => stage.is_retrospective_owed ?? false,
		pending_invocation: () => stage.pending,
		lanes: async () => ({ working: [...(stage.lanes ?? [])], unread: [...(stage.unread ?? [])] }),
	}
}

function launch_at(at: string): RunEvent {
	return { pos: 1, at, kind: 'child-launch', text: '#3701' }
}

function keep(reason: string): ReplaceVerdict {
	return { kind: 'keep', reason }
}

async function answer(stage: Stage = {}, invocation: string = TYPED): Promise<ReplaceVerdict> {
	return await backlogrun_replace.decide(invocation, GIT_DIRECTORY, ports_of(stage))
}

describe('backlogrun_replace.decide', () => {
	it('replaces a drained run with no lane in use when the invocation differs', async () => {
		await expect(answer()).resolves.toStrictEqual(REPLACE)
	})

	it('answers same for the invocation the run was typed with, bare over bare included', async () => {
		await expect(answer({}, 'backlogrun')).resolves.toStrictEqual({ kind: 'same' })
	})

	it('answers same without a reason even where another condition would keep the run', async () => {
		const stage = { is_retrospective_owed: true, lanes: ['3701'], events: [] }

		await expect(answer(stage, 'backlogrun')).resolves.toStrictEqual({ kind: 'same' })
	})

	it('keeps a run with a child at work in a lane, naming the lane and the way out', async () => {
		await expect(answer({ lanes: ['3701', '3702'] })).resolves.toStrictEqual(
			keep(
				'a child is still working in the lane for #3701 #3702 (`pnpm josh lane:close <N>` discards a lane)',
			),
		)
	})

	it('says a probe that did not answer apart from a child seen working', async () => {
		await expect(answer({ lanes: ['3701'], unread: ['3702'] })).resolves.toStrictEqual(
			keep(
				'a child is still working in the lane for #3701; whether a child is working could not be read in the lane for #3702 (`pnpm josh lane:close <N>` discards a lane)',
			),
		)
		await expect(answer({ unread: ['3702'] })).resolves.toStrictEqual(
			keep(
				'whether a child is working could not be read in the lane for #3702 (`pnpm josh lane:close <N>` discards a lane)',
			),
		)
	})

	it('keeps a run whose record could not be read', async () => {
		await expect(answer({ read: { kind: 'unreadable' } })).resolves.toStrictEqual(keep(UNREADABLE))
	})
})

describe('backlogrun_replace.decide on a launch its parent has not claimed yet', () => {
	const NONE: CarryRead = { kind: 'none' }

	it('answers same without a reason when the launch was typed with this invocation', async () => {
		await expect(answer({ read: NONE, pending: TYPED })).resolves.toStrictEqual({ kind: 'same' })
	})

	it('keeps a launch typed with another invocation as still starting, not unreadable', async () => {
		await expect(answer({ read: NONE, pending: 'backlogrun' })).resolves.toStrictEqual(
			keep(STARTING),
		)
	})

	it('keeps a launch whose record names no invocation', async () => {
		await expect(answer({ read: NONE })).resolves.toStrictEqual(keep(STARTING))
	})
})

describe('backlogrun_replace.decide watching', () => {
	it('keeps a run that has not drained yet', async () => {
		const starting = [{ pos: 1, at: AFTER, kind: 'setup', text: 'starting session' }]

		await expect(answer({ events: starting })).resolves.toStrictEqual(keep(NOT_WATCHING))
		await expect(answer({ events: [] })).resolves.toStrictEqual(keep(NOT_WATCHING))
	})

	it('keeps a run whose only drain is an earlier invocation’s', async () => {
		const stale = [{ pos: 1, at: BEFORE, kind: 'drain', text: 'drained' }]

		await expect(answer({ events: stale })).resolves.toStrictEqual(keep(NOT_WATCHING))
	})

	it('keeps a run that launched a child after its drain', async () => {
		const woken = [...DRAINED, launch_at(LATER)]

		await expect(answer({ events: woken })).resolves.toStrictEqual(keep(NOT_WATCHING))
	})

	it('replaces a run that drained again after its last child', async () => {
		const drained = { pos: 2, at: LATER, kind: 'drain', text: 'drained' }

		await expect(answer({ events: [launch_at(AFTER), drained] })).resolves.toStrictEqual(REPLACE)
	})

	it('keeps a drained run that still owes its retrospective', async () => {
		await expect(answer({ is_retrospective_owed: true })).resolves.toStrictEqual(
			keep('the run still owes its retrospective'),
		)
	})

	it('keeps a run whose start time cannot be read', async () => {
		const read: CarryRead = { kind: 'carried', carry: { ...CARRY, started_at: 'not a time' } }

		await expect(answer({ read })).resolves.toStrictEqual(keep(UNREADABLE))
	})
})
