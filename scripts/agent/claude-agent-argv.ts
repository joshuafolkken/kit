import { existsSync } from 'node:fs'
import path from 'node:path'
import {
	agent_role_profile,
	type AgentEnvironment,
	type AgentProfile,
	type AgentRole,
} from './agent-role-profile'
import { lane_instructions } from './lane-instructions'

const AGENT_COMMAND = 'claude'
// **The permission mode is passed, not left to the checkout's `.claude/settings.json`.** Claude Code
// ignores a project's `defaultMode: bypassPermissions` (since v2.1.257) and its `permissions.allow` in
// a workspace whose trust dialog was never accepted — every fresh clone and every new lane worktree — so
// a headless child stopped on approvals nobody could give, so kit ships no `defaultMode` (#4997) and
// the flag sets the mode; the file's `deny` list stays in effect (#3796).
const PERMISSION_FLAGS: ReadonlyArray<string> = ['--permission-mode', 'bypassPermissions']
const AGENT_FLAGS: ReadonlyArray<string> = [
	'-p',
	'--verbose',
	'--output-format',
	'stream-json',
	...PERMISSION_FLAGS,
]
const MODEL_FLAG = '--model'
const EFFORT_FLAG = '--effort'
// Resumes a stored session by id. An `outage` re-dispatch passes the
// disconnected child's `session_id` so the relaunched process continues that conversation — its
// accumulated context intact — rather than reading everything from scratch.
const RESUME_FLAG = '--resume'
// Forces a fresh session's id rather than resuming one. The wake supervisor
// generates the id, so it knows without asking the child which transcript that session will write —
// `<session-id>.jsonl` — and can later attribute a whiff to a session it actually started rather than
// to any transcript that happened to move while it was alive.
const SESSION_ID_FLAG = '--session-id'
// **A launched child carries only the tools a lane has ever used**. Every
// tool definition and every user-side claude.ai connector rides on each request's cached preamble, and
// across the lanes measured none of Artifact, Workflow or a connector was ever called, while
// AskUserQuestion has nobody to answer it in an unattended lane. Narrowing them cut the preamble by
// about 16,000 tokens per request. **No web tool is launched**: no role runs with a person at the keyboard, and a
// fetched page enters the context with no trust label, past the Issue trust filter (#4664). This list
// is the one place the set is kept.
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
]
// **A reviewer is the review, not a launcher of one** (joshuafolkken/kit#4715): with `Skill` it ran
// `/code-review`, which forked a second agent that read the same diff and brief again. Without the two
// tools that open a nested agent, the review stays in the one session.
const NESTING_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Skill'])
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
	ends_with_prompt: true
}

type ClaudeArgvResult =
	{ kind: 'argv'; argv: ClaudeArgv; profile: AgentProfile } | { kind: 'rejected'; note: string }

// **`session_id` is optional, so the id-forcing is additive.** Every existing caller composes the same
// vector it did before; only a caller that hands a forced id — the wake supervisor — gets the
// `--session-id` pair, sitting ahead of the model flags exactly where `--resume` sits in `build_resume`.
function session_id_flags(session_id: string | undefined): ReadonlyArray<string> {
	return session_id === undefined ? [] : [SESSION_ID_FLAG, session_id]
}

function launched_tools(role: AgentRole): ReadonlyArray<string> {
	if (role !== agent_role_profile.REVIEWER) return LAUNCHED_TOOLS

	return LAUNCHED_TOOLS.filter((tool) => !NESTING_TOOLS.has(tool))
}

// The config is named by absolute path, resolved against the directory the child is launched in, so
// the flag means the same file whatever the child's own working directory turns out to be. The pair
// sits ahead of the model flags: `--mcp-config` takes several values, and the next flag is what ends it.
function tool_flags(role: AgentRole, cwd: string = process.cwd()): ReadonlyArray<string> {
	const mcp_config = path.join(cwd, PROJECT_MCP_FILE)
	const mcp_flags = existsSync(mcp_config)
		? [STRICT_MCP_FLAG, MCP_CONFIG_FLAG, mcp_config]
		: [STRICT_MCP_FLAG]

	return [TOOLS_FLAG, launched_tools(role).join(','), ...mcp_flags]
}

// **A lane child and a review session start from the lane instruction set** (`lane-instructions.ts`);
// the scheduler keeps `CLAUDE.md`, because it is the one that stops and asks a person.
function instruction_flags(profile: AgentProfile, cwd?: string): ReadonlyArray<string> {
	if (profile.role === agent_role_profile.SCHEDULER) return []

	return lane_instructions.flags(cwd)
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
			...tool_flags(profile.role, cwd),
			...instruction_flags(profile, cwd),
			...session_id_flags(session_id),
			MODEL_FLAG,
			profile.model,
			EFFORT_FLAG,
			profile.effort,
			invocation,
		],
		ends_with_prompt: true,
	}
}

// The resume counterpart: the same vector with `--resume <session_id>` ahead of the model flags, so the
// relaunched child continues the stored session rather than opening a new one.
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
			...tool_flags(profile.role, cwd),
			...instruction_flags(profile, cwd),
			RESUME_FLAG,
			session_id,
			MODEL_FLAG,
			profile.model,
			EFFORT_FLAG,
			profile.effort,
			invocation,
		],
		ends_with_prompt: true,
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
}

export type { ClaudeArgv, ClaudeArgvResult }
export { claude_agent_argv }
