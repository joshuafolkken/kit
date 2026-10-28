import { epic_graph, type EpicChild } from '#scripts/epic/epic-graph'
import { gh_author_association } from '#scripts/gh/gh-author-association'
import type { OpenIssueData } from '#scripts/git/git-schemas'

// Whether an unattended run may act on an opted-in issue's body. The run takes that body as its
// specification, and on a public repository anyone can file an issue — the `auto-ok` a person applied
// says nothing about a body its author rewrote after the label. So only an issue whose author has
// write access is runnable, and a lookup that failed is not trust; the rest wait on a person.

async function with_trust(issue: OpenIssueData): Promise<OpenIssueData> {
	const author = gh_author_association.author_of(issue)

	return { ...issue, author_trusted: await gh_author_association.is_trusted(author) }
}

async function with_author_trust(
	issues: ReadonlyArray<OpenIssueData>,
): Promise<Array<OpenIssueData>> {
	return await Promise.all(issues.map(async (issue) => await with_trust(issue)))
}

function is_author_trusted(issue: OpenIssueData): boolean {
	return issue.author_trusted === true
}

// An epic child's body is run just the same, so the same rule holds for it (joshuafolkken/kit#4633).
// The write-access lookup asks *this* repository's collaborators, which says nothing about access to
// another one — so a child elsewhere is asked with no login, which `trust_of` answers for `OWNER` alone.
async function is_child_trusted(child: EpicChild, repo: string): Promise<boolean> {
	const author = gh_author_association.author_of(child)

	return await gh_author_association.is_trusted(
		child.repo === repo ? author : { ...author, login: undefined },
	)
}

// The keys of the open children whose author is not trusted — a child read without author fields
// among them, since an unknown author is not a trusted one.
async function untrusted_child_keys(
	children: ReadonlyArray<EpicChild>,
	repo: string,
): Promise<ReadonlySet<string>> {
	const open = children.filter((child) => child.state === 'OPEN')
	const trusted = await Promise.all(open.map(async (child) => await is_child_trusted(child, repo)))

	const untrusted = open.filter((_, index) => trusted[index] !== true)

	return new Set(untrusted.map((child) => epic_graph.key_of(child)))
}

const auto_ok_author = { is_author_trusted, untrusted_child_keys, with_author_trust }

export { auto_ok_author }
