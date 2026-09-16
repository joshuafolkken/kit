import { describe, expect, it } from 'vitest'
import { agent_role_profile, type AgentProfile } from './agent-role-profile'
import { codex_agent_argv } from './codex-agent-argv'

const INVOCATION = 'fullrun #2071'
const MODEL = 'gpt-5.6-sol'
const SANDBOX = 'workspace-write'

function openai_worker(): AgentProfile {
	const result = agent_role_profile.resolve(agent_role_profile.WORKER, {
		JOSH_AGENT_PROVIDER: 'openai',
	})

	if (result.kind === 'rejected') throw new Error(result.note)

	return result.profile
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
	})
})
