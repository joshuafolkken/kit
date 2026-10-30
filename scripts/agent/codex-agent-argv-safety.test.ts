import path from 'node:path'
import { detached_launch } from '#scripts/run/detached-launch'
import { describe, expect, it } from 'vitest'
import { agent_role_profile } from './agent-role-profile'
import { codex_agent_argv } from './codex-agent-argv'

const FIXTURE = path.join(
	process.cwd(),
	'node_modules',
	'.cache',
	'long 日本語 path.with.dots "quoted"',
)
const INVOCATION = 'Validate the launcher fixture only'

describe('Codex permission arguments at the shared launcher boundary', () => {
	it.each(Object.values(agent_role_profile.OPENAI_PROFILES))(
		'accepts a $role vector without discovering or granting Git paths',
		(profile) => {
			const argv = codex_agent_argv.build(INVOCATION, profile, FIXTURE)

			expect(detached_launch.is_safe_argv(argv)).toBe(true)
			expect(argv.args).toContain('default_permissions=":danger-full-access"')
			expect(argv.args.some((value) => value.startsWith('permissions.'))).toBe(false)
		},
	)
})
