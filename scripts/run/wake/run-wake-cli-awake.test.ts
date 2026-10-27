import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_wake } from './run-wake'
import { run_wake_await } from './run-wake-await'
import { run_wake_cli } from './run-wake-cli'
import { run_wake_code } from './run-wake-code'
import { run_wake_session } from './run-wake-session'
import { run_wake_supervise } from './run-wake-supervise'

// joshuafolkken/kit#5173: the supervisor keeps the host awake on its own pid once it holds the run, so
// a reload's successor, which runs this same `--loop`, keeps it awake on its own pid in turn.

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), status: vi.fn() },
}))

const { git_command } = await import('#scripts/git/git-command')

const scratch = mkdtempSync(path.join(tmpdir(), 'run-wake-cli-awake-test-'))
const WORKTREE = path.join(scratch, 'worktree.git')
const REPOSITORY = path.join(scratch, 'repository.git')
const INVOCATION = 'backlogrun --max 5 --idle 30'
const PROFILE = agent_role_profile.DEFAULT_PROFILES.scheduler
const LOOP_FLAG = '--loop'

beforeEach(() => {
	vi.mocked(git_command.git_directories).mockResolvedValue([WORKTREE, REPOSITORY])
	vi.spyOn(console, 'info').mockReturnValue()
	vi.spyOn(console, 'error').mockReturnValue()
	vi.spyOn(run_wake_session, 'keep_awake').mockReturnValue()
	vi.spyOn(run_wake_code, 'watch').mockResolvedValue(async () => false)
	vi.spyOn(run_wake_supervise, 'supervise').mockResolvedValue({
		reason: 'stopped',
		note: undefined,
	})
})

afterEach(() => {
	vi.restoreAllMocks()
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('josh run:wake --loop — the host stays awake', () => {
	it('keeps the host awake on its own pid once it claimed the run', async () => {
		const now = new Date()

		vi.spyOn(run_wake_await, 'claim_run').mockResolvedValue({
			kind: 'claimed',
			wake: run_wake.fresh_wake(INVOCATION, now, PROFILE),
			carry: {
				invocation: INVOCATION,
				started_at: now.toISOString(),
				merged: 0,
				filed: 0,
				cuts: 0,
				failures: 0,
				outages: 0,
			},
		})

		await run_wake_cli.run([LOOP_FLAG])

		expect(run_wake_session.keep_awake).toHaveBeenCalledWith(process.pid)
	})

	it('keeps nothing awake when another supervisor already holds the run', async () => {
		vi.spyOn(run_wake_await, 'claim_run').mockResolvedValue({ kind: 'running' })

		await run_wake_cli.run([LOOP_FLAG])

		expect(run_wake_session.keep_awake).not.toHaveBeenCalled()
	})
})
