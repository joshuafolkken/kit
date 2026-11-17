import { backlog_triage_close, type CloseResult } from '#scripts/backlog/backlog-triage-close'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_command } from '#scripts/git/git-command'
import { git_diff_reads } from '#scripts/git/git-diff-reads'
import { issue_body_keys } from '#scripts/issue/issue-body-keys'
import { markdown_section } from '#scripts/issue/markdown-section'
import { session_cite } from '#scripts/issue/session-cite'
import { size_estimate } from '#scripts/issue/size-estimate'
import type { CutState } from './run-cut'
import { run_cut_report } from './run-cut-report'

// The end of a no-diff investigation lane (joshuafolkken/kit#7821): an Issue whose deliverable is a
// comment has nothing to cut or ship, so `run:cut <N> --deliverable <comment-url>` closes it as
// completed instead — but only on all three conditions: the body declares a 0-file estimate, every
// acceptance criterion is checked, and the lane changed no file. Any one missing keeps today's
// `unready` refusal, with the missing condition named. The close itself is `backlog-triage-close.ts`'s,
// so the adopt's not-planned close and this completed one stay one path; the parent's `run:merge`
// then collects the closed child as it collects a merged one.

const CHECKBOX = /^\s*-\s*\[(?<mark>[ xX])\]/u
const UNCHECKED_MARK = ' '

function unchecked_count(body: string): number {
	const lines = markdown_section.section_lines(body, issue_body_keys.heading('criteria'))
	const marks = markdown_section
		.unfenced_lines(lines.join('\n'))
		.map((line) => CHECKBOX.exec(line)?.groups?.['mark'])

	return marks.filter((mark) => mark === UNCHECKED_MARK).length
}

// The first missing condition as one line, or `undefined` when the lane may close as completed.
function missing_of(body: string, changed_files: number): string | undefined {
	const declared = size_estimate.declared_files(body)

	if (declared !== 0) {
		return `the body does not declare a 0-file size estimate (${String(declared)})`
	}

	if (changed_files > 0) return `the lane changed ${String(changed_files)} file(s)`

	const unchecked = unchecked_count(body)

	return unchecked > 0 ? `${String(unchecked)} acceptance criteria are unchecked` : undefined
}

function names_of(listing: string): ReadonlyArray<string> {
	return listing.split('\n').filter((name) => name.trim() !== '')
}

// Every file the lane differs from main by: committed, uncommitted and untracked.
async function changed_count(): Promise<number> {
	const changed = names_of(await git_diff_reads.diff_main_names())
	const untracked = names_of(await git_diff_reads.untracked_names())

	return new Set([...changed, ...untracked]).size
}

async function missing(issue: string): Promise<string | undefined> {
	const body = await git_gh_issue_read.issue_get_body(issue)

	if (body === undefined) return `the body of ${session_cite.issue(issue)} could not be read`

	return missing_of(body, await changed_count())
}

function report_closed(result: CloseResult): number {
	if ('problem' in result) return run_cut_report.report_fault(result.problem)

	console.error(result.next)

	return run_cut_report.report(run_cut_report.CONCLUDED_VERDICT, run_cut_report.SUCCESS_EXIT_CODE)
}

function hint_of(issue: string, note: string | undefined): string {
	if (note === undefined) {
		return `This no-diff investigation lane may close as completed: pnpm josh run:cut ${issue} --deliverable <comment-url>`
	}

	return `Not closable as a no-diff investigation: ${note}.`
}

// The answer to a cut on a tree that is not an uncommitted lane branch. A lane branch is checked for
// the no-diff close; the default branch keeps the bare refusal.
async function unready(issue: string, state: CutState, deliverable?: string): Promise<number> {
	if (state.branch === (await git_command.get_default_branch())) {
		return run_cut_report.refuse_unready(state)
	}

	const note = await missing(issue)

	if (note !== undefined || deliverable === undefined) {
		return run_cut_report.refuse_unready(state, hint_of(issue, note))
	}

	return report_closed(await backlog_triage_close.close_completed(issue, deliverable))
}

const run_cut_conclude = { missing_of, unready }

export { run_cut_conclude }
