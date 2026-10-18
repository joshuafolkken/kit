import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_hold } from './run-hold'
import { run_hold_cli } from './run-hold-cli'
import { run_stop_notify } from './run-stop-notify'

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), head_commit: vi.fn(), status: vi.fn() },
}))

// The send itself is `run-stop-notify.test.ts`'s; here only which one a marked stop calls.
vi.mock('./run-stop-notify', () => ({
	run_stop_notify: { send_halfrun: vi.fn(), send_prrun: vi.fn() },
}))

const scratch = mkdtempSync(path.join(tmpdir(), 'run-hold-cli-stop-test-'))
const WORKTREE = path.join(scratch, '.git')
const TARGET = run_hold.hold_path(WORKTREE)
const ISSUE = '4135'
const OTHER_ISSUE = '4134'
const SUCCESS_EXIT_CODE = 0
const HALFRUN_STOP_FLAG = '--halfrun-stop'

const out: Array<string> = []

beforeEach(() => {
	out.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		out.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.mocked(git_command.git_directories).mockResolvedValue([WORKTREE, WORKTREE])
	vi.mocked(git_command.head_commit).mockResolvedValue('abc1234')
})

afterEach(() => {
	vi.clearAllMocks()
	vi.restoreAllMocks()
	rmSync(TARGET, { force: true })
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('a marked stop sends its own confirmation', () => {
	it('sends the halfrun confirmation and still answers the single hold token', async () => {
		run_hold.create_hold(TARGET, ISSUE)

		expect(await run_hold_cli.run([ISSUE, HALFRUN_STOP_FLAG])).toBe(SUCCESS_EXIT_CODE)
		expect(run_stop_notify.send_halfrun).toHaveBeenCalledWith(TARGET, ISSUE)
		expect(run_stop_notify.send_prrun).not.toHaveBeenCalled()
		expect(out).toEqual([run_hold_cli.HOLD_VERDICT])
	})

	it('sends the prrun confirmation on a prrun stop', async () => {
		run_hold.create_hold(TARGET, ISSUE)

		expect(await run_hold_cli.run([ISSUE, '--prrun-stop'])).toBe(SUCCESS_EXIT_CODE)
		expect(run_stop_notify.send_prrun).toHaveBeenCalledWith(TARGET, ISSUE)
		expect(out).toEqual([run_hold_cli.HOLD_VERDICT])
	})

	it('sends nothing when the record is another run’s', async () => {
		run_hold.create_hold(TARGET, OTHER_ISSUE)

		await run_hold_cli.run([ISSUE, HALFRUN_STOP_FLAG])

		expect(run_stop_notify.send_halfrun).not.toHaveBeenCalled()
		expect(out).toEqual([run_hold_cli.BUSY_VERDICT])
	})
})
