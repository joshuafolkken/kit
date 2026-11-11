import path from 'node:path'
import {
	backlog_drive,
	type LoopPorts as DrivePorts,
	type DriveState,
	type OfferRead,
} from '#scripts/backlog/backlog-drive'
import type { CarryRead } from '#scripts/run/carry/run-carry'
import { temporary_directory } from '#tools/test/temporary-directory'
import { expect, test } from 'vitest'
import { run_wake } from './run-wake'
import { run_wake_loop, type LoopPorts } from './run-wake-loop'

const make_directory = temporary_directory()

const NOW = new Date('2026-09-24T00:00:00.000Z')
const ISSUE = '1'
const INVOCATION = 'backlogrun --idle 0'
const HANDED_OFF: CarryRead = {
	kind: 'carried',
	carry: {
		invocation: INVOCATION,
		started_at: NOW.toISOString(),
		merged: 0,
		filed: 0,
		cuts: 1,
		failures: 0,
		outages: 0,
		is_handed_off: true,
	},
}
const NO_WINDOW = { poll_ms: 0, offer_ms: 0, idle_offer_ms: 0, check_ms: 0, window_ms: undefined }
const FREE_LANES = 6

interface World {
	started: boolean
	merged: boolean
	agents: number
	reports: number
}

function offered(world: World, state: DriveState): OfferRead {
	return {
		verdict: world.merged ? 'stop' : 'run',
		issues: world.merged || state.in_flight.length > 0 ? [] : [ISSUE],
		retries: 0,
		is_finish: true,
	}
}

// The run's own records: nothing added, raised, named or listed.
const NO_RECORD: Pick<
	DrivePorts,
	'begin_tick' | 'added_since' | 'raised_since' | 'named_left' | 'listing_changed'
> = {
	begin_tick: async () => undefined,
	added_since: async () => false,
	raised_since: async () => false,
	named_left: async () => false,
	listing_changed: async () => false,
}

function drive_ports(world: World): DrivePorts {
	return {
		is_finished: () => world.started,
		adoptable: async () => [],
		merge: async () => {
			world.merged = true

			return { token: 'none', outcome: 'merged', is_offer: true }
		},
		offer: async (state: DriveState) => offered(world, state),
		launch: async () => {
			world.started = true

			return 'launched'
		},
		free_lanes: async () => FREE_LANES,
		limit_room: async () => FREE_LANES,
		has_lane: async () => false,
		judgement_owed: async () => 0,
		memory_held: async () => false,
		usage_limited: async () => false,
		yields: async () => [],
		park: async () => undefined,
		stall: async () => undefined,
		hold: async () => undefined,
		idle: async () => undefined,
		paused: async () => undefined,
		retrospective: async () => true,
		now: () => NOW,
		sleep: async () => undefined,
		...NO_RECORD,
		on_state: () => undefined,
		finish: async () => {
			world.reports += 1
		},
	}
}

function wake_ports(world: World): LoopPorts {
	return {
		read_carry: () => HANDED_OFF,
		is_owner_live: () => false,
		has_work: async () => true,
		new_session_id: () => 'session',
		hand_off: () => undefined,
		drive: async () => {
			await backlog_drive.run_loop(
				backlog_drive.initial_state([], NOW.toISOString()),
				NO_WINDOW,
				drive_ports(world),
			)

			return { kind: 'finished' }
		},
		wake: () => {
			world.agents += 1

			return { kind: 'launched', pid: 1 }
		},
		wake_beside: () => {
			world.agents += 1

			return { kind: 'launched', pid: 1 }
		},
		sleep: async () => undefined,
		now: () => NOW,
		retry_closes: async () => undefined,
		is_code_stale: async () => false,
	}
}

test('runs a no-judgment backlog to completion without a parent agent', async () => {
	const directory = make_directory('josh-drive-harness-')
	const target = path.join(directory, 'wake.json')
	const world: World = { started: false, merged: false, agents: 0, reports: 0 }

	run_wake.write_wake(target, run_wake.fresh_wake(INVOCATION, NOW))

	const stop = await run_wake_loop.run_loop(target, wake_ports(world), 0)

	expect(stop.reason).toBe('ended')
	expect(world).toStrictEqual({ started: true, merged: true, agents: 0, reports: 1 })
})
