import { gh_core_rate_limit } from '#scripts/gh/gh-core-rate-limit'
import { josh_command } from '#scripts/josh/josh-run'
import { poll } from '#scripts/lib/poll'
import { run_carry } from '#scripts/run/carry/run-carry'
import { temporary_directory } from '#tools/test/temporary-directory'
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
const CORE_LIMIT = 5000
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
const make_directory = temporary_directory()

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
		usage_limited: async () => false,
		yields: async () => [],
		park: async () => undefined,
		stall: async () => undefined,
		hold: async () => undefined,
		idle: async () => undefined,
		paused: async () => undefined,
		retrospective: async () => true,
		now: () => new Date(),
	}
}

beforeEach(() => {
	scratch.directory = make_directory('josh-drive-reread-')
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(scratch.directory)
	vi.spyOn(poll, 'sleep').mockResolvedValue()
	vi.spyOn(gh_core_rate_limit, 'read_allowance').mockResolvedValue(undefined)
	vi.spyOn(gh_core_rate_limit, 'read_core').mockResolvedValue(undefined)
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
	run_carry.begin_carry(
		run_carry.carry_path(scratch.directory),
		'backlogrun',
		run_carry.owner_of(process.pid),
	)
})

afterEach(() => {
	vi.restoreAllMocks()
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

// joshuafolkken/kit#6563: the open offer checks the core allowance before reading `backlog:offer`.
it('offers a wait until the reset instead of reading an offer while the core allowance is below the floor', async () => {
	const reset_ms = Date.now()
	const josh_run = vi.spyOn(josh_command, 'josh_run')

	vi.spyOn(gh_core_rate_limit, 'read_core').mockResolvedValue({
		remaining: 0,
		limit: CORE_LIMIT,
		reset_ms,
	})

	const read = await backlog_drive_cli.read_offer(backlog_drive.initial_state([], ACTIVE), CONTEXT)

	expect(read).toMatchObject({ verdict: 'wait', issues: [], not_before_ms: reset_ms })
	expect(josh_run).not.toHaveBeenCalled()
})
