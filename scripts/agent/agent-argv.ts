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

// **`session_id` forces the fresh session's id, and only the Claude path can honour it**
// (joshuafolkken/kit#2407). Codex has no such flag, and the run-state report reads Claude transcripts
// alone, so an OpenAI scheduler simply builds as before; whiff attribution is a Claude-transcript
// property, so nothing is lost by the omission.
function build(
	invocation: string,
	profile: AgentProfile,
	cwd?: string,
	session_id?: string,
): AgentArgv {
	return profile.provider === 'openai'
		? codex_agent_argv.build(invocation, profile, cwd)
		: claude_agent_argv.build(invocation, profile, session_id)
}

// The resume counterpart of `build` (joshuafolkken/kit#2317). Only the Claude path resumes by session
// id; an OpenAI lane carries no such id at the outage re-dispatch, so it falls back to a fresh build —
// which is never reached in practice, because `lane-resume.ts` only plans a resume for an Anthropic
// provider. The fallback keeps this total rather than throwing on a provider it was not handed.
function build_resume(
	invocation: string,
	profile: AgentProfile,
	session_id: string,
	cwd?: string,
): AgentArgv {
	return profile.provider === 'openai'
		? codex_agent_argv.build(invocation, profile, cwd)
		: claude_agent_argv.build_resume(invocation, profile, session_id)
}

// **`session_id` threads to the Claude build, so a wake launched in a lane's work tree still forces
// its transcript id** (joshuafolkken/kit#2407). It is optional, so every other caller of the
// cwd-scoped build is unchanged.
function with_profile_in(
	invocation: string,
	profile: AgentProfile,
	cwd: string,
	session_id?: string,
): AgentArgvResult {
	const diagnostic = agent_diagnostics.check(profile)
	if (diagnostic.kind === 'rejected') return diagnostic

	return { kind: 'argv', argv: build(invocation, profile, cwd, session_id), profile }
}

// A resume build under the same profile diagnostics as `with_profile_in`, so a lane re-dispatch that
// resumes a session runs the identical readiness check a fresh one does (joshuafolkken/kit#2317).
function with_resume_in(
	invocation: string,
	profile: AgentProfile,
	session_id: string,
	cwd: string,
): AgentArgvResult {
	const diagnostic = agent_diagnostics.check(profile)
	if (diagnostic.kind === 'rejected') return diagnostic

	return { kind: 'argv', argv: build_resume(invocation, profile, session_id, cwd), profile }
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

// **A cut relaunch's profile, resolved for the phase the resumed child is entering**
// (joshuafolkken/kit#2382). A stored lane profile keeps its model and takes only the phase's effort; a
// lane without one resolves the worker for the phase. An env override wins over the phase in either path.
function resume_argv(
	invocation: string,
	profile: AgentProfile | undefined,
	phase: string,
	cwd: string,
): AgentArgvResult {
	if (profile !== undefined) {
		return with_profile_in(invocation, agent_role_profile.with_phase_effort(profile, phase), cwd)
	}

	const resolved = agent_role_profile.resolve(agent_role_profile.WORKER, process.env, phase)

	return resolved.kind === 'rejected'
		? resolved
		: with_profile_in(invocation, resolved.profile, cwd)
}

function resolve_in(
	invocation: string,
	role: AgentRole,
	cwd: string,
	environment: AgentEnvironment = process.env,
): AgentArgvResult {
	const resolved = agent_role_profile.resolve(role, environment)

	return resolved.kind === 'rejected'
		? resolved
		: with_profile_in(invocation, resolved.profile, cwd)
}

const agent_argv = {
	build,
	build_resume,
	resolve,
	resolve_in,
	resume_argv,
	with_profile,
	with_profile_in,
	with_resume_in,
}

export type { AgentArgv, AgentArgvResult }
export { agent_argv }
