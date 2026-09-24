import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
	backlog_drive,
	type LoopPorts as DrivePorts,
	type DriveState,
} from '#scripts/backlog/backlog-drive'
import { expect, test } from 'vitest'
import type { CarryRead } from './run-carry'
import { run_wake } from './run-wake'
import { run_wake_loop, type LoopPorts } from './run-wake-loop'

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
const NO_WINDOW = { poll_ms: 0, offer_ms: 0, window_ms: undefined }

interface World {
	started: boolean
	merged: boolean
	agents: number
	reports: number
}

function drive_ports(world: World): DrivePorts {
	return {
		is_finished: () => world.started,
		merge: async () => {
			world.merged = true

			return 'none'
		},
		offer: async (state: DriveState) => ({
			verdict: world.merged ? 'stop' : 'run',
			issues: world.merged || state.in_flight.length > 0 ? [] : [ISSUE],
			retries: 0,
			is_finish: true,
		}),
		launch: async () => {
			world.started = true

			return true
		},
		now: () => NOW,
		sleep: async () => undefined,
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
		sleep: async () => undefined,
		now: () => NOW,
	}
}

test('runs a no-judgment backlog to completion without a parent agent', async () => {
	const directory = mkdtempSync(path.join(tmpdir(), 'josh-drive-harness-'))
	const target = path.join(directory, 'wake.json')
	const world: World = { started: false, merged: false, agents: 0, reports: 0 }

	run_wake.write_wake(target, run_wake.fresh_wake(INVOCATION, NOW))

	const stop = await run_wake_loop.run_loop(target, wake_ports(world), 0)

	expect(stop.reason).toBe('ended')
	expect(world).toStrictEqual({ started: true, merged: true, agents: 0, reports: 1 })
	rmSync(directory, { recursive: true, force: true })
})
