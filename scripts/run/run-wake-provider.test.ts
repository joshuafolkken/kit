import type { AgentArgv } from '#scripts/agent/agent-argv'
import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { expect, test, vi } from 'vitest'
import { run_wake_session } from './run-wake-session'

const INVOCATION = 'backlogrun --max 5 --idle 30'
const WORKTREE = '/projects/kit'
const COMMON_DIRECTORY = '/projects/kit source/.git'
const SUPERVISOR_SESSION = 'run-wake-supervisor'

function openai_argv(): AgentArgv {
	vi.spyOn(git_common_directory, 'resolve').mockReturnValue(COMMON_DIRECTORY)
	const diagnostic = vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
	const built = run_wake_session.wake_argv(
		INVOCATION,
		agent_role_profile.OPENAI_PROFILES.scheduler,
		WORKTREE,
	)

	diagnostic.mockRestore()

	if (built?.kind !== 'argv') throw new Error('expected OpenAI argv')

	return built.argv
}

test('the woken scheduler uses the selected OpenAI provider', () => {
	const argv = openai_argv()

	expect(argv.command).toBe('codex')
	expect(argv.args).toContain('gpt-6-sol')
	expect(argv.args).toContain('--json')
	expect(argv.args).toContain('--ephemeral')
	expect(argv.args).toContain('sqlite_home="/projects/kit/node_modules/.cache/josh/openai"')
	expect(argv.args).toContain('--add-dir')
	expect(argv.args).toContain(COMMON_DIRECTORY)
	expect(argv.args.at(-1)).toBe(INVOCATION)
})

test('the judgment prompt carries the driver result and resume state', () => {
	vi.spyOn(git_common_directory, 'resolve').mockReturnValue(COMMON_DIRECTORY)
	const diagnostic = vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
	const built = run_wake_session.wake_argv(
		INVOCATION,
		agent_role_profile.OPENAI_PROFILES.scheduler,
		WORKTREE,
		{ id: 'session', material: 'merge over #2509\nresume: --owner 1' },
	)

	expect(built?.kind === 'argv' && built.argv.args.at(-1)).toContain('merge over #2509')
	expect(built?.kind === 'argv' && built.argv.args.at(-1)).toContain('resume: --owner 1')
	diagnostic.mockRestore()
})

// joshuafolkken/kit#2415: a wake with a recorded profile keeps its model across a model migration.
test('the woken scheduler keeps the model its recorded profile names', () => {
	const recorded = { ...agent_role_profile.DEFAULT_PROFILES.scheduler, model: 'opus' }
	const diagnostic = vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
	const built = run_wake_session.wake_argv(INVOCATION, recorded, WORKTREE)

	diagnostic.mockRestore()

	expect(built).toMatchObject({ kind: 'argv', profile: recorded })
	expect(built?.kind === 'argv' && built.argv.args).toContain('opus')
})

test('the detached supervisor retains a Claude Code invocation marker', () => {
	const environment = run_wake_session.supervisor_environment(
		agent_role_profile.DEFAULT_PROFILES.scheduler,
	)

	expect(environment).toStrictEqual({ CLAUDE_CODE_CHILD_SESSION: SUPERVISOR_SESSION })
	expect(agent_role_profile.resolve_provider(environment)).toStrictEqual({
		kind: 'provider',
		provider: 'anthropic',
	})
})

test('the detached supervisor retains a Codex invocation marker', () => {
	const environment = run_wake_session.supervisor_environment(
		agent_role_profile.OPENAI_PROFILES.scheduler,
	)

	expect(environment).toStrictEqual({ CODEX_THREAD_ID: SUPERVISOR_SESSION })
	expect(agent_role_profile.resolve_provider(environment)).toStrictEqual({
		kind: 'provider',
		provider: 'openai',
	})
})
