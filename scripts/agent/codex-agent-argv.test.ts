import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { agent_role_profile } from './agent-role-profile'
import { codex_agent_argv } from './codex-agent-argv'

const INVOCATION = 'fullrun #2071'
const LANE = '/lanes/2071'
const EPHEMERAL_FLAG = '--ephemeral'

describe('Codex argv construction', () => {
	it.each(Object.values(agent_role_profile.OPENAI_PROFILES))(
		'builds the trusted local $role invocation without competing permission settings',
		(profile) => {
			const argv = codex_agent_argv.build(INVOCATION, profile)

			expect(argv).toStrictEqual({
				command: 'codex',
				args: [
					'exec',
					'--model',
					profile.model,
					'-c',
					`model_reasoning_effort="${profile.effort}"`,
					'-c',
					`shell_environment_policy.set.JOSH_AGENT_ROLE="${profile.role}"`,
					'-c',
					'default_permissions=":danger-full-access"',
					'-c',
					'approval_policy="never"',
					'--json',
					INVOCATION,
				],
				ends_with_prompt: true,
			})
		},
	)

	it('keeps shell metacharacters inside one final prompt argument', () => {
		const invocation = 'Inspect "quoted" paths; $(do not execute) `literal`\nNext line'
		const argv = codex_agent_argv.build(invocation, agent_role_profile.OPENAI_PROFILES.worker)

		expect(argv.args.at(-1)).toBe(invocation)
	})
})

describe('Codex lane runtime state', () => {
	it.each(Object.values(agent_role_profile.OPENAI_PROFILES))(
		'keeps SQLite local and preserves the $role persistence policy',
		(profile) => {
			const argv = codex_agent_argv.build(INVOCATION, profile, LANE)

			expect(argv.args).toContain('sqlite_home="/lanes/2071/node_modules/.cache/josh/openai"')
			expect(argv.args.includes(EPHEMERAL_FLAG)).toBe(profile.role !== agent_role_profile.WORKER)
			expect(argv.args).not.toContain('--ignore-user-config')
			expect(argv.args).not.toContain('--ignore-rules')
			expect(argv.args).not.toContain('--dangerously-bypass-hook-trust')
			expect(argv.args.slice(-2)).toStrictEqual(['--json', INVOCATION])
		},
	)

	it('quotes an absolute SQLite path when the lane name contains spaces', () => {
		const lane = './lanes/lane with spaces'
		const argv = codex_agent_argv.build(INVOCATION, agent_role_profile.OPENAI_PROFILES.worker, lane)
		const expected = path.resolve(lane, 'node_modules/.cache/josh/openai')

		expect(argv.args).toContain(`sqlite_home=${JSON.stringify(expected)}`)
	})
})
