import { agent_argv, type AgentArgv, type AgentArgvResult } from '#scripts/agent/agent-argv'
import {
	agent_role_profile,
	type AgentProfile,
	type ProfileResult,
} from '#scripts/agent/agent-role-profile'
import { agent_worker_profile, type WorkerResult } from '#scripts/agent/agent-worker-profile'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { run_ending } from '#scripts/run/run-ending'
import { lane_dispatch_log } from './lane-dispatch-log'
import type { LaneInfo } from './lane-registry'
import { lane_resume, type ResumePlan } from './lane-resume'
import { lane_transition_guards } from './lane-transition-guards'

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

// The Issue body `josh.worker.route` reads; `undefined` when the read fails, which keeps the default.
async function issue_body(issue: string): Promise<string | undefined> {
	const body = await git_gh_command.issue_get_body_classified(issue)

	return body.kind === 'read' ? body.text : undefined
}

// joshuafolkken/kit#8760: a routed profile is stored as the Issue's `worker:<name>` label, the one
// place the cut relaunch's ship cap and the escalation read the profile from. `undefined` where the
// Issue already carries a label or `route` is off; a refusal where the label cannot be written.
async function stored(
	lane: LaneInfo,
	worker: Extract<WorkerResult, { kind: 'worker' }>,
): Promise<ProfileResult | undefined> {
	if (!worker.settings.route) return undefined

	const labels = await git_gh_issue_write.read_label_names(lane.issue)
	const is_unlabelled = !labels?.some((name) => name.startsWith(agent_worker_profile.LABEL_PREFIX))
	if (!is_unlabelled) return undefined

	const label = `${agent_worker_profile.LABEL_PREFIX}${worker.worker.name}`
	const write = await git_gh_issue_write.issue_apply_label(lane.issue, label)

	return write.is_applied
		? undefined
		: { kind: 'rejected', note: `could not store ${label}: ${write.reason}` }
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
		async () => await issue_body(lane.issue),
	)

	if (worker.kind === 'unset') return agent_role_profile.resolve(agent_role_profile.WORKER)
	if (worker.kind === 'rejected') return worker

	return (await stored(lane, worker)) ?? { kind: 'profile', profile: worker.worker.agent }
}

// **The re-dispatch decides resume-or-fresh from the lane's own exit record**.
// The record is read from the log the previous dispatch of this lane wrote — a first dispatch finds
// none and starts fresh, an `outage` ending with a session id resumes it. The provider is resolved
// first because the resume mechanism is Claude Code's, and an OpenAI lane falls back to fresh. **A
// fresh dispatch never reads the record**: a person restarting a child (`lane:restart`) wants a new
// session that reads the Issue from the start, whatever the previous one ended on.
async function prepared_for(lane: LaneInfo, is_fresh: boolean): Promise<Prepared> {
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

// **A dispatch is the table's `launch`, or `restart` for a fresh one, and is refused on its guards**
// (joshuafolkken/kit#8777): a lane whose branch or work tree is gone has nowhere for a child to run.
async function prepared(lane: LaneInfo, is_fresh: boolean): Promise<Prepared> {
	const event = is_fresh ? 'restart' : 'launch'
	const note = await lane_transition_guards.rejection(event, lane.issue)

	if (note !== undefined) return { kind: 'rejected', note }

	return await prepared_for(lane, is_fresh)
}

const lane_dispatch_prepare = { prepared }

export type { Prepared }
export { lane_dispatch_prepare }
