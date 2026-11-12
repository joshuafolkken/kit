import { detached_launch } from '#scripts/run/detached-launch'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agent_diagnostics } from './agent-diagnostics'
import { agent_role_profile, type AgentProfile } from './agent-role-profile'
import { claude_agent_argv } from './claude-agent-argv'
import { judgment_agent_argv } from './judgment-agent-argv'

// joshuafolkken/kit#6528: a judgment child gets no tool, no MCP server and none of the worker launch's
// permissions, and a provider that cannot guarantee that is refused before any process starts.

const INVOCATION = 'Judge whether #6452 holds a decision.'
const { DEFAULT_PROFILES } = agent_role_profile
const REVIEWER: AgentProfile = DEFAULT_PROFILES.reviewer
const CODEX: AgentProfile = { ...REVIEWER, provider: 'openai' }
const NO_TOOLS_FLAG = '--tools='
const RESTRICTED_FLAG = '--restricted'
const BYPASS_FLAGS = ['--permission-mode', 'bypassPermissions']
const WORKER_ONLY_FLAGS = [...BYPASS_FLAGS, '--mcp-config', '--append-system-prompt-file']
const CLI_REFUSAL = { kind: 'rejected', note: 'outdated CLI' } as const

const check = vi.spyOn(agent_diagnostics, 'check')

afterEach(() => {
	check.mockReset()
})

describe('a judgment launch', () => {
	it('disables every tool, MCP server, setting file and slash command', () => {
		const { command, args } = judgment_agent_argv.build(INVOCATION, REVIEWER)

		expect(command).toBe(claude_agent_argv.AGENT_COMMAND)
		expect(args).toContain(NO_TOOLS_FLAG)
		expect(args).toEqual(
			expect.arrayContaining(['--strict-mcp-config', RESTRICTED_FLAG, '--disable-slash-commands']),
		)
		expect(args.at(-1)).toBe(INVOCATION)
	})

	// joshuafolkken/kit#6531: `--tools ''` put an empty element in the vector, which the launch gate
	// refuses, so every judgment failed before it started.
	it('passes the launch gate every argv crosses', () => {
		expect(detached_launch.is_safe_argv(judgment_agent_argv.build(INVOCATION, REVIEWER))).toBe(true)
	})

	it('carries no flag the worker launch grants', () => {
		const { args } = judgment_agent_argv.build(INVOCATION, REVIEWER)

		for (const flag of WORKER_ONLY_FLAGS) expect(args).not.toContain(flag)
		for (const tool of claude_agent_argv.LAUNCHED_TOOLS) expect(args).not.toContain(tool)
	})

	it('leaves the worker launch as it was', () => {
		const worker = claude_agent_argv.build(INVOCATION, DEFAULT_PROFILES.worker)

		expect(worker.args).toEqual(expect.arrayContaining(BYPASS_FLAGS))
		expect(worker.args).not.toContain(RESTRICTED_FLAG)
	})

	it('resolves to the judgment argv once the CLI is ready', () => {
		check.mockReturnValue({ kind: 'ready' })

		expect(judgment_agent_argv.resolve(INVOCATION, REVIEWER)).toEqual({
			kind: 'argv',
			argv: judgment_agent_argv.build(INVOCATION, REVIEWER),
			profile: REVIEWER,
		})
	})
})

describe('a provider that cannot launch with no tool', () => {
	it('is refused with the cause and the retry, before any CLI check', () => {
		const result = judgment_agent_argv.resolve(INVOCATION, CODEX)

		expect(result).toEqual({ kind: 'rejected', note: judgment_agent_argv.UNSUPPORTED_NOTE })
		expect(judgment_agent_argv.UNSUPPORTED_NOTE).toContain('JOSH_AGENT_PROVIDER=anthropic')
		expect(check).not.toHaveBeenCalled()
	})

	it('passes a CLI diagnostic refusal through unchanged', () => {
		check.mockReturnValue(CLI_REFUSAL)

		expect(judgment_agent_argv.resolve(INVOCATION, REVIEWER)).toEqual(CLI_REFUSAL)
	})
})
