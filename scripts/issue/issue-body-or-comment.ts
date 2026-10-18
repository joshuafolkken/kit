import { git_gh_command } from '#scripts/gh/git-gh-command'

// One text written to an issue: **into the body when the body is blank, as a comment otherwise.**
// Two writers make this decision — `followup`'s completion notice and `issue:plan`'s plan — and a copy
// per caller is how the two would come to disagree about what "blank" means.
//
// A body that could not be read is not blank: overwriting a body nobody saw could erase a person's
// text, so an unreadable body falls to a comment, which loses nothing.

type Destination = 'body' | 'comment'

interface PostOutcome {
	destination: Destination
	url: string
}

function is_blank_body(body: string | undefined): boolean {
	return body?.trim().length === 0
}

// `repo` (`owner/name`) addresses an issue in another repository; left out, the checkout's own.
async function post(issue_number: string, text: string, repo?: string): Promise<PostOutcome> {
	const current_body = await git_gh_command.issue_get_body(issue_number, repo)

	if (is_blank_body(current_body)) {
		const url = await git_gh_command.issue_edit_body(issue_number, text, repo)

		return { destination: 'body', url }
	}

	return {
		destination: 'comment',
		url: await git_gh_command.issue_comment(issue_number, text, repo),
	}
}

const issue_body_or_comment = { post }

export { issue_body_or_comment }
export type { Destination, PostOutcome }
