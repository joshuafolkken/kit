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
// Forces a fresh session's id rather than resuming one (joshuafolkken/kit#2407). The wake supervisor
// generates the id, so it knows without asking the child which transcript that session will write —
// `<session-id>.jsonl` — and can later attribute a whiff to a session it actually started rather than
// to any transcript that happened to move while it was alive.
const SESSION_ID_FLAG = '--session-id'

interface ClaudeArgv {
	command: string
	args: ReadonlyArray<string>
}

type ClaudeArgvResult =
	{ kind: 'argv'; argv: ClaudeArgv; profile: AgentProfile } | { kind: 'rejected'; note: string }

// **`session_id` is optional, so the id-forcing is additive.** Every existing caller composes the same
// vector it did before; only a caller that hands a forced id — the wake supervisor — gets the
// `--session-id` pair, sitting ahead of the model flags exactly where `--resume` sits in `build_resume`.
function session_id_flags(session_id: string | undefined): ReadonlyArray<string> {
	return session_id === undefined ? [] : [SESSION_ID_FLAG, session_id]
}

function build(invocation: string, profile: AgentProfile, session_id?: string): ClaudeArgv {
	return {
		command: AGENT_COMMAND,
		args: [
			...AGENT_FLAGS,
			...session_id_flags(session_id),
			MODEL_FLAG,
			profile.model,
			EFFORT_FLAG,
			profile.effort,
			invocation,
		],
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
