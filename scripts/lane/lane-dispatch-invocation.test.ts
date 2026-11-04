import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { claude_agent_argv } from '#scripts/agent/claude-agent-argv'
import { detached_launch } from '#scripts/run/detached-launch'
import { expect, it } from 'vitest'
import { lane_dispatch } from './lane-dispatch'

it('is a safe single command-line argument, never one the launcher rejects', () => {
	const argv = claude_agent_argv.build(
		lane_dispatch.resume_invocation('1749'),
		agent_role_profile.DEFAULT_PROFILES.worker,
	)

	expect(detached_launch.is_safe_argv(argv)).toBe(true)
})
