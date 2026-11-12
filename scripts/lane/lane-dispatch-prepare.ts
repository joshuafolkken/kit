import { agent_argv, type AgentArgv, type AgentArgvResult } from '#scripts/agent/agent-argv'
import {
	agent_role_profile,
	type AgentProfile,
	type ProfileResult,
} from '#scripts/agent/agent-role-profile'
import { agent_worker_profile } from '#scripts/agent/agent-worker-profile'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
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

// **The worker profile the lane's Issue selects, where the repository opts into `josh.worker`**.
// The Issue's `worker:<name>` label (else the configured default) wins over `JOSH_WORKER_MODEL` /
// `JOSH_WORKER_EFFORT`; a repository without the setting resolves the worker from the environment as
// before and never reads the labels. `record_output` keeps the chosen profile in the lane's `.env`,
// which a cut relaunch resumes on.
async function worker_profile(lane: LaneInfo): Promise<ProfileResult> {
	const worker = await agent_worker_profile.resolve(
		lane.directory,
		async () => await git_gh_issue_write.read_label_names(lane.issue),
	)

	if (worker.kind === 'unset') return agent_role_profile.resolve(agent_role_profile.WORKER)

	return worker.kind === 'rejected' ? worker : { kind: 'profile', profile: worker.worker.agent }
}

// **The re-dispatch decides resume-or-fresh from the lane's own exit record**.
// The record is read from the log the previous dispatch of this lane wrote — a first dispatch finds
// none and starts fresh, an `outage` ending with a session id resumes it. The provider is resolved
// first because the resume mechanism is Claude Code's, and an OpenAI lane falls back to fresh. **A
// fresh dispatch never reads the record**: a person restarting a child (`lane:restart`) wants a new
// session that reads the Issue from the start, whatever the previous one ended on.
async function prepared(lane: LaneInfo, is_fresh: boolean): Promise<Prepared> {
	const resolved = await worker_profile(lane)

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
