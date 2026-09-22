import type { AgentProvider } from '#scripts/agent/agent-role-profile'
import { api_outage } from '#scripts/agent/api-outage'
import type { ClaudeResultEvent } from '#scripts/agent/claude-result-event'
import { lane_child_invocation } from './lane-child-invocation'

// How a lane re-dispatch chooses between resuming the disconnected child's session and starting fresh
// (joshuafolkken/kit#2317). The premise the whole issue rests on: a child that could not reach the API
// left a `session_id` in its exit record, and re-dispatching it as a bare `fullrun #<N>` threw that
// context away — a resumed child keeps it and loses only the last round-trip.
//
// **The decision is pure and reads three inputs**: the child's exit record, and the provider the lane
// runs under. It resumes only when all three hold — the record is an API outage (a child that stalled
// on its own has nothing to recover), it carries a `session_id`, and the provider is Anthropic (the
// `--resume` mechanism is Claude Code's; an OpenAI lane has no session id here and falls back to fresh).
// Every other case is `fresh`, which is the exact behavior a first dispatch and a non-outage ending had
// before this existed, so the fallback is never a regression.

const ANTHROPIC: AgentProvider = 'anthropic'

// A resume carries the stored session and the resume-specific prompt; a fresh start carries the
// ordinary `fullrun #<N>`. The caller reads `kind` to report which path it took and to pick the argv
// builder — the resume builder needs the `session_id` the fresh one does not.
type ResumePlan =
	{ kind: 'resume'; session_id: string; invocation: string } | { kind: 'fresh'; invocation: string }

function fresh_plan(issue: string): ResumePlan {
	return { kind: 'fresh', invocation: lane_child_invocation.child_invocation(issue) }
}

// The session id to resume from, or `undefined` when this ending is not resumable — the three
// conditions named in the header, read in one place so the caller's fallback is a single branch. An
// Anthropic outage child that left a session id is the only case that yields one.
function resumable_session(
	record: ClaudeResultEvent | undefined,
	provider: AgentProvider,
): string | undefined {
	if (provider !== ANTHROPIC || record === undefined) return undefined

	return api_outage.is_outage(record) ? record.session_id : undefined
}

function plan(
	issue: string,
	record: ClaudeResultEvent | undefined,
	provider: AgentProvider,
): ResumePlan {
	const session_id = resumable_session(record, provider)

	if (session_id === undefined) return fresh_plan(issue)

	return {
		kind: 'resume',
		session_id,
		invocation: lane_child_invocation.outage_resume_invocation(issue),
	}
}

const lane_resume = { plan }

export type { ResumePlan }
export { lane_resume }
