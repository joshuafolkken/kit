import { agent_provider, type AgentEnvironment } from '#scripts/agent/agent-provider'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { durable_state } from '#scripts/josh/durable-state'
import {
	detached_launch,
	type AttachedLaunchResult,
	type LaunchRequest,
} from '#scripts/run/detached-launch'
import { run_handoff_launch } from '#scripts/run/handoff/run-handoff-launch'

// A headless model unit `backlog:drive` runs and waits on — the retrospective and the split-only unit —
// built as `run:handoff` builds its child. A unit is the parent's planning work, so it runs as the
// scheduler; `undefined` is a refused provider or profile.

interface UnitLaunch {
	environment: AgentEnvironment
	cwd: string
}

// The unit's log beside the handoff logs, `label` naming the unit and `now` keeping each run apart.
function log_path(git_directory: string, label: string, now: number): string {
	return durable_state.path(
		durable_state.PREFIX.HANDOFF_LOG,
		git_directory,
		`-${label}-${String(now)}.log`,
	)
}

function request_of(prompt: string, launch: UnitLaunch, log: string): LaunchRequest | undefined {
	const selected = agent_provider.resolve_provider(launch.environment)

	if (selected.kind === 'rejected') return undefined

	const child = {
		prompt,
		role: agent_role_profile.SCHEDULER,
		provider: selected.provider,
		cwd: launch.cwd,
	}
	const built = run_handoff_launch.argv_of(child, launch.environment)

	if (built.kind === 'rejected') return undefined

	return run_handoff_launch.request_of(built, launch.cwd, log)
}

async function launch_attached(request: LaunchRequest): Promise<AttachedLaunchResult> {
	return await detached_launch.launch_attached(request, (note) => process.stderr.write(`${note}\n`))
}

const backlog_drive_unit = { log_path, request_of, launch_attached }

export type { UnitLaunch }
export { backlog_drive_unit }
