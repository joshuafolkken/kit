import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_wake } from './run-wake'
import { run_wake_await, type AwaitPorts } from './run-wake-await'
import { run_wake_cli } from './run-wake-cli'
import type { WakeContext } from './run-wake-describe'

// joshuafolkken/kit#3804: Claude Code removes its token from what its Bash tool starts, so the
// supervisor is started by `josh backlogrun` itself, before the parent has carried a run. Pinned here:
// the spawned supervisor inherits the token, its claim comes first so the parent's own `--start` finds
// it running, and a parent that ends without carrying a run leaves no record behind.

vi.mock('node:child_process', async (original) => {
	const actual = await original<{ spawn: typeof spawn }>()

	return { ...actual, spawn: vi.fn() }
})
vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), status: vi.fn() },
}))
// A `--start` that finds a supervisor running cites the run's issue, so the repository is pinned.
vi.mock('#scripts/gh/gh-spawn', () => ({
	gh_spawn: { get_repo_name_with_owner_within: vi.fn().mockReturnValue('joshuafolkken/kit') },
}))

const { git_command } = await import('#scripts/git/git-command')
const spawned = vi.mocked(spawn)

const scratch = mkdtempSync(path.join(tmpdir(), 'run-wake-cli-launch-test-'))
const WORKTREE = path.join(scratch, 'worktree.git')
const REPOSITORY = path.join(scratch, 'repository.git')
const INVOCATION = 'backlogrun #3804'
const ANOTHER_INVOCATION = 'backlogrun #3805'
const TOKEN_KEY = 'CLAUDE_CODE_OAUTH_TOKEN'
const TOKEN = 'token-only-credential'
const CODEX_KEY = 'CODEX_THREAD_ID'
const CLAUDE_KEY = 'CLAUDE_CODE_CHILD_SESSION'
const SUPERVISOR_SESSION = 'run-wake-supervisor'
const SUPERVISOR_PID = 4343
const INTERVAL_MS = 1
const REFUSED = { kind: 'refused', carry_kind: 'none' }
const PROFILE = {
	provider: 'anthropic',
	role: 'scheduler',
	model: 'sonnet',
	effort: 'low',
} as const

const CONTEXT: WakeContext = {
	carry_target: run_carry.carry_path(REPOSITORY),
	ended_target: path.join(scratch, 'ended.json'),
	wake_target: run_wake.wake_path(REPOSITORY),
	log_target: run_wake.wake_log_path(REPOSITORY),
	event_target: run_event_stream.target_of(REPOSITORY),
	git_directory: REPOSITORY,
	worktree: scratch,
}

function write_carry(invocation = INVOCATION): void {
	stamp_file.write_stamp(CONTEXT.carry_target, {
		invocation,
		started_at: new Date().toISOString(),
		merged: 0,
		filed: 0,
		cuts: 0,
	})
}

function ports(
	is_pending: () => boolean,
	on_sleep: () => Promise<void>,
	is_owner_live = true,
): AwaitPorts {
	return {
		read_carry: () => run_carry.read_carry(CONTEXT.carry_target),
		pending_invocation: () => (is_pending() ? INVOCATION : undefined),
		is_owner_live: () => is_owner_live,
		sleep: on_sleep,
	}
}

async function no_sleep(): Promise<void> {
	await Promise.resolve()
}

async function another_begins(): Promise<void> {
	write_carry(ANOTHER_INVOCATION)
	await Promise.resolve()
}

function spawned_environment(): Record<string, string | undefined> {
	return spawned.mock.calls[0]?.[2]?.env ?? {}
}

function clear(): void {
	run_wake.remove_wake(CONTEXT.wake_target)
	run_carry.end_carry(CONTEXT.carry_target)
	rmSync(CONTEXT.log_target, { force: true })
	rmSync(CONTEXT.event_target, { force: true })
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.mocked(git_command.git_directories).mockResolvedValue([WORKTREE, REPOSITORY])
	spawned.mockReset()
	spawned.mockReturnValue(
		Object.assign(Object.create(null) as ReturnType<typeof spawn>, {
			pid: SUPERVISOR_PID,
			on: vi.fn(),
			unref: vi.fn(),
		}),
	)
	clear()
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

afterAll(() => {
	clear()
	rmSync(scratch, { force: true, recursive: true })
})

describe('run_wake_cli.start_for_launch', () => {
	it('starts the supervisor with the token of the process that launched the parent', () => {
		vi.stubEnv(TOKEN_KEY, TOKEN)

		expect(run_wake_cli.start_for_launch(REPOSITORY, 'anthropic')).toStrictEqual({
			kind: 'launched',
			pid: SUPERVISOR_PID,
		})
		expect(spawned.mock.calls[0]?.[1]).toContain('--loop')
		expect(spawned.mock.calls[0]?.[2]).toMatchObject({ env: { [TOKEN_KEY]: TOKEN } })
	})

	it('starts it before any carry record stands', () => {
		expect(run_carry.read_carry(CONTEXT.carry_target).kind).toBe('none')
		expect(run_wake_cli.start_for_launch(REPOSITORY, 'anthropic').kind).toBe('launched')
	})

	it('starts it on the provider chosen for the parent, not the shell’s', () => {
		vi.stubEnv(CODEX_KEY, 'typed-in-codex')

		expect(run_wake_cli.start_for_launch(REPOSITORY, 'anthropic').kind).toBe('launched')
		expect(spawned_environment()[CODEX_KEY]).toBeUndefined()
		expect(spawned_environment()).toMatchObject({ [CLAUDE_KEY]: SUPERVISOR_SESSION })
	})

	it('starts a Codex supervisor for a parent started in Codex', () => {
		expect(run_wake_cli.start_for_launch(REPOSITORY, 'openai').kind).toBe('launched')
		expect(spawned_environment()).toMatchObject({ [CODEX_KEY]: SUPERVISOR_SESSION })
	})
})

describe('run_wake_await.claim_run beside a launched parent', () => {
	it('claims first, so the parent’s --start answers running rather than starting another', async () => {
		const verdicts: Array<number> = []

		async function parent_begins(): Promise<void> {
			write_carry()
			verdicts.push(await run_wake_cli.run(['--start']))
		}

		const awaiting = ports(() => true, parent_begins)
		const claimed = await run_wake_await.claim_run(CONTEXT, PROFILE, INTERVAL_MS, awaiting)

		expect(claimed.kind).toBe('claimed')
		expect(verdicts).toStrictEqual([0])
		expect(vi.mocked(console.info)).toHaveBeenCalledWith(run_wake_cli.RUNNING_VERDICT)
		expect(run_wake.read_wake(CONTEXT.wake_target)).toMatchObject(process_identity.own_fields())
		expect(spawned).not.toHaveBeenCalled()
	})

	it('lets the claim go when the parent ends without carrying a run', async () => {
		const is_pending = vi.fn().mockReturnValueOnce(true).mockReturnValue(false)
		const ended = ports(is_pending, no_sleep)

		await expect(
			run_wake_await.claim_run(CONTEXT, PROFILE, INTERVAL_MS, ended),
		).resolves.toStrictEqual(REFUSED)
		expect(run_wake.read_wake(CONTEXT.wake_target)).toBeUndefined()
	})
})

describe('run_wake_await.claim_run beside another live run', () => {
	it('supervises a live run another invocation began first, whose --start found it running', async () => {
		const begun = ports(() => true, another_begins)
		const claimed = await run_wake_await.claim_run(CONTEXT, PROFILE, INTERVAL_MS, begun)

		expect(claimed).toMatchObject({
			kind: 'claimed',
			wake: { invocation: ANOTHER_INVOCATION },
			carry: { invocation: ANOTHER_INVOCATION },
		})
		expect(run_wake.read_wake(CONTEXT.wake_target)).toMatchObject({
			invocation: ANOTHER_INVOCATION,
			...process_identity.own_fields(),
		})
	})
})

describe('run_wake_await.claim_run letting its claim go', () => {
	it('lets the claim go when the record left is another run whose owner is gone', async () => {
		const is_pending = vi
			.fn()
			.mockReturnValueOnce(true)
			.mockReturnValueOnce(true)
			.mockReturnValue(false)
		const abandoned = ports(is_pending, another_begins, false)

		await expect(
			run_wake_await.claim_run(CONTEXT, PROFILE, INTERVAL_MS, abandoned),
		).resolves.toStrictEqual({ kind: 'refused', carry_kind: 'carried' })
		expect(run_wake.read_wake(CONTEXT.wake_target)).toBeUndefined()
	})

	it('claims nothing when neither a carry record nor a launch stands', async () => {
		const idle = ports(() => false, no_sleep)

		await expect(
			run_wake_await.claim_run(CONTEXT, PROFILE, INTERVAL_MS, idle),
		).resolves.toStrictEqual(REFUSED)
		expect(run_wake.read_wake(CONTEXT.wake_target)).toBeUndefined()
	})
})
