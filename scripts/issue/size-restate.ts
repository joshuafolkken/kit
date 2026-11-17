import { git_gh_command } from '#scripts/gh/git-gh-command'
import { size_estimate } from './size-estimate'

// joshuafolkken/kit#5758, #7726: a record that states a size estimate line — an epic decision, or a
// plan whose named files outgrew the filing's estimate — restates the issue's own, so `lane:plan` and
// the dispatch judgment read the estimate the record settled on rather than the one filed before it.

async function try_edit_body(issue_number: string, body: string, repo?: string): Promise<boolean> {
	try {
		await git_gh_command.issue_edit_body(issue_number, body, repo)

		return true
	} catch {
		return false
	}
}

// `body` restated with `record`'s estimate line and written back; `true` when nothing needed writing,
// `false` when the write failed.
async function apply(
	issue_number: string,
	body: string,
	record: string,
	repo?: string,
): Promise<boolean> {
	const line = size_estimate.stated_line(record)
	if (line === undefined) return true
	const restated = size_estimate.restated(body, line)

	return restated === body || (await try_edit_body(issue_number, restated, repo))
}

const size_restate = { apply }

export { size_restate }
