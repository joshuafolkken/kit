import { epic_close } from '#scripts/epic/epic-close'
import { git_followup_issue_close } from '#scripts/followup/git-followup-issue-close'
import { session_cite } from '#scripts/issue/session-cite'

const MERGE_CLOSER = 'pnpm josh run:merge'
const SINGLE_READ = { attempts: 1, interval_ms: 0 }

interface MergedChild {
	child: string
	// The merged pull request that closes the child, when GitHub left the child OPEN after the merge.
	merged_pr?: string | undefined
}

// A child merged while GitHub left it OPEN is closed here, through the one close `followup` uses.
// The state was just read OPEN, so it is read once rather than waited on. A
// close that fails is reported with its recovery and does not undo the merge being counted. Answers
// whether the child is closed now.
async function close_merged_open(merged: MergedChild): Promise<boolean> {
	if (merged.merged_pr === undefined) return true

	try {
		await git_followup_issue_close.ensure_issue_closed(
			{ issue_number: merged.child, pr_url: merged.merged_pr, closer: MERGE_CLOSER },
			SINGLE_READ,
		)

		return true
	} catch {
		console.error(
			`${session_cite.issue(merged.child)}: could not be closed — ${git_followup_issue_close.CLOSE_RECOVERY}`,
		)

		return false
	}
}

// `run:merge`'s stdout carries only the next child or a verdict, so the epic auto-close's notes go to
// stderr for as long as it runs, beside this command's own notes.
function divert_info_to_stderr(): () => void {
	const { info } = console

	console.info = console.error

	return function restore(): void {
		console.info = info
	}
}

async function with_notes_on_stderr(step: () => Promise<void>): Promise<void> {
	const restore = divert_info_to_stderr()

	try {
		await step()
	} finally {
		restore()
	}
}

// Every other child `run:merge` counts as merged is already closed, whatever closed it — `followup`
// or `josh issue:measured` — so its epics are evaluated here, through the one entry every child close
// takes (`epic-close.ts`, #4560). A child still OPEN after a failed close is not: the auto-close
// treats the child as closed without reading it. An `already-done` child reads OPEN here and is
// parked; once a person closes it, the next child close sweeps its epic (`epic-close.ts`, #4564).
async function close_merged(merged: MergedChild): Promise<void> {
	if (!(await close_merged_open(merged))) return

	await with_notes_on_stderr(async () => {
		await epic_close.close_completed_epics({ issue_number: merged.child, is_merged: true })
	})
}

const run_merge_close = { close_merged }

export { run_merge_close }
