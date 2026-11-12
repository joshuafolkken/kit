import { rmSync } from 'node:fs'
import path from 'node:path'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_carry } from './run-carry'
import { run_carry_added } from './run-carry-added'
import { run_carry_cli } from './run-carry-cli'
import { run_carry_cli_fixture } from './run-carry-cli-fixture'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#6147: a run the launcher's preflight did not begin still writes the lane limit it
// starts under, so `lane:stats` sees a `.env` change between runs.

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), status: vi.fn() },
}))
vi.mock('#scripts/lane/lane-limit-history', () => ({
	lane_limit_history: { record_launch: vi.fn(async () => undefined) },
}))

const { git_command } = await import('#scripts/git/git-command')
const { lane_limit_history } = await import('#scripts/lane/lane-limit-history')
const git_directories = vi.mocked(git_command.git_directories)
const record_launch = vi.mocked(lane_limit_history.record_launch)

const scratch = make_directory('run-carry-cli-limit-')
const WORKTREE = path.join(scratch, 'worktree.git')
const REPOSITORY = path.join(scratch, 'repository.git')
const INVOCATION = 'backlogrun --max 5'

function carry_target(): string {
	return run_carry.carry_path(REPOSITORY)
}

function event_target(): string {
	return run_event_stream.target_of(REPOSITORY)
}

beforeEach(() => {
	run_carry_cli_fixture.hold_verdict()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	git_directories.mockResolvedValue([WORKTREE, REPOSITORY])
	record_launch.mockClear()
	run_carry.end_carry(carry_target())
	rmSync(event_target(), { force: true })
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(carry_target(), { force: true })
	rmSync(event_target(), { force: true })
})

describe('run:carry --begin records the lane limit', () => {
	it('records the limit to the ledger when it begins a fresh record', async () => {
		expect(await run_carry_cli.run(['--begin', INVOCATION])).toBe(0)

		expect(record_launch).toHaveBeenCalledOnce()
	})

	it('records no limit when a standing record refuses the begin', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		record_launch.mockClear()

		expect(await run_carry_cli.run(['--begin', INVOCATION])).toBe(1)

		expect(record_launch).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#6839: the roots `run:add` gave a run that named no issue are what a successor
// takes over.
describe('run:carry --json for a run that named no issue', () => {
	it('reports the roots run:add gave it as remaining', async () => {
		const carry = run_carry.begin_carry(carry_target(), INVOCATION)

		if (carry === undefined) throw new Error('the scratch record was not created')
		run_carry_added.add_issues(carry_target(), carry, [{ issue: 6839, is_priority: false }])
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		await run_carry_cli.run(['--json'])
		const out = info.mock.calls.map(([line]) => String(line))

		expect(run_carry_cli_fixture.last_json(out).remaining).toStrictEqual([6839])
	})
})
