import { existsSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { durable_state } from '#scripts/josh/durable-state'
import { OBSERVATION_LEDGER_DIRECTORY } from '#scripts/observations/observation-ledger'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agent_role_profile, type AgentProfile } from './agent-role-profile'
import { codex_agent_argv } from './codex-agent-argv'

const INVOCATION = 'fullrun #2071'
const MODEL = 'gpt-6.1-sol'
const EPHEMERAL_FLAG = '--ephemeral'
const PROFILE_CONFIG = /^default_permissions="josh_lane_[a-f\d]+_0"$/u
const NETWORK_CONFIG = 'network={enabled=true}'
const FILESYSTEM_PREFIX = 'permissions.josh_lane_'
const BASE_FILESYSTEM_GRANTS = Object.fromEntries([
	[':root', 'read'],
	[':workspace_roots', 'write'],
	[':slash_tmp', 'write'],
	[':tmpdir', 'write'],
])
const LANE = '/lanes/2071'
const FIXTURE = path.join(process.cwd(), 'node_modules', '.cache', 'codex-argv-test')
const PRIMARY = path.join(FIXTURE, 'primary')
const GIT_COMMON_DIRECTORY = path.join(FIXTURE, 'kit with spaces', '.git')
// The writable root is the ledger's parent, outside `docs/` since joshuafolkken/kit#3341.
const LEDGER_PARENT = path.dirname(OBSERVATION_LEDGER_DIRECTORY)
const GRANT_PATTERN = /("(?:[^"\\]|\\.)*")=("(?:read|write)")/gu

const WORKTREE_CONFIG = 'config.worktree'
const PINNED_ENTRIES = ['hooks', 'config', 'commondir', WORKTREE_CONFIG]
const OTHER_WORKTREE = path.join('worktrees', 'other-lane')

const repository_directory = vi.spyOn(git_common_directory, 'repository')

beforeEach(() => {
	repository_directory.mockReturnValue(undefined)
})

afterEach(() => {
	rmSync(FIXTURE, { force: true, recursive: true })
})

function link_lane(common_directory: string): string {
	mkdirSync(common_directory, { recursive: true })
	repository_directory.mockReturnValue(common_directory)

	return realpathSync(common_directory)
}

function parse_string(literal: string): string {
	const value: unknown = JSON.parse(literal)

	return String(value)
}

function grants(args: ReadonlyArray<string>): Record<string, string> {
	type Grant = [string, string]

	const table = args.filter((argument) => argument.startsWith(FILESYSTEM_PREFIX)).join(',')
	const pairs = [...table.matchAll(GRANT_PATTERN)].map(
		([, target = '""', access = '""']): Grant => [parse_string(target), parse_string(access)],
	)

	return Object.fromEntries(pairs)
}

function lane_grants(profile: AgentProfile): Record<string, string> {
	return grants(codex_agent_argv.build(INVOCATION, profile, LANE).args)
}

function has_ledger(table: Record<string, string>): boolean {
	return Object.keys(table).some((target) => target.endsWith(LEDGER_PARENT))
}

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

		expect(argv.command).toBe('codex')
		expect(argv.ends_with_prompt).toBe(true)
		expect(argv.args.slice(0, 5)).toStrictEqual([
			'exec',
			'--model',
			MODEL,
			'-c',
			'model_reasoning_effort="medium"',
		])
		expect(argv.args).toContainEqual(expect.stringMatching(PROFILE_CONFIG))
		expect(argv.args.slice(-2)).toStrictEqual(['--json', INVOCATION])
		expect(grants(argv.args)).toStrictEqual(BASE_FILESYSTEM_GRANTS)
	})

	it('keeps the prompt in one final element and passes no permission bypass', () => {
		const argv = codex_agent_argv.build(INVOCATION, openai_worker())

		expect(argv.args.at(-1)).toBe(INVOCATION)
		expect(argv.args.join(' ')).not.toContain('dangerously')
		expect(argv.args).toContainEqual(expect.stringContaining(NETWORK_CONFIG))
	})
})

describe('Codex sandbox selection', () => {
	// codex-cli refuses `sandbox_mode` together with `default_permissions`.
	it('selects the permission profile instead of a sandbox mode or added directories', () => {
		const { args } = codex_agent_argv.build(INVOCATION, openai_worker(), LANE)

		expect(args).toContainEqual(expect.stringMatching(PROFILE_CONFIG))
		expect(args).not.toContain('--sandbox')
		expect(args).not.toContain('--add-dir')
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
})

// joshuafolkken/kit#4653: a sandbox that could write `hooks/` or `config` runs code outside it.
describe('Codex lane common Git directory scope', () => {
	it('writes the common Git directory root, where a ref deletion rewrites packed-refs', () => {
		const common = link_lane(GIT_COMMON_DIRECTORY)

		expect(lane_grants(openai_worker())[common]).toBe('write')
		expect(repository_directory).toHaveBeenCalledWith(LANE)
	})

	it('keeps hooks, config, commondir and config.worktree read-only', () => {
		const common = link_lane(GIT_COMMON_DIRECTORY)
		const table = lane_grants(openai_worker())

		for (const entry of PINNED_ENTRIES) {
			expect(table[path.join(common, entry)]).toBe('read')
		}
	})

	it('keeps every registered work tree git directory pointing at the common one', () => {
		const common = link_lane(GIT_COMMON_DIRECTORY)

		mkdirSync(path.join(common, OTHER_WORKTREE), { recursive: true })
		const table = lane_grants(openai_worker())

		expect(table[path.join(common, OTHER_WORKTREE, 'commondir')]).toBe('read')
		expect(table[path.join(common, OTHER_WORKTREE, WORKTREE_CONFIG)]).toBe('read')
	})
})

describe('Codex lane common Git directory location', () => {
	it('grants a common Git directory reached through a symlink at its real path', () => {
		const common = link_lane(GIT_COMMON_DIRECTORY)
		const linked = path.join(FIXTURE, 'linked.git')

		symlinkSync(common, linked)
		repository_directory.mockReturnValue(linked)

		expect(lane_grants(openai_worker())[common]).toBe('write')
		expect(lane_grants(openai_worker())).not.toHaveProperty(linked)
	})

	it('grants the same Git directory to a reviewer, without the ledger', () => {
		const common = link_lane(GIT_COMMON_DIRECTORY)
		const { reviewer } = agent_role_profile.OPENAI_PROFILES
		const worker_targets = Object.keys(lane_grants(openai_worker()))
		const reviewer_targets = Object.keys(lane_grants(reviewer))

		expect(reviewer_targets).toStrictEqual(
			worker_targets.filter((target) => !target.endsWith(LEDGER_PARENT)),
		)
		expect(lane_grants(reviewer)[common]).toBe('write')
	})
})

describe('Codex lane ledger scope', () => {
	it('creates a missing primary ledger directory before granting worker access', () => {
		link_lane(path.join(PRIMARY, '.git'))
		const table = lane_grants(openai_worker())
		const documents = realpathSync(path.join(PRIMARY, LEDGER_PARENT))

		expect(table[documents]).toBe('write')
	})

	it('grants the ledger directory, never the primary checkout root', () => {
		link_lane(path.join(PRIMARY, '.git'))
		const table = lane_grants(openai_worker())

		expect(table).not.toHaveProperty(realpathSync(PRIMARY))
	})

	it('refuses a ledger directory that is a symlink, which would widen the grant', () => {
		link_lane(path.join(PRIMARY, '.git'))
		mkdirSync(path.dirname(path.join(PRIMARY, LEDGER_PARENT)), { recursive: true })
		symlinkSync(FIXTURE, path.join(PRIMARY, LEDGER_PARENT))

		expect(() => codex_agent_argv.build(INVOCATION, openai_worker(), LANE)).toThrow(
			'Writable root must be a real directory',
		)
	})

	it('does not expose the primary ledger directory to a reviewer', () => {
		link_lane(path.join(PRIMARY, '.git'))
		const table = lane_grants(agent_role_profile.OPENAI_PROFILES.reviewer)

		expect(existsSync(path.join(PRIMARY, LEDGER_PARENT))).toBe(false)
		expect(has_ledger(table)).toBe(false)
	})
})

function primary_checkout(): string {
	const git_directory = path.join(PRIMARY, '.git')

	mkdirSync(git_directory, { recursive: true })
	repository_directory.mockReturnValue(git_directory)

	return realpathSync(git_directory)
}

// joshuafolkken/kit#4743: the parent's records join its lanes' in the common git directory.
// joshuafolkken/kit#5401: the parent's `josh ms` writes `index.lock` in the primary checkout's `.git`.
describe('Codex backlogrun parent in the primary checkout', () => {
	it('writes the git directory, where index.lock lives, and the run-state directory', () => {
		const git_directory = primary_checkout()
		const table = lane_grants(openai_scheduler())
		const state = realpathSync(durable_state.root_for(path.join(PRIMARY, '.git')))

		expect(table[git_directory]).toBe('write')
		expect(table[state]).toBe('write')
		expect(repository_directory).toHaveBeenCalledWith(LANE)
	})

	it('keeps what git runs or follows read-only inside the primary git directory', () => {
		const git_directory = primary_checkout()
		const table = lane_grants(openai_scheduler())

		for (const entry of PINNED_ENTRIES) {
			expect(table[path.join(git_directory, entry)]).toBe('read')
		}
	})

	it('keeps each lane registered under it pointing at the common git directory', () => {
		const git_directory = primary_checkout()

		mkdirSync(path.join(git_directory, OTHER_WORKTREE), { recursive: true })
		const table = lane_grants(openai_scheduler())

		expect(table[path.join(git_directory, OTHER_WORKTREE, 'commondir')]).toBe('read')
	})

	it('grants the scheduler the git directory without the worker-only ledger', () => {
		primary_checkout()
		const table = lane_grants(openai_scheduler())

		expect(existsSync(path.join(PRIMARY, LEDGER_PARENT))).toBe(false)
		expect(has_ledger(table)).toBe(false)
	})

	it('grants nothing beyond the base outside a git repository', () => {
		const { args } = codex_agent_argv.build(INVOCATION, openai_scheduler(), LANE)

		expect(grants(args)).toStrictEqual(BASE_FILESYSTEM_GRANTS)
	})
})
