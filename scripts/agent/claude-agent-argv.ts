import {
	agent_role_profile,
	type AgentEnvironment,
	type AgentProfile,
	type AgentRole,
} from './agent-role-profile'

const AGENT_COMMAND = 'claude'
const AGENT_FLAGS: ReadonlyArray<string> = ['-p', '--verbose', '--output-format', 'stream-json']
const MODEL_FLAG = '--model'
const EFFORT_FLAG = '--effort'

interface ClaudeArgv {
	command: string
	args: ReadonlyArray<string>
}

type ClaudeArgvResult =
	{ kind: 'argv'; argv: ClaudeArgv; profile: AgentProfile } | { kind: 'rejected'; note: string }

function build(invocation: string, profile: AgentProfile): ClaudeArgv {
	return {
		command: AGENT_COMMAND,
		args: [...AGENT_FLAGS, MODEL_FLAG, profile.model, EFFORT_FLAG, profile.effort, invocation],
	}
}

function with_profile(invocation: string, profile: AgentProfile): ClaudeArgvResult {
	return { kind: 'argv', argv: build(invocation, profile), profile }
}

function resolve(
	invocation: string,
	role: AgentRole,
	environment: AgentEnvironment = process.env,
): ClaudeArgvResult {
	const result = agent_role_profile.resolve(role, environment)

	if (result.kind === 'rejected') return result

	return with_profile(invocation, result.profile)
}

const claude_agent_argv = { AGENT_COMMAND, AGENT_FLAGS, build, resolve, with_profile }

export type { ClaudeArgv, ClaudeArgvResult }
export { claude_agent_argv }
