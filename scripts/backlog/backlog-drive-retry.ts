import { epic_issue, type EpicIssue } from '#scripts/epic/epic-issue'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_cite } from '#scripts/issue/issue-cite'
import { josh_command } from '#scripts/josh/josh-run'
import { run_add_issue } from '#scripts/run/add/run-add-issue'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { backlog_drive_restore } from './backlog-drive-restore'

function is_ready(issue: EpicIssue, cause: number, repo: string): boolean {
	const references = epic_issue.blocker_references_of(issue, repo)
	const is_dependent = references.some(
		(reference) =>
			reference.number === cause && reference.repo.toLowerCase() === repo.toLowerCase(),
	)

	return (
		epic_issue.is_open(issue.state) &&
		is_dependent &&
		(issue.blockedBy?.nodes ?? []).every(
			(blocker) => epic_issue.normalize_state(blocker.state ?? '') === epic_issue.CLOSED,
		)
	)
}

async function retry_one(issue: number, cause: number, repo: string): Promise<void> {
	const read = await run_add_issue.read(issue)
	const citation = issue_cite.reference(repo, String(issue), undefined)

	if (read === undefined) throw new Error(`Could not read all dependencies of ${citation}.`)
	if (!is_ready(read, cause, repo)) return

	const result = await josh_command.josh_run(['run:add', String(issue), '--retry'], true)

	if (result.code !== 0) throw new Error(`Could not retry ${citation} after its cause merged.`)
}

async function retry_all(
	issues: ReadonlyArray<number>,
	cause: number,
	repo: string,
): Promise<void> {
	const [issue, ...rest] = issues

	if (issue === undefined) return
	await retry_one(issue, cause, repo)
	await retry_all(rest, cause, repo)
}

async function after_merge(cause: number): Promise<void> {
	const events = await run_event_stream_emit.current_events(true)
	const parked = backlog_drive_restore.parked_issues(events)

	if (parked.size === 0) return
	const repo = await git_gh_command.repo_get_name_with_owner()

	if (repo === undefined) throw new Error('Could not resolve the repository for dependent retries.')
	await retry_all([...parked], cause, repo)
}

export const backlog_drive_retry = { after_merge }
