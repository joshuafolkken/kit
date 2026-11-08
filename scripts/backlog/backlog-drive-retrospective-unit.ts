import { agent_provider, type AgentEnvironment } from '#scripts/agent/agent-provider'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { durable_state } from '#scripts/josh/durable-state'
import { run_carry } from '#scripts/run/carry/run-carry'
import {
	detached_launch,
	type AttachedLaunchResult,
	type LaunchRequest,
} from '#scripts/run/detached-launch'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_handoff_launch } from '#scripts/run/handoff/run-handoff-launch'

// The retrospective unit `backlog:drive` runs at a drain that owes one (joshuafolkken/kit#6745): a
// headless model child built as `run:handoff` builds its child, and waited on to its exit as that
// command's `kickoff` is. The improvement picks are judgments, so a model runs them, not the driver.
//
// **Only the run record's retrospective mark is success.** A unit that exited 0 on a question for a
// person, or whose close was refused, marked nothing; that — and no repository, a refused provider or
// profile, a launch that failed — answers `false`, and the driver hands the retrospective back.

// The record is held by the driver's owner (the supervisor, or the attached parent), never by the
// unit's own session, so the close names that owner or `run:carry` refuses it as `busy`. The unit is
// no run parent `run:step` answers, so the digest command is named here.
function brief_of(owner: string): string {
	return [
		'Run the backlogrun retrospective as the run parent would: `pnpm josh doc:read retrospective.md`;',
		'its digest is `pnpm josh retrospective`.',
		`Close with \`pnpm josh run:carry --retrospective --summary "<result>" --owner ${owner}\`:`,
		'the run record is held by that process, not this session.',
		'Nobody answers this session: a question for a person ends it, written as the final message.',
	].join(' ')
}

interface UnitPorts {
	repository_directory: () => Promise<string | undefined>
	emit: (text: string) => Promise<void>
	launch_attached: (request: LaunchRequest) => Promise<AttachedLaunchResult>
	is_marked: (git_directory: string) => boolean
	environment: AgentEnvironment
	cwd: string
	now: () => number
}

function log_path(git_directory: string, now: number): string {
	const suffix = `-retrospective-${String(now)}.log`

	return durable_state.path(durable_state.PREFIX.HANDOFF_LOG, git_directory, suffix)
}

// The retrospective is the parent's planning work, so the unit runs as the scheduler.
function request_of(
	ports: UnitPorts,
	git_directory: string,
	owner: string,
): LaunchRequest | undefined {
	const selected = agent_provider.resolve_provider(ports.environment)

	if (selected.kind === 'rejected') return undefined

	const child = {
		prompt: brief_of(owner),
		role: agent_role_profile.SCHEDULER,
		provider: selected.provider,
		cwd: ports.cwd,
	}
	const built = run_handoff_launch.argv_of(child, ports.environment)

	if (built.kind === 'rejected') return undefined

	return run_handoff_launch.request_of(built, ports.cwd, log_path(git_directory, ports.now()))
}

function production_ports(): UnitPorts {
	return {
		repository_directory: run_carry.repository_directory,
		emit: run_event_setup.emit,
		launch_attached: async (request) =>
			await detached_launch.launch_attached(request, (note) => process.stderr.write(`${note}\n`)),
		is_marked: (git_directory) =>
			run_carry.retrospective_done_of(run_carry.read_carry(run_carry.carry_path(git_directory))),
		environment: process.env,
		cwd: process.cwd(),
		now: () => Date.now(),
	}
}

// The board's `🔍 retrospective` stage is written before the start, so it reads while the unit runs.
async function run(owner: string, ports: UnitPorts = production_ports()): Promise<boolean> {
	const git_directory = await ports.repository_directory()
	if (git_directory === undefined) return false

	const request = request_of(ports, git_directory, owner)
	if (request === undefined) return false

	await ports.emit(run_event_setup.STAGE.RETROSPECTIVE)
	await ports.launch_attached(request)

	return ports.is_marked(git_directory)
}

const backlog_drive_retrospective_unit = { run }

export type { UnitPorts }
export { backlog_drive_retrospective_unit }
