import type { AgentEnvironment } from '#scripts/agent/agent-provider'
import { epic_validate, type EpicSubject } from '#scripts/epic/epic-validate'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_cite } from '#scripts/issue/issue-cite'
import { EPIC_LABEL } from '#scripts/issue/issue-labels'
import { size_estimate } from '#scripts/issue/size-estimate'
import {
	lane_implement_rate_read,
	type SizeMeasurements,
} from '#scripts/lane/lane-implement-rate-read'
import { run_carry } from '#scripts/run/carry/run-carry'
import type { AttachedLaunchResult, LaunchRequest } from '#scripts/run/detached-launch'
import { split_assess } from '#scripts/split/split-assess'
import { backlog_drive_unit } from './backlog-drive-unit'

// The split-only unit `backlog:drive` runs before it opens a lane for an issue over the size bar
// (joshuafolkken/kit#7182): a lane split only after its start→plan reading, and its children then ran
// one after another in that lane. The unit answers the separability question alone —
// `split-assessment.md` → "The question" — and implements nothing.
//
// **A split promotes the issue** (`epic --promote`), never `run:split`: no run exists to set aside —
// its stash and release would act on the driver's own checkout — and a `run:split` child stays open and
// unlabelled, so the read after the unit could not tell it was split. A pass's units run side by side
// in that one checkout, so each child body is named for its issue rather than `.josh/tmp/body.md`.
//
// **Only a split answers `split`**: the issue now an epic, or closed. A recorded reason it stays one
// (`split_assess.REASON_PREFIX`) takes it out of `size_estimate.over_budget`, so this and every later offer
// opens its lane; a unit that wrote neither opens the lane too, whose `lane:plan` still splits. No
// outcome waits on a person (joshuafolkken/kit#7074).

type SplitVerdict = 'split' | 'launch'

interface SplitPorts {
	read: (issue: string) => Promise<EpicSubject | undefined>
	measurements: () => Promise<SizeMeasurements>
	repository_directory: () => Promise<string | undefined>
	launch_attached: (request: LaunchRequest) => Promise<AttachedLaunchResult>
	environment: AgentEnvironment
	cwd: string
	now: () => number
}

function brief_of(issue: string): string {
	return [
		`Split-only unit for ${issue_cite.plain_for('program', issue)}: its declared size is over the size bar. Implement nothing.`,
		`Read it with \`pnpm josh issue:read ${issue}\` and answer only question 1 of`,
		`\`pnpm josh doc:section .claude/skills/workflow-commands/split-assessment.md "${split_assess.QUESTION_SECTION}"\`.`,
		`Separately-mergeable parts → file each child k with \`pnpm josh issue:file "<title>" --body-file .josh/tmp/split-${issue}-<k>.md --route split\`, then`,
		`\`pnpm josh epic --promote ${issue} <N1> <N2> ... [--ordered]\`.`,
		'Before publishing, record every child plan with `issue:plan --planned --no-notify`, then `pnpm josh issue:file --publish <E>`; retry the same epic on failure.',
		`One deliverable → add \`${split_assess.REASON_PREFIX} <理由>\` under 背景 with \`pnpm josh issue:body ${issue} --body-file -\`.`,
		'Nobody answers this session: end it once either is written.',
	].join(' ')
}

function is_over_bar(subject: EpicSubject, measured: SizeMeasurements): boolean {
	const { implement_rate, growth } = measured

	return size_estimate.over_budget(subject.body ?? '', implement_rate, growth) !== undefined
}

function is_split(subject: EpicSubject | undefined): boolean {
	if (subject === undefined) return false

	return subject.state?.toUpperCase() === 'CLOSED' || subject.labels.includes(EPIC_LABEL)
}

function production_ports(): SplitPorts {
	return {
		read: async (issue) =>
			epic_validate.parse_epic_subject(await git_gh_command.issue_get_labels_and_body(issue)),
		measurements: async () => await lane_implement_rate_read.measurements(),
		repository_directory: run_carry.repository_directory,
		launch_attached: backlog_drive_unit.launch_attached,
		environment: process.env,
		cwd: process.cwd(),
		now: () => Date.now(),
	}
}

async function request_of(issue: string, ports: SplitPorts): Promise<LaunchRequest | undefined> {
	const git_directory = await ports.repository_directory()
	if (git_directory === undefined) return undefined
	const log = backlog_drive_unit.log_path(git_directory, `split-${issue}`, ports.now())

	return backlog_drive_unit.request_of(brief_of(issue), ports, log)
}

// `launch` for an issue within the bar, unread, or whose unit could not start.
async function is_due(issue: string, ports: SplitPorts): Promise<boolean> {
	const subject = await ports.read(issue)

	return subject !== undefined && is_over_bar(subject, await ports.measurements())
}

async function run(issue: string, ports: SplitPorts = production_ports()): Promise<SplitVerdict> {
	if (!(await is_due(issue, ports))) return 'launch'

	const request = await request_of(issue, ports)
	if (request === undefined) return 'launch'
	await ports.launch_attached(request)

	return is_split(await ports.read(issue)) ? 'split' : 'launch'
}

const backlog_drive_split_unit = { run }

export type { SplitPorts, SplitVerdict }
export { backlog_drive_split_unit }
