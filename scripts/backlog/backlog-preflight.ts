import type { AgentProvider } from '#scripts/agent/agent-role-profile'
import { run_carry, type CarryOwner, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_wake_handoff } from '#scripts/run/wake/run-wake-handoff'
import { backlogrun_launch } from './backlogrun-launch'

// What `josh backlogrun` does before any agent has planned: it begins the run's carry record and
// hands it off at once, so the supervisor it starts next adopts the record and runs `backlog:drive`'s
// first offer without waiting for the parent session (joshuafolkken/kit#5516).
//
// **The parent's planning pass was glue between commands that gate nothing.** Only `run:carry --begin`
// and `--cut` stood between the launch and the driver; this file is those two writes. The plan report
// and the `needs-decision` pass run in the parent beside the lanes — a labelled issue is never offered
// while the label stands, and the supervisor defers a `triage` verdict while the launched parent lives
// (`run-wake-driver.ts` → deferred_triage), so nothing they decide is a precondition of the first offer.
//
// **The launched parent is told the supervisor drives, never handed the record.** Its own `--begin`
// would otherwise classify the handed-off record `resume` and take it from the supervisor; `driving`
// answers that parent alone, so a session the driver wakes for judgment still resumes the record.

type PreflightResult = { kind: 'handed-off'; carry: RunCarry } | { kind: 'standing' }

interface PreflightRequest {
	git_directory: string
	invocation: string
	provider: AgentProvider
}

// The launch record's moment, so the run's clock is the one `run:board` already counts from.
function launch_started(git_directory: string): Date | undefined {
	const started_at = backlogrun_launch.pending_launch(git_directory)?.started_at

	return started_at === undefined ? undefined : new Date(started_at)
}

// The launcher owns the record only until the supervisor adopts it. No conversation is attached, so
// the session `josh backlogrun` was typed in never keeps the record alive.
function launcher_owner(provider: AgentProvider): CarryOwner {
	return { ...run_carry.owner_of(process.pid), transcript: undefined, provider }
}

// A record already standing is left as it is: the launcher's stranded-run check decided it before
// the launch, and the parent's own `--begin` answers it as it always has.
function preflight(request: PreflightRequest): PreflightResult {
	const target = run_carry.carry_path(request.git_directory)
	const owner = launcher_owner(request.provider)
	const started = launch_started(request.git_directory)
	const begun = run_carry.begin_carry(target, request.invocation, owner, started)

	if (begun === undefined) return { kind: 'standing' }

	run_wake_handoff.hand_off(target)

	return { kind: 'handed-off', carry: { ...begun, is_handed_off: true } }
}

// The launched parent meeting a record someone else holds for its own invocation: the one this
// preflight began, held by the launcher or by the supervisor that adopted it.
function is_driven_for(git_directory: string, carry: RunCarry, owner: CarryOwner): boolean {
	const parent = backlogrun_launch.running_parent(git_directory)

	return parent !== undefined && parent === owner.pid && carry.owner_pid !== parent
}

const backlog_preflight = { is_driven_for, preflight }

export type { PreflightRequest, PreflightResult }
export { backlog_preflight }
