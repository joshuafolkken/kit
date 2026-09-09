import { git_epic_close } from './git-epic-close'
import { git_followup_cleanup } from './git-followup-cleanup'
import { git_followup_stages, type StageLog } from './git-followup-stages'
import { git_gh_command } from './git-gh-command'
import { git_notify, type GitNotifyConfig } from './git-notify'

const { STAGE, lap } = git_followup_stages

// **Both destinations, because the step writes to whichever the notify target names.** A hint that
// only covered the issue would send the reader to the wrong place after a `--notify-target pr` run
// failed, which is the same defect as naming a command that cannot do the step at all.
const COMPLETION_COMMENT_RECOVERY =
	'post the completion report by hand — `gh pr comment <branch>` for the pull request, ' +
	'`gh api repos/{owner}/{repo}/issues/<N>/comments` for the issue'

// Everything from the merge gate opening onwards. Split out of `git-pr-followup.ts` because that file
// had eight code lines of headroom left, and cut here because this is where the run stops being able
// to fail safely: past the merge, the branch is gone and re-running the command is not a recovery.
interface WrapupInput {
	branch_name: string
	issue_number: string | undefined
	notify_config: GitNotifyConfig | undefined
	pr_url: string | undefined
	should_merge: boolean
	// The managed config-file report, which reaches the completion report on the Issue as well as the
	// completion notification (joshuafolkken/kit#1592). Empty on a run that changed nothing `josh sync`
	// distributes, and an empty one adds no line.
	managed_notes: ReadonlyArray<string>
}

function build_notify_body(input: {
	notify_config: GitNotifyConfig
	issue_number: string | undefined
	pr_url: string | undefined
	managed_notes: ReadonlyArray<string>
}): string {
	return git_notify.build_completion_comment_body({
		message: input.notify_config.message,
		issue_number: input.issue_number,
		pr_url: input.pr_url,
		mentions: input.notify_config.mentions,
		notes: input.managed_notes,
	})
}

function is_blank_issue_body(body: string | undefined): boolean {
	if (body === undefined) return true

	return body.trim().length === 0
}

async function post_notify_issue(input: {
	issue_number: string | undefined
	body: string
}): Promise<void> {
	if (input.issue_number === undefined) {
		throw new Error('Issue number is required for issue notification.')
	}

	const current_body = await git_gh_command.issue_get_body(input.issue_number)
	const should_edit_body = current_body !== undefined && is_blank_issue_body(current_body)

	await (should_edit_body
		? git_gh_command.issue_edit_body(input.issue_number, input.body)
		: git_gh_command.issue_comment(input.issue_number, input.body))
}

function should_notify_pr(target: GitNotifyConfig['target']): boolean {
	return target === 'pr' || target === 'both'
}

function should_notify_issue(target: GitNotifyConfig['target']): boolean {
	return target === 'issue' || target === 'both'
}

async function post_completion_notification(input: {
	branch_name: string
	issue_number: string | undefined
	notify_config: GitNotifyConfig | undefined
	pr_url: string | undefined
	managed_notes: ReadonlyArray<string>
}): Promise<void> {
	if (input.notify_config === undefined) return

	const body = build_notify_body({
		notify_config: input.notify_config,
		issue_number: input.issue_number,
		pr_url: input.pr_url,
		managed_notes: input.managed_notes,
	})
	const { target } = input.notify_config

	if (should_notify_pr(target)) {
		await git_gh_command.pr_comment(input.branch_name, body)
	}

	if (should_notify_issue(target)) {
		await post_notify_issue({ issue_number: input.issue_number, body })
	}
}

// **Guarded only once the merge has landed** (joshuafolkken/kit#1539) — the rule and its reason are
// `git-followup-cleanup.ts`, so this module and the run's tail cannot disagree about it. After the
// merge, a step that throws is reported and the ones after it still run, rather than taking the epic
// close and the working-tree hold release down with it.
async function notify_step(input: WrapupInput): Promise<void> {
	await git_followup_cleanup.run_guarded_step(input.should_merge, {
		label: 'The completion comment',
		recovery: COMPLETION_COMMENT_RECOVERY,
		run: async () => {
			await post_completion_notification({
				branch_name: input.branch_name,
				issue_number: input.issue_number,
				notify_config: input.notify_config,
				pr_url: input.pr_url,
				managed_notes: input.managed_notes,
			})
		},
	})
}

// No `recovery`: the auto-close has no command of its own, and naming `epic:audit` — which only
// reports contradictions — would send the reader somewhere that closes nothing. The epic's own task
// list is what says which children are done.
async function epic_close_step(input: WrapupInput): Promise<void> {
	await git_followup_cleanup.run_guarded_step(input.should_merge, {
		label: 'The epic auto-close',
		recovery: undefined,
		run: async () => {
			await git_epic_close.close_completed_epics({
				issue_number: input.issue_number,
				is_merged: input.should_merge,
			})
		},
	})
}

// **The two steps after the merge are issued together** (joshuafolkken/kit#1446). The completion
// comment writes to the issue or the pull request and the auto-close reads the open epics; neither
// needs the other's answer, and measured serially they were 1.9 s and 3.1 s of `followup`'s own
// clock. Past the merge neither can reject either — `run_guarded_step` reports the failure and
// answers instead — so the two settle independently and the stage costs the longer of them rather
// than their sum.
//
// **A run that merged nothing keeps them in sequence, because there is nothing to overlap.**
// `close_completed_epics` returns immediately without `is_merged`, so the second step is a no-op on
// exactly the path that stays serial — and there the guard is off, so a failure still ends the run
// and re-running the command is the whole recovery (`git-followup-cleanup.ts`), which is easier to
// read as one sequence than as a settled pair.
//
// **What the overlap costs, stated rather than glossed**: two mutating requests now go out at once
// against one repository — a comment write beside an auto-close that comments on and closes epics —
// which is what GitHub's secondary rate limit guidance is about. Past the merge both are guarded, so
// the worst case is a cleanup reported as unfinished rather than a failed run, and the pair is two
// requests rather than a fan-out. **Their console output can interleave too**: the guard's warning
// and its recovery line are printed as they happen, so an auto-close progress line can land between
// them. The recovery line names its own command and stands on its own, so it is still readable out
// of order — and the alternative, buffering one step's output until the other settles, would hold
// back a warning about work that has already failed.
async function run_tail_steps(input: WrapupInput): Promise<void> {
	if (!input.should_merge) {
		await notify_step(input)
		await epic_close_step(input)

		return
	}

	await Promise.all([notify_step(input), epic_close_step(input)])
}

async function run_wrapup(input: WrapupInput, log: StageLog): Promise<void> {
	if (input.should_merge) {
		await git_gh_command.pr_merge(input.branch_name)
		lap(log, STAGE.merge)
	}

	await run_tail_steps(input)

	lap(log, STAGE.completion_and_epic_close)
}

const git_pr_followup_wrapup = {
	run_wrapup,
}

export {
	git_pr_followup_wrapup,
	post_notify_issue,
	post_completion_notification,
	is_blank_issue_body,
	build_notify_body,
}
export type { WrapupInput }
