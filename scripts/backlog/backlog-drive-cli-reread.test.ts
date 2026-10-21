import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { josh_command } from '#scripts/josh/josh-run'
import { poll } from '#scripts/lib/poll'
import { run_carry } from '#scripts/run/carry/run-carry'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { backlog_drive, type DrivePorts } from './backlog-drive'
import type { DriveContext } from './backlog-drive-args'
import { backlog_drive_cli } from './backlog-drive-cli'

// joshuafolkken/kit#3697: the backlog was empty and five hours of the idle watch were left when one
// read of the carry record failed. The driver threw, the supervisor stopped watching, and the issue
// opted in two and a half hours later was never started.

const ACTIVE = new Date().toISOString()
const OPTED_IN = '3696'
const ROOMY_POOL = 6
const CONTEXT: DriveContext = {
	owner: String(process.pid),
	active: undefined,
	forwarded: [],
	exclude: [],
	awaited: [],
	window_ms: undefined,
	window: undefined,
	is_only: false,
	stopped: undefined,
}
const OFFER = { offer: { verdict: 'run', issues: [OPTED_IN], retries: 0, answer: 'candidates' } }
const scratch = { directory: '' }

function ports_with(launch: DrivePorts['launch']): DrivePorts {
	return {
		is_finished: () => false,
		adoptable: async () => [],
		merge: async () => ({ token: 'none', outcome: 'merged', is_offer: true }),
		offer: async (state) => await backlog_drive_cli.read_offer(state, CONTEXT),
		launch,
		free_lanes: async () => ROOMY_POOL,
		limit_room: async () => ROOMY_POOL,
		has_lane: async () => false,
		judgement_owed: async () => 0,
		memory_held: async () => false,
		hold: async () => undefined,
		idle: async () => undefined,
		paused: async () => undefined,
		now: () => new Date(),
	}
}

beforeEach(() => {
	scratch.directory = mkdtempSync(path.join(tmpdir(), 'josh-drive-reread-'))
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(scratch.directory)
	vi.spyOn(poll, 'sleep').mockResolvedValue()
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
	run_carry.begin_carry(
		run_carry.carry_path(scratch.directory),
		'backlogrun',
		run_carry.owner_of(process.pid),
	)
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(scratch.directory, { recursive: true, force: true })
})

it('starts an issue opted in during the idle watch after one failed read of the record', async () => {
	const launch = vi.fn<DrivePorts['launch']>(async () => 'launched')

	vi.spyOn(run_carry, 'read_carry').mockReturnValueOnce({ kind: 'none' })
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: JSON.stringify(OFFER) })

	const result = await backlog_drive.run_pass(
		backlog_drive.initial_state([], ACTIVE),
		true,
		ports_with(launch),
	)

	expect(launch).toHaveBeenCalledExactlyOnceWith(OPTED_IN)
	expect(result.state.in_flight).toStrictEqual([OPTED_IN])
})
