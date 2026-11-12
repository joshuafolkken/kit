import { agent_argv, type AgentArgv, type AgentArgvResult } from '#scripts/agent/agent-argv'
import { agent_role_profile, type AgentProfile } from '#scripts/agent/agent-role-profile'
import { run_ending } from '#scripts/run/run-ending'
import { lane_dispatch_log } from './lane-dispatch-log'
import type { LaneInfo } from './lane-registry'
import { lane_resume, type ResumePlan } from './lane-resume'

type Prepared =
	| {
			kind: 'prepared'
			invocation: string
			argv: AgentArgv
			profile: AgentProfile
			resumed_from: string | undefined
	  }
	| { kind: 'rejected'; note: string }

// Build the argv the plan calls for: a resume carries the stored session id, a fresh start does not.
// Both run the same profile diagnostics under the already-resolved profile, so a resume is refused for
// exactly the reasons a fresh dispatch is.
function built_for(plan: ResumePlan, profile: AgentProfile, lane: LaneInfo): AgentArgvResult {
	if (plan.kind === 'resume') {
		return agent_argv.with_resume_in(plan.invocation, profile, plan.session_id, lane.directory)
	}

	return agent_argv.with_profile_in(plan.invocation, profile, lane.directory)
}

// **The re-dispatch decides resume-or-fresh from the lane's own exit record**.
// The record is read from the log the previous dispatch of this lane wrote — a first dispatch finds
// none and starts fresh, an `outage` ending with a session id resumes it. The provider is resolved
// first because the resume mechanism is Claude Code's, and an OpenAI lane falls back to fresh. **A
// fresh dispatch never reads the record**: a person restarting a child (`lane:restart`) wants a new
// session that reads the Issue from the start, whatever the previous one ended on.
function prepared(lane: LaneInfo, is_fresh: boolean): Prepared {
	const resolved = agent_role_profile.resolve(agent_role_profile.WORKER)

	if (resolved.kind === 'rejected') return resolved

	const record = is_fresh
		? undefined
		: run_ending.read_exit(lane_dispatch_log.default_log_path(lane))
	const plan = lane_resume.plan(lane.issue, record, resolved.profile.provider)
	const built = built_for(plan, resolved.profile, lane)

	if (built.kind === 'rejected') return built
	const resumed_from = plan.kind === 'resume' ? plan.session_id : undefined

	return {
		kind: 'prepared',
		invocation: plan.invocation,
		argv: built.argv,
		profile: built.profile,
		resumed_from,
	}
}

const lane_dispatch_prepare = { prepared }

export type { Prepared }
export { lane_dispatch_prepare }
