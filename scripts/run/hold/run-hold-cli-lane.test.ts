import { rmSync } from 'node:fs'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { run_preflight } from '#scripts/run/run-preflight'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_hold } from './run-hold'
import { run_hold_cli } from './run-hold-cli'

// A run in the primary checkout never claims an issue whose lane is open (joshuafolkken/kit#9104); the
// lane's own claim, in its linked work tree, still goes through.

const make_directory = temporary_directory('suite')

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), status: vi.fn() },
}))

vi.mock('#scripts/run/run-preflight', () => ({
	run_preflight: { CLEAN_VERDICT: 'clean', check: vi.fn() },
}))

vi.mock('#scripts/run/run-maintenance', () => ({ run_maintenance: { sweep: vi.fn() } }))

vi.mock('#scripts/lane/lane-registry', () => ({ lane_registry: { find_open_lane: vi.fn() } }))

const git_directories = vi.mocked(git_command.git_directories)
const find_open_lane = vi.mocked(lane_registry.find_open_lane)

const scratch = make_directory('run-hold-cli-lane-test-')
const PRIMARY = path.join(scratch, '.git')
const LANE_GIT = path.join(scratch, '.git', 'worktrees', '9096')
const ISSUE = '9096'
const LANE: LaneInfo = {
	issue: ISSUE,
	branch: `${ISSUE}-lane`,
	directory: path.join(scratch, '.kit-lanes', ISSUE),
	seat: undefined,
	development_port: undefined,
	preview_port: undefined,
	output: undefined,
	is_stranded: false,
}

const out: Array<string> = []
const errors: Array<string> = []

beforeEach(() => {
	out.length = 0
	errors.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		out.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation((line: string) => {
		errors.push(line)
	})
	vi.mocked(git_command.status).mockResolvedValue('')
	vi.mocked(run_preflight.check).mockResolvedValue({ advice: '', reason: '', verdict: 'clean' })
	find_open_lane.mockResolvedValue(LANE)
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(run_hold.hold_path(PRIMARY), { force: true })
	rmSync(run_hold.hold_path(LANE_GIT), { force: true })
})

describe('claiming an issue whose lane is open', () => {
	it('answers busy in the primary checkout and writes no hold', async () => {
		git_directories.mockResolvedValue([PRIMARY, PRIMARY])

		await run_hold_cli.run([ISSUE])

		expect(out).toEqual([run_hold_cli.BUSY_VERDICT])
		expect(errors.join('\n')).toContain(LANE.directory)
		expect(run_hold.read_hold(run_hold.hold_path(PRIMARY)).kind).toBe('free')
	})

	it('holds the lane itself', async () => {
		git_directories.mockResolvedValue([LANE_GIT, PRIMARY])

		await run_hold_cli.run([ISSUE])

		expect(out).toEqual([run_hold_cli.HOLD_VERDICT])
	})

	it('holds the primary checkout when the issue has no lane', async () => {
		git_directories.mockResolvedValue([PRIMARY, PRIMARY])
		find_open_lane.mockResolvedValue(undefined)

		await run_hold_cli.run([ISSUE])

		expect(out).toEqual([run_hold_cli.HOLD_VERDICT])
	})
})
