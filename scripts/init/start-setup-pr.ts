import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { git_pr } from '#scripts/gh/git-pr'
import { github_issue_url } from '#scripts/gh/github-issue-url'
import { git_issue, type IssueInfo } from '#scripts/git/git-issue'
import { issue_cite } from '#scripts/issue/issue-cite'
import { IGNORE_FOR_RELEASE_LABEL } from '#scripts/issue/issue-labels'
import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'
import { kit_written_paths } from './kit-written-paths'
import { start_exec } from './start-exec'

const SETUP_TITLE = `Set up ${KIT_PACKAGE_NAME}`
const SETUP_BODY = [
	`Adds the files \`josh start\` wrote while setting up ${KIT_PACKAGE_NAME}, so main carries the`,
	'rules, settings and workflows every later Issue is run with. Only the files the setup wrote are in',
	'the pull request; anything else in the working tree is left as it was.',
].join('\n')
const NAME_ONLY = '--name-only'
const NOTHING_TO_COMMIT = 'The kit setup has no changes to commit, so no pull request was opened.'
const OPEN_SETUP_ISSUES_QUERY = `?state=open&labels=${IGNORE_FOR_RELEASE_LABEL}&per_page=100`
const FIRST_SETUP_ISSUE_FILTER = `[.[] | select(.title == "${SETUP_TITLE}") | .number][0] // empty`

// Listings are read NUL-separated (`-z`), so a path is never quoted — a name a caller's initialize
// command wrote need not be ASCII the way kit's own are (#2872).
function paths_of(output: string | undefined = ''): Array<string> {
	return output.split('\0').filter((listed) => listed.length > 0)
}

function listing(args: ReadonlyArray<string>, root: string): Array<string> {
	return paths_of(start_exec.git_read([...args, '-z'], root))
}

function setup_issue(issue_number: string): IssueInfo {
	return git_issue.parse(`${SETUP_TITLE} ${issue_cite.plain(issue_number)}`)
}

// The Issue number when `branch` is the branch an earlier `josh start` created for the setup pull
// request — the branch a failed commit or push leaves checked out, so a re-run resumes there.
function setup_branch_number(branch: string | undefined): string | undefined {
	const issue_number = branch === undefined ? undefined : git_issue.branch_number(branch)

	if (issue_number === undefined) return undefined

	return setup_issue(issue_number).branch_name === branch ? issue_number : undefined
}

function is_setup_branch(branch: string | undefined): boolean {
	return setup_branch_number(branch) !== undefined
}

// Untracked files the ignore rules let through, plus tracked files the setup changed — two plain
// listings, so nothing has to be parsed out of `git status`.
function changed_paths(root: string): Array<string> {
	const untracked = listing(['ls-files', '--others', '--exclude-standard'], root)
	const modified = listing(['diff', NAME_ONLY, 'HEAD'], root)

	return [...untracked, ...modified]
}

// On the setup branch a failed commit left, that run's `git add` already staged its files, so they
// read as changed before this run's command ran — the staged ones count as setup output (#2872).
function carried_paths(root: string, current: string | undefined): Array<string> {
	return is_setup_branch(current) ? listing(['diff', NAME_ONLY, '--cached'], root) : []
}

// The Issue carries the release classification the pull request is opened with, so the PR step finds
// one without a person adding it.
function file_setup_issue(): string {
	const request = git_gh_issue_write.issue_create_request({
		title: SETUP_TITLE,
		body: SETUP_BODY,
		labels: [IGNORE_FOR_RELEASE_LABEL],
	})
	const url = git_gh_exec.exec_gh_api_sync(request)
	const issue_number = github_issue_url.parse(url)?.issue_number

	if (issue_number === undefined) throw new Error(`Could not read the Issue number from ${url}`)

	return issue_number
}

function open_setup_issue_number(): string | undefined {
	const issue_number = git_gh_exec.exec_gh_api_sync({
		path: `${git_gh_api_path.issues_api_path()}${OPEN_SETUP_ISSUES_QUERY}`,
		jq_filter: FIRST_SETUP_ISSUE_FILTER,
	})

	return issue_number.length > 0 ? issue_number : undefined
}

// A re-run after a failed hook reuses what the failed run made — the branch it left checked out, or
// the setup Issue still open — so no Issue is filed twice.
function resolve_issue(branch: string | undefined): IssueInfo {
	const reused = setup_branch_number(branch) ?? open_setup_issue_number()

	return setup_issue(reused ?? file_setup_issue())
}

// An existing setup branch seen from another branch is not switched to: the setup just rewrote kit's
// files in this working tree, and a checkout would refuse to overwrite them part-way through.
function switch_to(branch: string, current: string | undefined, root: string): void {
	if (current === branch) return

	const reference = `refs/heads/${branch}`

	if (start_exec.git_succeeds(['rev-parse', '--verify', '--quiet', reference], root)) {
		throw new Error(
			`The setup branch ${branch} already exists. Run git switch ${branch}, then josh start again.`,
		)
	}

	start_exec.git_run(['switch', '--create', branch], root)
}

// The paths are named on the commit as well as on the add, so anything the user had staged before
// stays out of the setup commit. The project's own hooks run, as on every other commit.
function commit_kit_paths(paths: ReadonlyArray<string>, issue: IssueInfo, root: string): void {
	if (paths.length === 0) return

	start_exec.git_run(['add', '--', ...paths], root)
	start_exec.git_run(['commit', '--message', issue.commit_message, '--', ...paths], root)
}

// A caller's initialize command writes files kit cannot name, so with a `baseline` — what was already
// changed before that command ran — everything changed since joins kit's own files, while a change
// the user had made before the run still stays out (#2872).
function setup_paths(
	root: string,
	baseline: ReadonlyArray<string> | undefined,
	current: string | undefined,
): Array<string> {
	const changed = changed_paths(root)
	const kit_paths = kit_written_paths.select(changed)

	if (baseline === undefined) return kit_paths

	const carried = carried_paths(root, current)
	const written = changed.filter((path) => !baseline.includes(path) || carried.includes(path))

	return [...new Set([...kit_paths, ...written])]
}

// Issue → branch → only the setup's files committed → push → pull request. The merge is left to a
// person: it is the one step that changes main.
async function open(root: string, baseline?: ReadonlyArray<string>): Promise<void> {
	const current = start_exec.git_read(['symbolic-ref', '--short', 'HEAD'], root)
	const paths = setup_paths(root, baseline, current)

	if (paths.length === 0) {
		console.info(NOTHING_TO_COMMIT)

		return
	}

	const issue = resolve_issue(current)

	switch_to(issue.branch_name, current, root)
	commit_kit_paths(paths, issue, root)
	start_exec.git_run(['push', '--set-upstream', 'origin', issue.branch_name], root)
	await git_pr.create_with_issue_info(issue)
}

const start_setup_pr = { open, changed_paths, is_setup_branch }

export { start_setup_pr }
