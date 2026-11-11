import type { AgentEnvironment } from '#scripts/agent/agent-provider'
import { run_carry } from '#scripts/run/carry/run-carry'
import type { AttachedLaunchResult, LaunchRequest } from '#scripts/run/detached-launch'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { backlog_drive_unit } from './backlog-drive-unit'

// The retrospective unit `backlog:drive` runs at a drain that owes one (joshuafolkken/kit#6745): a
// headless model child (`backlog-drive-unit.ts`), waited on to its exit as `run:handoff`'s `kickoff`
// is. The improvement picks are judgments, so a model runs them, not the driver.
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

const LOG_LABEL = 'retrospective'

function request_of(
	ports: UnitPorts,
	git_directory: string,
	owner: string,
): LaunchRequest | undefined {
	const log = backlog_drive_unit.log_path(git_directory, LOG_LABEL, ports.now())

	return backlog_drive_unit.request_of(brief_of(owner), ports, log)
}

function production_ports(): UnitPorts {
	return {
		repository_directory: run_carry.repository_directory,
		emit: run_event_setup.emit,
		launch_attached: backlog_drive_unit.launch_attached,
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
