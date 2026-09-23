import { existsSync } from 'node:fs'
import path from 'node:path'
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
// **A launched child carries only the tools a lane has ever used** (joshuafolkken/kit#2435). Every
// tool definition and every user-side claude.ai connector rides on each request's cached preamble, and
// across the lanes measured none of Artifact, Workflow or a connector was ever called, while
// AskUserQuestion has nobody to answer it in an unattended lane. Narrowing them cut the preamble by
// about 16,000 tokens per request. This list is the one place the set is kept.
const LAUNCHED_TOOLS: ReadonlyArray<string> = [
	'Bash',
	'Read',
	'Edit',
	'Write',
	'Agent',
	'Skill',
	'ToolSearch',
	'SendMessage',
	'TaskStop',
	'Monitor',
	'TodoWrite',
	'WebSearch',
	'WebFetch',
]
const TOOLS_FLAG = '--tools'
// **Only the project's own MCP servers load** — the user's connectors are what the strict flag drops.
// A project with no `.mcp.json` gets the strict flag alone, which loads no server at all: that is
// what the project declared, and it is the same connector-free preamble.
const STRICT_MCP_FLAG = '--strict-mcp-config'
const MCP_CONFIG_FLAG = '--mcp-config'
const PROJECT_MCP_FILE = '.mcp.json'

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

// The config is named by absolute path, resolved against the directory the child is launched in, so
// the flag means the same file whatever the child's own working directory turns out to be. The pair
// sits ahead of the model flags: `--mcp-config` takes several values, and the next flag is what ends it.
function tool_flags(cwd: string = process.cwd()): ReadonlyArray<string> {
	const mcp_config = path.join(cwd, PROJECT_MCP_FILE)
	const mcp_flags = existsSync(mcp_config)
		? [STRICT_MCP_FLAG, MCP_CONFIG_FLAG, mcp_config]
		: [STRICT_MCP_FLAG]

	return [TOOLS_FLAG, LAUNCHED_TOOLS.join(','), ...mcp_flags]
}

function build(
	invocation: string,
	profile: AgentProfile,
	session_id?: string,
	cwd?: string,
): ClaudeArgv {
	return {
		command: AGENT_COMMAND,
		args: [
			...AGENT_FLAGS,
			...tool_flags(cwd),
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
function build_resume(
	invocation: string,
	profile: AgentProfile,
	session_id: string,
	cwd?: string,
): ClaudeArgv {
	return {
		command: AGENT_COMMAND,
		args: [
			...AGENT_FLAGS,
			...tool_flags(cwd),
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

const claude_agent_argv = {
	AGENT_COMMAND,
	AGENT_FLAGS,
	LAUNCHED_TOOLS,
	build,
	build_resume,
	resolve,
	tool_flags,
	with_profile,
}

export type { ClaudeArgv, ClaudeArgvResult }
export { claude_agent_argv }
