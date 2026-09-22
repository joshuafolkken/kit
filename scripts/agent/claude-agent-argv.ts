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
// Resumes a stored session by id (joshuafolkken/kit#2317). An `outage` re-dispatch passes the
// disconnected child's `session_id` so the relaunched process continues that conversation — its
// accumulated context intact — rather than reading everything from scratch.
const RESUME_FLAG = '--resume'

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

// The resume counterpart: the same vector with `--resume <session_id>` ahead of the model flags, so the
// relaunched child continues the stored session rather than opening a new one (joshuafolkken/kit#2317).
function build_resume(invocation: string, profile: AgentProfile, session_id: string): ClaudeArgv {
	return {
		command: AGENT_COMMAND,
		args: [
			...AGENT_FLAGS,
			RESUME_FLAG,
			session_id,
			MODEL_FLAG,
			profile.model,
			EFFORT_FLAG,
			profile.effort,
			invocation,
		],
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

const claude_agent_argv = { AGENT_COMMAND, AGENT_FLAGS, build, build_resume, resolve, with_profile }

export type { ClaudeArgv, ClaudeArgvResult }
export { claude_agent_argv }
