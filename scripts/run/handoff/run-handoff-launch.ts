import { agent_argv, type AgentArgvResult } from '#scripts/agent/agent-argv'
import {
	agent_role_profile,
	type AgentEnvironment,
	type AgentProvider,
	type AgentRole,
} from '#scripts/agent/agent-role-profile'
import { agent_safe_text } from '#scripts/agent/agent-safe-text'
import { backlogrun_launch } from '#scripts/backlog/backlogrun-launch'
import { durable_state } from '#scripts/josh/durable-state'
import type { LaunchRequest } from '#scripts/run/detached-launch'
import type { WorkflowHandoff, WorkflowKeyword } from './run-handoff-args'

// The child `josh run:handoff` starts: the role its keyword runs as, the prompt, the argv and the log.
//
// **The profile is the role's, never the main session's model.** The provider is the main session's own,
// so a consultation on Claude Code hands to a Claude child and one on Codex to a Codex child; the model
// and effort come from the role profile, resolved from an environment cleared of the session's keys
// exactly as `josh backlogrun` resolves its parent's (`backlogrun-launch.ts`).

type BuiltArgv = Extract<AgentArgvResult, { kind: 'argv' }>

interface HandoffChild {
	prompt: string
	role: AgentRole
	provider: AgentProvider
	cwd: string
}

// `kickoff` files and plans, as the scheduler does; the runs that implement are the worker's.
const ROLES: Readonly<Record<WorkflowKeyword, AgentRole>> = {
	kickoff: agent_role_profile.SCHEDULER,
	fullrun: agent_role_profile.WORKER,
	halfrun: agent_role_profile.WORKER,
	prrun: agent_role_profile.WORKER,
}

// The child is started headless: no person answers it, so a stop that needs one ends its session, and
// what it says last is all the consultation session reads back.
const PREAMBLE = [
	'Handed over by a consultation session through `josh run:handoff`; the brief below is what was agreed there.',
	'Nobody answers this session: a question for the person ends it, written as the final message.',
	'End the final message with the URL of every Issue and pull request this run created.',
].join(' ')

function role_of(keyword: WorkflowKeyword): AgentRole {
	return ROLES[keyword]
}

// The keyword line comes first, so the child reads it as the explicit invocation it is.
function prompt_of(handoff: WorkflowHandoff, brief: string): string {
	return agent_safe_text.printable(`${handoff.line}\n\n${PREAMBLE}\n\n${brief.trim()}`)
}

function argv_of(
	child: HandoffChild,
	environment: AgentEnvironment = process.env,
): AgentArgvResult {
	const chosen = backlogrun_launch.chosen_environment(child.provider, environment)
	const resolved = agent_role_profile.resolve(child.role, chosen)

	if (resolved.kind === 'rejected') return resolved

	return agent_argv.with_profile_in(child.prompt, resolved.profile, child.cwd)
}

function log_path(git_directory: string, keyword: WorkflowKeyword, now: number): string {
	const suffix = `-${keyword}-${String(now)}.log`

	return durable_state.path(durable_state.PREFIX.HANDOFF_LOG, git_directory, suffix)
}

// The child's own `josh` commands resolve the provider it was handed, never a Codex session this was
// typed in — the same environment `josh backlogrun` hands its parent.
function request_of(built: BuiltArgv, cwd: string, log: string): LaunchRequest {
	const environment = {
		[agent_role_profile.CODEX_SESSION_KEY]: undefined,
		[agent_role_profile.HANDED_PROVIDER_KEY]: built.profile.provider,
	}

	return { argv: built.argv, cwd, env: environment, log_path: log, profile: built.profile }
}

// `kickoff` ends at a filed Issue or a plan, so its result is waited for; a run that implements takes
// long enough that the main session is handed the log and `run:progress` instead.
function is_waited(keyword: WorkflowKeyword): boolean {
	return keyword === 'kickoff'
}

const run_handoff_launch = { argv_of, is_waited, log_path, prompt_of, request_of, role_of }

export type { BuiltArgv, HandoffChild }
export { run_handoff_launch }
