import { existsSync } from 'node:fs'
import path from 'node:path'
import { gh_author_association } from '#scripts/gh/gh-author-association'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { parse_json, parse_json_array_safe } from '#scripts/git/parse-json-array'
import { session_cite } from '#scripts/issue/session-cite'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { observation_ledger_line } from '#scripts/observations/observation-ledger-line'
import { z } from 'zod'
import { review_finding_ledger } from './review-finding-ledger'

// A review round recorded after its pull request opened (`josh review:record --comment`), and how its
// lines reach the ledger's readers (joshuafolkken/kit#3811). The round is posted on the issue because
// a ledger line written then would be pushed onto the open pull request and restart its CI — and so
// nothing that reads the ledger (`review:findings`, the retrospective) ever saw it.
//
// **The next run outside a lane that records a round carries it, or the next flush.** Once an issue
// is closed no round is added to it, so `review:record` copies each closed issue's comment rounds not yet carried into
// `<issue>-comment-rounds.md` in the ledger, and the lines ride that run's own commit: the ledger stays
// the one place a reader looks, and no push restarts any CI. **The file is the carried mark** — an
// issue whose file exists is never read again. **A lane child carries none** (joshuafolkken/kit#5326):
// parallel lanes each wrote the same file and waited and conflicted on it, so `observations:flush`
// carries for them on the default branch (`review-comment-carry.ts`).
//
// **An observation-ledger line written while the pull request is open rides the same carry**
// (joshuafolkken/kit#5197): `followup` reruns a CI job red only outside the change during its CI wait,
// after the ledger's last commit, so the sighting is posted under its own heading and carried with the
// rounds.

const COMMENT_HEADING_MARK = '### '
const COMMENT_TITLE = 'Review round recorded after the pull request opened'
const OBSERVATION_TITLE = 'Observation recorded while the pull request was open'
const COMMENT_TITLES = [COMMENT_TITLE, OBSERVATION_TITLE]
const COMMENT_HEADINGS = COMMENT_TITLES.map((title) => `${COMMENT_HEADING_MARK}${title}`)
const COMMENT_NOTE =
	'Kept here rather than in the observation ledger: a line appended after the commit would be pushed onto the open pull request and restart its CI.'
const CODE_FENCE = '```'
const OBSERVATION_LINE_MARK = '- k:'
const CARRIED_SUFFIX = '-comment-rounds'
const CARRIED_FILE_PATTERN = new RegExp(String.raw`^\d+${CARRIED_SUFFIX}\.md$`, 'u')
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

function body_under(title: string, lines: ReadonlyArray<string>): string {
	const heading = `${COMMENT_HEADING_MARK}${title}`

	return [heading, '', COMMENT_NOTE, '', CODE_FENCE, ...lines, CODE_FENCE].join('\n')
}

function body_of(lines: ReadonlyArray<string>): string {
	return body_under(COMMENT_TITLE, lines)
}

function observation_body_of(lines: ReadonlyArray<string>): string {
	return body_under(OBSERVATION_TITLE, lines)
}

function is_carried_line(line: string): boolean {
	if (review_finding_ledger.is_finding_line(line)) return true

	return (
		line.startsWith(OBSERVATION_LINE_MARK) &&
		observation_ledger_line.line_reason(line) === undefined
	)
}

function is_round(comment: IssueComment): boolean {
	const body = comment.body ?? ''

	return COMMENT_HEADINGS.some((heading) => body.startsWith(heading))
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
	const rounds = comments.filter((comment) => is_round(comment))
	const trusted = await Promise.all(
		rounds.map(async (comment) => await is_trusted_comment(comment)),
	)

	return rounds
		.filter((_comment, index) => trusted[index] === true)
		.flatMap((comment) => (comment.body ?? '').split('\n'))
		.filter((line) => is_carried_line(line))
}

function search_path(repo: string, title: string): string {
	const query = `repo:${repo} is:issue is:closed in:comments "${title}"`
	const parameters = new URLSearchParams({ q: query, sort: 'updated', per_page: PER_PAGE })

	return `search/issues?${parameters.toString()}`
}

async function search(repo: string, title: string): Promise<ReadonlyArray<number>> {
	const raw = await git_gh_exec.exec_gh_api({ path: search_path(repo, title) })
	const page = parse_json.parse_json_object_or_undefined(raw, search_schema)

	if (page === undefined) throw new Error(UNREAD_SEARCH)

	return page.items.map((item) => item.number)
}

// The closed issues whose comments name a comment round of either heading; a repository that cannot be
// named or a search that cannot be read throws, so the run says so rather than carrying nothing in
// silence.
async function closed_issues(): Promise<ReadonlyArray<number>> {
	const repo = session_cite.session_repo()

	if (repo === undefined) throw new Error(UNNAMED_REPOSITORY)

	const pages = await Promise.all(COMMENT_TITLES.map(async (title) => await search(repo, title)))

	return [...new Set(pages.flat())]
}

function carried_path(issue: number, root: string): string {
	return observation_ledger_home.file_path(`${String(issue)}${CARRIED_SUFFIX}`, root)
}

// A path this carry writes, told by its file name alone so a git status path answers it too.
function is_carried_file(file_path: string): boolean {
	return CARRIED_FILE_PATTERN.test(path.basename(file_path))
}

// One issue's comment-round lines. Comments that could not be read throw, so no caller reads an
// unread issue as one without a round.
async function issue_lines(issue: number): Promise<Array<string>> {
	const raw = await git_gh_issue_read.issue_list_comments(String(issue))

	if (raw === undefined) throw new Error(`${UNREAD_COMMENTS} ${session_cite.issue(issue)}`)

	return await lines_of(parse_json_array_safe(raw, comment_schema))
}

// An issue whose comments could not be read writes no file, so the next run reads it again, and
// throws so this one says so.
async function carry_issue(issue: number, root: string): Promise<number> {
	const lines = await issue_lines(issue)

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

const review_comment_round = {
	body_of,
	carried_path,
	carry,
	is_carried_file,
	issue_lines,
	lines_of,
	observation_body_of,
}

export { review_comment_round }
