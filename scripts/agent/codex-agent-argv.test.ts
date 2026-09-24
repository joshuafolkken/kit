import { existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agent_role_profile, type AgentProfile } from './agent-role-profile'
import { codex_agent_argv } from './codex-agent-argv'

const INVOCATION = 'fullrun #2071'
const MODEL = 'gpt-6-sol'
const SANDBOX = 'workspace-write'
const EPHEMERAL_FLAG = '--ephemeral'
const NETWORK_CONFIG = 'sandbox_workspace_write.network_access=true'
const LANE = '/lanes/2071'
const FIXTURE = path.join(process.cwd(), 'node_modules', '.cache', 'codex-argv-test')
const PRIMARY = path.join(FIXTURE, 'primary')
const GIT_COMMON_DIRECTORY = path.join(FIXTURE, 'kit with spaces', '.git')

const resolve_common_directory = vi.spyOn(git_common_directory, 'resolve')

beforeEach(() => {
	resolve_common_directory.mockReturnValue(undefined)
})

afterEach(() => {
	rmSync(FIXTURE, { force: true, recursive: true })
})

function openai_worker(): AgentProfile {
	const result = agent_role_profile.resolve(agent_role_profile.WORKER, {
		CODEX_THREAD_ID: 'thread',
	})

	if (result.kind === 'rejected') throw new Error(result.note)

	return result.profile
}

function openai_scheduler(): AgentProfile {
	return agent_role_profile.OPENAI_PROFILES.scheduler
}

describe('Codex argv construction', () => {
	it('builds a non-interactive JSONL command as a safe argv array', () => {
		const argv = codex_agent_argv.build(INVOCATION, openai_worker())

		expect(argv).toStrictEqual({
			command: 'codex',
			args: [
				'exec',
				'--sandbox',
				SANDBOX,
				'--model',
				MODEL,
				'-c',
				'model_reasoning_effort="medium"',
				'-c',
				NETWORK_CONFIG,
				'--json',
				INVOCATION,
			],
		})
	})

	it('keeps the prompt in one final element and passes no permission bypass', () => {
		const argv = codex_agent_argv.build(INVOCATION, openai_worker())

		expect(argv.args.at(-1)).toBe(INVOCATION)
		expect(argv.args.join(' ')).not.toContain('dangerously')
		expect(argv.args).toContain(SANDBOX)
		expect(argv.args).toContain(NETWORK_CONFIG)
	})
})

describe('Codex lane runtime state', () => {
	it('keeps lane runtime state local and persists the worker rollout', () => {
		const argv = codex_agent_argv.build(INVOCATION, openai_worker(), LANE)

		expect(argv.args).toContain('sqlite_home="/lanes/2071/node_modules/.cache/josh/openai"')
		expect(argv.args).not.toContain(EPHEMERAL_FLAG)
		expect(argv.args).not.toContain('--ignore-user-config')
	})

	it('keeps a cwd-scoped scheduler ephemeral', () => {
		const argv = codex_agent_argv.build(INVOCATION, openai_scheduler(), LANE)

		expect(argv.args).toContain(EPHEMERAL_FLAG)
	})

	it('quotes an absolute SQLite path when the lane name contains spaces', () => {
		const argv = codex_agent_argv.build(INVOCATION, openai_worker(), './lanes/lane with spaces')
		const expected = path.resolve('./lanes/lane with spaces/node_modules/.cache/josh/openai')

		expect(argv.args).toContain(`sqlite_home=${JSON.stringify(expected)}`)
	})

	it('adds the linked worktree Git and ledger directories as writable roots', () => {
		mkdirSync(path.dirname(GIT_COMMON_DIRECTORY), { recursive: true })
		resolve_common_directory.mockReturnValue(GIT_COMMON_DIRECTORY)

		const argv = codex_agent_argv.build(INVOCATION, openai_worker(), LANE)
		const additions = argv.args.flatMap((argument, index) =>
			argument === '--add-dir' ? [argv.args[index + 1]] : [],
		)

		expect(resolve_common_directory).toHaveBeenCalledWith(LANE)
		expect(additions).toStrictEqual([
			GIT_COMMON_DIRECTORY,
			path.join(path.dirname(GIT_COMMON_DIRECTORY), 'docs'),
		])
	})
})

describe('Codex lane ledger scope', () => {
	it('creates a missing primary ledger directory before granting worker access', () => {
		const documents = path.join(PRIMARY, 'docs')

		mkdirSync(PRIMARY, { recursive: true })
		resolve_common_directory.mockReturnValue(path.join(PRIMARY, '.git'))
		const argv = codex_agent_argv.build(INVOCATION, openai_worker(), LANE)

		expect(existsSync(documents)).toBe(true)
		expect(argv.args).toContain(documents)
	})

	it('adds only the primary ledger directory for a lane worker', () => {
		const documents = path.join(PRIMARY, 'docs')

		mkdirSync(documents, { recursive: true })
		resolve_common_directory.mockReturnValue(path.join(PRIMARY, '.git'))
		const argv = codex_agent_argv.build(INVOCATION, openai_worker(), LANE)
		const additions = argv.args.flatMap((argument, index) =>
			argument === '--add-dir' ? [argv.args[index + 1]] : [],
		)

		expect(additions).toStrictEqual([path.join(PRIMARY, '.git'), documents])
		expect(additions).not.toContain(PRIMARY)
	})

	it('does not expose the primary ledger directory to a reviewer', () => {
		mkdirSync(path.join(PRIMARY, 'docs'), { recursive: true })
		resolve_common_directory.mockReturnValue(path.join(PRIMARY, '.git'))
		const argv = codex_agent_argv.build(
			INVOCATION,
			agent_role_profile.OPENAI_PROFILES.reviewer,
			LANE,
		)

		expect(argv.args).not.toContain(path.join(PRIMARY, 'docs'))
	})
})
