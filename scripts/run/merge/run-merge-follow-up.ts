import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_file_fold } from '#scripts/issue/issue-file-fold'
import { issue_measured_follow_up } from '#scripts/issue/issue-measured-follow-up'
import { issue_read } from '#scripts/issue/issue-read'
import { error_text } from '#scripts/lib/error-message'

// A merged child's follow-up lines no `FILED` event of its own carries (joshuafolkken/kit#9063): a
// measurement's lane child writes them in its evidence comment and the parent files each
// (`issue-measured-follow-up.ts`), so `run:merge` names the ones still unfiled. It only names them —
// no filing — and a failed read skips the check with one line, never failing the merge.

const COMMENT_FIELDS = 'number'

async function follow_up_titles(child: string): Promise<ReadonlyArray<string>> {
	const { comments_json } = await git_gh_command.issue_read_with_comments(child, COMMENT_FIELDS)
	const comments = await issue_read.parse_comments(comments_json)

	if (comments === undefined) throw new Error('comments not read')

	return issue_read
		.trusted_bodies(comments)
		.flatMap((body) => issue_measured_follow_up.titles_of(body))
}

async function filed_titles(child: string): Promise<ReadonlyArray<string>> {
	const events = await issue_file_fold.events_of(child)

	return issue_file_fold.finder_filings(events, child).map((filed) => filed.title)
}

async function unfiled_of(child: string): Promise<ReadonlyArray<string>> {
	const titles = await follow_up_titles(child)

	if (titles.length === 0) return titles

	return issue_measured_follow_up.unfiled(titles, await filed_titles(child))
}

async function check(child: string): Promise<void> {
	const cite = issue_cite.plain_for('program', child)

	try {
		const unfiled = await unfiled_of(child)

		if (unfiled.length === 0) return

		const heading = `Unfiled follow-ups ${cite} names — file each:`

		console.info(issue_measured_follow_up.lines_of(heading, unfiled, child))
	} catch (error) {
		console.info(`Follow-up check skipped for ${cite}: ${error_text.message_of(error)}`)
	}
}

const run_merge_follow_up = { check }

export { run_merge_follow_up }
