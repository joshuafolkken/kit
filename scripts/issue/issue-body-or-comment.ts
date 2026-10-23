import { gh_author_association, type AuthorFields } from '#scripts/gh/gh-author-association'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { parse_json_object_or_undefined } from '#scripts/git/parse-json-array'
import { z } from 'zod'

// One text written to an issue: **into the body when the body is blank, as a comment otherwise.**
// Two writers make this decision — `followup`'s completion notice and `issue:plan`'s plan — and a copy
// per caller is how the two would come to disagree about what "blank" means.
//
// A body that could not be read is not blank: overwriting a body nobody saw could erase a person's
// text, so an unreadable body falls to a comment, which loses nothing.
//
// **A blank body filed by an author without write access is not written into either**
// (joshuafolkken/kit#4663). Readers judge a body by the issue's author, not by who last edited it, so
// a trusted `kickoff` plan written there would read as untrusted text, and `run:entry` — which waits
// for a trusted comment on such an issue — would never see the plan it waits for.

type Destination = 'body' | 'comment'

interface PostOutcome {
	destination: Destination
	url: string
}

const BODY_FIELDS = `body,${gh_author_association.AUTHOR_FIELDS}`

const body_schema = z.looseObject({
	body: z.string().nullish(),
	...gh_author_association.author_fields_schema,
})

function is_blank_body(body: string | null | undefined): boolean {
	return body?.trim().length === 0
}

// The write-access lookup asks *this* repository's collaborators, which says nothing about access to
// another one — so an issue elsewhere is asked with no login, which `trust_of` answers for `OWNER`
// alone (the rule `auto-ok-author.ts` applies to an epic child in another repository).
async function is_author_trusted(row: AuthorFields, repo?: string): Promise<boolean> {
	const author = gh_author_association.author_of(row)

	return await gh_author_association.is_trusted(
		repo === undefined ? author : { ...author, login: undefined },
	)
}

// Whether the body is blank *and* its author has write access — a failed read is neither.
async function is_writable_body(issue_number: string, repo?: string): Promise<boolean> {
	const json = await git_gh_command.issue_view_json(issue_number, BODY_FIELDS, repo)
	const parsed = json === undefined ? undefined : parse_json_object_or_undefined(json, body_schema)

	if (parsed === undefined || !is_blank_body(parsed.body ?? '')) return false

	return await is_author_trusted(parsed, repo)
}

// `repo` (`owner/name`) addresses an issue in another repository; left out, the checkout's own.
async function post(issue_number: string, text: string, repo?: string): Promise<PostOutcome> {
	if (await is_writable_body(issue_number, repo)) {
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
