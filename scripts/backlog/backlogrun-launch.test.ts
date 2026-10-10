import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { detached_launch } from '#scripts/run/detached-launch'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backlogrun_launch } from './backlogrun-launch'

// joshuafolkken/kit#3437: how `josh backlogrun` tells a run is already going, and the agent it starts.

const GIT_DIRECTORY = '/repo/.git'
const WORKTREE = '/repo'
const SESSION = '00000000-0000-4000-8000-000000000000'
const LAUNCH_RECORD = JSON.stringify({ pid: 42, start: 'Thu Oct  9 00:00:00 2026' })
const CARRY: RunCarry = {
	invocation: 'backlogrun',
	started_at: '2026-10-09T00:00:00.000Z',
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}

afterEach(() => {
	vi.restoreAllMocks()
})

function stage(is_carried: boolean, is_owner_live: boolean, launch: string | undefined): void {
	const read = is_carried ? { kind: 'carried' as const, carry: CARRY } : { kind: 'none' as const }

	vi.spyOn(run_carry, 'read_carry').mockReturnValue(read)
	vi.spyOn(run_carry, 'is_owner_live').mockReturnValue(is_owner_live)
	vi.spyOn(stamp_file, 'read_stamp_text').mockReturnValue(launch)
}

describe('backlogrun_launch.chosen_environment', () => {
	it('clears every agent-session key and hands the chosen provider', () => {
		const environment = backlogrun_launch.chosen_environment('openai', {
			CLAUDE_CODE_SESSION_ID: 'claude-session',
			CODEX_THREAD_ID: 'codex-thread',
			HOME: '/home',
		})

		expect(environment).toMatchObject({
			CLAUDE_CODE_SESSION_ID: undefined,
			CODEX_THREAD_ID: undefined,
			HOME: '/home',
			JOSH_AGENT_PROVIDER: 'openai',
		})
	})
})

describe('backlogrun_launch.argv_of', () => {
	it('builds a Claude parent with its forced session id', () => {
		vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
		const built = backlogrun_launch.argv_of('backlogrun', 'anthropic', WORKTREE, SESSION)

		expect(built).toMatchObject({ kind: 'argv', argv: { command: 'claude' } })
		expect(built.kind === 'argv' && built.argv.args).toEqual(
			expect.arrayContaining(['--session-id', SESSION, 'backlogrun']),
		)
	})

	it('builds a Codex parent with codex exec', () => {
		vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
		const built = backlogrun_launch.argv_of('backlogrun', 'openai', WORKTREE, undefined)

		expect(built).toMatchObject({
			kind: 'argv',
			argv: { command: 'codex' },
			profile: { provider: 'openai' },
		})
		expect(built.kind === 'argv' && built.argv.args[0]).toBe('exec')
	})

	it('refuses with the diagnostic note of a CLI that cannot run', () => {
		vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'rejected', note: 'no codex' })

		expect(backlogrun_launch.argv_of('backlogrun', 'openai', WORKTREE, undefined)).toStrictEqual({
			kind: 'rejected',
			note: 'no codex',
		})
	})
})

describe('backlogrun_launch.is_running', () => {
	it('answers yes for a carry record whose owner is live', () => {
		stage(true, true, undefined)

		expect(backlogrun_launch.is_running(GIT_DIRECTORY)).toBe(true)
	})

	it('answers yes between the launch and the claim while the launched pid is the same process', () => {
		stage(false, false, LAUNCH_RECORD)
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(true)

		expect(backlogrun_launch.is_running(GIT_DIRECTORY)).toBe(true)
	})

	it('answers no once the launched pid is another process and no owner is live', () => {
		stage(true, false, LAUNCH_RECORD)
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(false)

		expect(backlogrun_launch.is_running(GIT_DIRECTORY)).toBe(false)
	})

	it('answers no with neither record', () => {
		stage(false, false, undefined)

		expect(backlogrun_launch.is_running(GIT_DIRECTORY)).toBe(false)
	})
})

describe('backlogrun_launch.start', () => {
	it('starts the parent with no Codex session key inherited from the shell it was typed in', () => {
		vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
		vi.spyOn(process_identity, 'read_start').mockReturnValue(undefined)
		vi.spyOn(stamp_file, 'replace_stamp').mockReturnValue('')
		const launch = vi
			.spyOn(detached_launch, 'launch')
			.mockReturnValue({ kind: 'launched', pid: 42 })
		const target = { worktree: WORKTREE, git_directory: GIT_DIRECTORY }

		expect(backlogrun_launch.start('backlogrun', 'anthropic', target).kind).toBe('launched')
		expect(launch.mock.calls[0]?.[0].env).toHaveProperty('CODEX_THREAD_ID', undefined)
		expect(launch.mock.calls[0]?.[0].env).toHaveProperty('JOSH_AGENT_PROVIDER', 'anthropic')
	})
})
