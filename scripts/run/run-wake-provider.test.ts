import type { AgentArgv } from '#scripts/agent/agent-argv'
import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { expect, test, vi } from 'vitest'
import { run_wake_session } from './run-wake-session'

const INVOCATION = 'backlogrun --max 5 --idle 30'

function openai_argv(): AgentArgv | undefined {
	const diagnostic = vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
	const built = run_wake_session.wake_argv(INVOCATION, agent_role_profile.OPENAI_PROFILES.scheduler)

	diagnostic.mockRestore()

	return built?.kind === 'argv' ? built.argv : undefined
}

test('the woken scheduler uses the selected OpenAI provider', () => {
	const argv = openai_argv()

	expect(argv?.command).toBe('codex')
	expect(argv?.args).toContain('gpt-5.6-sol')
	expect(argv?.args).toContain('--json')
	expect(argv?.args.at(-1)).toBe(INVOCATION)
})
