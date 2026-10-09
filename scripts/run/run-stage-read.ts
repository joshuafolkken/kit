import { has_label_name, PLANNED_LABEL } from '#scripts/issue/issue-labels'
import { issue_state_cli, type StateRead } from '#scripts/issue/issue-state-cli'
import { run_halfrun_resume } from './run-halfrun-resume'
import { run_prrun_resume, type PrrunToken } from './run-prrun-resume'
import { run_stage, type StageState } from './run-stage'

// The reading half of the stage ladder: the facts `run_stage.state_of` folds
// into one state, each read from where the stage that produced it left it — never from the
// conversation. A closed issue and the `run:planned` label come from GitHub; a `halfrun` stop and a `prrun`
// stop come from the stop's own mark on the tree's hold (`run-halfrun-resume.ts`,
// `run-prrun-resume.ts`).

const CLOSED = 'CLOSED'

interface StageRead {
	state: StageState
	// The `prrun` stop's resume token, kept so the entry acts on it without reading the pull request
	// again; `undefined` when no `prrun` stop is recorded for the issue.
	prrun_token: PrrunToken | undefined
}

function is_closed(read: StateRead): boolean {
	return read.kind === 'state' && read.state.state === CLOSED
}

function is_planned(read: StateRead): boolean {
	return read.kind === 'state' && has_label_name(read.state.labels, PLANNED_LABEL)
}

// The two stops are one hold record, so at most one is present; the `prrun` one is asked only when the
// `halfrun` one is not, which spares its pull-request read.
async function read_stop(
	issue: string,
): Promise<{ is_halfrun_stopped: boolean; prrun_token: PrrunToken | undefined }> {
	if (await run_halfrun_resume.is_pending(issue)) {
		return { is_halfrun_stopped: true, prrun_token: undefined }
	}

	return { is_halfrun_stopped: false, prrun_token: await run_prrun_resume.resume_token(issue) }
}

// An unreadable issue reads as neither closed nor planned: the ordinary entry that follows reads it
// again and answers `unknown` for it.
async function read_stage(issue: string): Promise<StageRead> {
	const [issue_read, stop] = await Promise.all([
		issue_state_cli.read_issue(issue),
		read_stop(issue),
	])
	const state = run_stage.state_of({
		is_closed: is_closed(issue_read),
		is_prrun_stopped: stop.prrun_token !== undefined,
		is_halfrun_stopped: stop.is_halfrun_stopped,
		is_planned: is_planned(issue_read),
	})

	return { state, prrun_token: stop.prrun_token }
}

const run_stage_read = { read_stage }

export type { StageRead }
export { run_stage_read }
