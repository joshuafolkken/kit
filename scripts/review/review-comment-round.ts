import { existsSync } from 'node:fs'
import { gh_author_association } from '#scripts/gh/gh-author-association'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { parse_json, parse_json_array_safe } from '#scripts/git/parse-json-array'
import { session_cite } from '#scripts/issue/session-cite'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { z } from 'zod'
import { review_finding_ledger } from './review-finding-ledger'

// A review round recorded after its pull request opened (`josh review:record --comment`), and how its
// lines reach the ledger's readers (joshuafolkken/kit#3811). The round is posted on the issue because
// a ledger line written then would be pushed onto the open pull request and restart its CI — and so
// nothing that reads the ledger (`review:findings`, the retrospective) ever saw it.
//
// **The next run that records a round carries it.** Once an issue is closed no round is added to it,
// so `review:record` copies each closed issue's comment rounds not yet carried into
// `<issue>-comment-rounds.md` in the ledger, and the lines ride that run's own commit: the ledger stays
// the one place a reader looks, and no push restarts any CI. **The file is the carried mark** — an
// issue whose file exists is never read again, and two lanes carrying one issue write the same file,
// so their pull requests merge to the same lines.

const COMMENT_HEADING_MARK = '### '
const COMMENT_TITLE = 'Review round recorded after the pull request opened'
const COMMENT_HEADING = `${COMMENT_HEADING_MARK}${COMMENT_TITLE}`
const COMMENT_NOTE =
	'Kept here rather than in the observation ledger: a line appended after the commit would be pushed onto the open pull request and restart its CI.'
const CODE_FENCE = '```'
const CARRIED_SUFFIX = '-comment-rounds'
// One page of the newest closed issues: an issue leaves the search's interest once carried, so the
// ones still to carry are the recently closed.
const PER_PAGE = '100'
const UNNAMED_REPOSITORY = 'Could not name this repository from `git remote`.'
const UNREAD_SEARCH = 'Could not read the search for closed issues with a comment round.'
const UNREAD_COMMENTS = 'Could not read the comments of'
const UNREAD_PERMISSION = 'Could not read the write permission of'

const search_item_schema = z.object({ number: z.number() })
const search_schema = z.object({ items: z.array(search_item_schema) })
const comment_schema = z.object({
	body: z.string().nullish(),
	author_association: z.string().nullish(),
	user: z.looseObject({ login: z.string() }).nullish(),
})

type IssueComment = z.infer<typeof comment_schema>

function body_of(lines: ReadonlyArray<string>): string {
	return [COMMENT_HEADING, '', COMMENT_NOTE, '', CODE_FENCE, ...lines, CODE_FENCE].join('\n')
}

// The ledger lines of every comment round among one issue's comments, oldest first; any other
// comment, one that only quotes the heading among them, carries none — nor does one whose author
// cannot write to the repository: anyone can comment on a public issue, and the carried lines ride
// the run's commit unreviewed. A permission lookup that failed throws instead: the carried file is
// written once, so a round dropped on a transient failure would never be carried.
async function is_trusted_comment(comment: IssueComment): Promise<boolean> {
	const login = comment.user?.login
	const is_trusted = await gh_author_association.trust_of({
		login,
		association: comment.author_association,
	})

	if (is_trusted === undefined) throw new Error(`${UNREAD_PERMISSION} ${login ?? ''}`)

	return is_trusted
}

async function lines_of(comments: ReadonlyArray<IssueComment>): Promise<Array<string>> {
	const rounds = comments.filter((comment) => (comment.body ?? '').startsWith(COMMENT_HEADING))
	const trusted = await Promise.all(
		rounds.map(async (comment) => await is_trusted_comment(comment)),
	)

	return rounds
		.filter((_comment, index) => trusted[index] === true)
		.flatMap((comment) => (comment.body ?? '').split('\n'))
		.filter((line) => review_finding_ledger.is_finding_line(line))
}

function search_path(repo: string): string {
	const query = `repo:${repo} is:issue is:closed in:comments "${COMMENT_TITLE}"`
	const parameters = new URLSearchParams({ q: query, sort: 'updated', per_page: PER_PAGE })

	return `search/issues?${parameters.toString()}`
}

// The closed issues whose comments name a comment round; a repository that cannot be named or a
// search that cannot be read throws, so the run says so rather than carrying nothing in silence.
async function closed_issues(): Promise<ReadonlyArray<number>> {
	const repo = session_cite.session_repo()

	if (repo === undefined) throw new Error(UNNAMED_REPOSITORY)

	const raw = await git_gh_exec.exec_gh_api({ path: search_path(repo) })
	const page = parse_json.parse_json_object_or_undefined(raw, search_schema)

	if (page === undefined) throw new Error(UNREAD_SEARCH)

	return page.items.map((item) => item.number)
}

function carried_path(issue: number, root: string): string {
	return observation_ledger_home.file_path(`${String(issue)}${CARRIED_SUFFIX}`, root)
}

// An issue whose comments could not be read writes no file, so the next run reads it again, and
// throws so this one says so.
async function carry_issue(issue: number, root: string): Promise<number> {
	const raw = await git_gh_issue_read.issue_list_comments(String(issue))

	if (raw === undefined) throw new Error(`${UNREAD_COMMENTS} ${session_cite.issue(issue)}`)

	const lines = await lines_of(parse_json_array_safe(raw, comment_schema))

	await observation_ledger_home.append(carried_path(issue, root), lines)

	return lines.length
}

// Copies every closed issue's comment rounds not yet in the ledger, and answers how many lines.
async function carry(root: string): Promise<number> {
	const issues = await closed_issues()
	const pending = issues.filter((issue) => !existsSync(carried_path(issue, root)))
	const counts = await Promise.all(pending.map(async (issue) => await carry_issue(issue, root)))

	return counts.reduce((total, count) => total + count, 0)
}

const review_comment_round = { body_of, carried_path, carry, lines_of }

export { review_comment_round }
