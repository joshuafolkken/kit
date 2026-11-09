import type { AgentArgv, AgentArgvResult } from './agent-argv'
import { agent_diagnostics } from './agent-diagnostics'
import type { AgentProfile } from './agent-role-profile'
import { claude_agent_argv } from './claude-agent-argv'

// **A judgment child reads and answers; it can do nothing else.** `--tools=` launches no built-in
// tool — one element, because `detached_launch` refuses an empty argv element (`--tools ''`),
// `--strict-mcp-config` with no `--mcp-config` loads no MCP server, `--restricted` ignores the
// user, project and local settings files (their hooks and permissions included) and refuses
// `bypassPermissions`, and `--disable-slash-commands` drops every skill and command. No permission
// mode and no lane instruction set ride along, so nothing the worker launch grants carries over.
const JUDGMENT_FLAGS: ReadonlyArray<string> = [
	'-p',
	'--verbose',
	'--output-format',
	'stream-json',
	'--tools=',
	'--strict-mcp-config',
	'--restricted',
	'--disable-slash-commands',
]
const MODEL_FLAG = '--model'
const EFFORT_FLAG = '--effort'
const SUPPORTED_PROVIDER = 'anthropic'
// **A provider that cannot launch with no tool is refused, never swapped.** The Codex CLI has no
// argument that stops every tool, and its read-only sandbox still runs shell commands.
const UNSUPPORTED_NOTE =
	'judgment launch refused: the openai provider (Codex CLI) has no argument that disables every tool, and a read-only sandbox still runs commands. Retry with JOSH_AGENT_PROVIDER=anthropic.'

function build(invocation: string, profile: AgentProfile): AgentArgv {
	return {
		command: claude_agent_argv.AGENT_COMMAND,
		args: [...JUDGMENT_FLAGS, MODEL_FLAG, profile.model, EFFORT_FLAG, profile.effort, invocation],
		ends_with_prompt: true,
	}
}

function resolve(invocation: string, profile: AgentProfile): AgentArgvResult {
	if (profile.provider !== SUPPORTED_PROVIDER) return { kind: 'rejected', note: UNSUPPORTED_NOTE }

	const diagnostic = agent_diagnostics.check(profile)
	if (diagnostic.kind === 'rejected') return diagnostic

	return { kind: 'argv', argv: build(invocation, profile), profile }
}

const judgment_agent_argv = { UNSUPPORTED_NOTE, build, resolve }

export { judgment_agent_argv }
