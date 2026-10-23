import { epic_close } from '#scripts/epic/epic-close'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_evidence_exit, type EvidenceExit } from '#scripts/issue/issue-evidence-exit'
import { MEASURED_LABEL } from '#scripts/issue/issue-labels'
import { session_cite } from '#scripts/issue/session-cite'

// The writes that complete a measurement-only Issue — the result comment, the `measured` label and
// the close — shared by `josh issue:measured` and `backlog:drive`'s declared measurement
// (`backlog-measure-close.ts`), out of the CLI so the drive imports no main guard.
//
// **The close is the run's own**: such an Issue changes no code, so no pull request's `closes #N`
// can close it, and an OPEN child `run:merge` reads as `failed` and parks with `run:stalled`. A
// CLOSED one it reads as `merged` (`run-merge.ts` → `classify_child`). The label goes on before the
// close because it is what every sweep — `run:carry --end`, `run:tidy` — tells this close from a
// person's by (`issue-merged.ts`); a close without it would be one they never count as merged.

async function apply_label(issue_number: string): Promise<boolean> {
	const write = await git_gh_command.issue_apply_label(issue_number, MEASURED_LABEL)

	if (!write.is_applied) console.error(`${MEASURED_LABEL} not applied: ${write.reason}`)

	return write.is_applied
}

// A closed measurement may be its epic's last child, and no `followup` runs for it — so the epic
// auto-close is run here, through the one entry every child close takes (`epic-close.ts`).
async function close_issue(issue_number: string): Promise<boolean> {
	const is_closed = await git_gh_command.issue_close(issue_number, undefined)

	if (is_closed) await epic_close.close_completed_epics({ issue_number, is_merged: true })
	else console.error(`Issue ${session_cite.issue(issue_number)} not closed`)

	return is_closed
}

async function label_and_close(issue_number: string): Promise<boolean> {
	return (await apply_label(issue_number)) && (await close_issue(issue_number))
}

const MEASURED_EXIT: EvidenceExit = { command: 'issue:measured', finish: label_and_close }

// The same writes for evidence composed in process, with no hold of its own to release.
async function close(issue_number: string, evidence: string): Promise<boolean> {
	return await issue_evidence_exit.write({ issue_number, evidence }, MEASURED_EXIT)
}

const issue_measured_close = { MEASURED_EXIT, close }

export { issue_measured_close }
