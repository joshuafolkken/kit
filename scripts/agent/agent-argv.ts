import { agent_diagnostics } from './agent-diagnostics'
import {
	agent_role_profile,
	type AgentEnvironment,
	type AgentProfile,
	type AgentRole,
} from './agent-role-profile'
import { claude_agent_argv } from './claude-agent-argv'
import { codex_agent_argv } from './codex-agent-argv'

interface AgentArgv {
	command: string
	args: ReadonlyArray<string>
}

type AgentArgvResult =
	{ kind: 'argv'; argv: AgentArgv; profile: AgentProfile } | { kind: 'rejected'; note: string }

function build(invocation: string, profile: AgentProfile): AgentArgv {
	return profile.provider === 'openai'
		? codex_agent_argv.build(invocation, profile)
		: claude_agent_argv.build(invocation, profile)
}

function with_profile(invocation: string, profile: AgentProfile): AgentArgvResult {
	const diagnostic = agent_diagnostics.check(profile)
	if (diagnostic.kind === 'rejected') return diagnostic

	return { kind: 'argv', argv: build(invocation, profile), profile }
}

function resolve(
	invocation: string,
	role: AgentRole,
	environment: AgentEnvironment = process.env,
): AgentArgvResult {
	const resolved = agent_role_profile.resolve(role, environment)

	return resolved.kind === 'rejected' ? resolved : with_profile(invocation, resolved.profile)
}

const agent_argv = { build, resolve, with_profile }

export type { AgentArgv, AgentArgvResult }
export { agent_argv }
