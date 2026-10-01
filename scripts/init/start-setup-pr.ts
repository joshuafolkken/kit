import { git_gh_api_path } from '#scripts/git/git-gh-api-path'
import { git_gh_exec } from '#scripts/git/git-gh-exec'
import { git_gh_issue_write } from '#scripts/git/git-gh-issue-write'
import { git_issue, type IssueInfo } from '#scripts/git/git-issue'
import { git_pr } from '#scripts/git/git-pr'
import { github_issue_url } from '#scripts/git/github-issue-url'
import { IGNORE_FOR_RELEASE_LABEL } from '#scripts/git/issue-labels'
import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'
import { kit_written_paths } from './kit-written-paths'
import { start_exec } from './start-exec'

const SETUP_TITLE = `Set up ${KIT_PACKAGE_NAME}`
const SETUP_BODY = [
	`Adds the files \`josh start\` wrote while setting up ${KIT_PACKAGE_NAME}, so main carries the`,
	'rules, settings and workflows every later Issue is run with. Only the files kit wrote are in the',
	'pull request; anything else in the working tree is left as it was.',
].join('\n')
const NOTHING_TO_COMMIT = 'The kit setup has no changes to commit, so no pull request was opened.'
const OPEN_SETUP_ISSUES_QUERY = `?state=open&labels=${IGNORE_FOR_RELEASE_LABEL}&per_page=100`
const FIRST_SETUP_ISSUE_FILTER = `[.[] | select(.title == "${SETUP_TITLE}") | .number][0] // empty`

function lines_of(output: string | undefined): Array<string> {
	return (output ?? '').split('\n').filter((line) => line.length > 0)
}

function setup_issue(issue_number: string): IssueInfo {
	return git_issue.parse(`${SETUP_TITLE} #${issue_number}`)
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
// listings, so nothing has to be parsed out of `git status`. Every kit path is ASCII, so git's
// quoting of other names never hides one.
function changed_paths(root: string): Array<string> {
	const untracked = start_exec.read_output(
		'git',
		['ls-files', '--others', '--exclude-standard'],
		root,
	)
	const modified = start_exec.read_output('git', ['diff', '--name-only', 'HEAD'], root)

	return [...lines_of(untracked), ...lines_of(modified)]
}

// The Issue carries the release classification the pull request is opened with, so the PR step finds
// one without a person adding it (joshuafolkken/kit#2816).
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

	if (start_exec.succeeds('git', ['rev-parse', '--verify', '--quiet', reference], root)) {
		throw new Error(
			`The setup branch ${branch} already exists. Run git switch ${branch}, then josh start again.`,
		)
	}

	start_exec.run('git', ['switch', '--create', branch], root)
}

// The paths are named on the commit as well as on the add, so anything the user had staged before
// stays out of the setup commit. The project's own hooks run, as on every other commit.
function commit_kit_paths(paths: ReadonlyArray<string>, issue: IssueInfo, root: string): void {
	if (paths.length === 0) return

	start_exec.run('git', ['add', '--', ...paths], root)
	start_exec.run('git', ['commit', '--message', issue.commit_message, '--', ...paths], root)
}

// Issue → branch → only kit's files committed → push → pull request. The merge is left to a person:
// it is the one step that changes main.
async function open(root: string): Promise<void> {
	const paths = kit_written_paths.select(changed_paths(root))

	if (paths.length === 0) {
		console.info(NOTHING_TO_COMMIT)

		return
	}

	const current = start_exec.read_output('git', ['symbolic-ref', '--short', 'HEAD'], root)
	const issue = resolve_issue(current)

	switch_to(issue.branch_name, current, root)
	commit_kit_paths(paths, issue, root)
	start_exec.run('git', ['push', '--set-upstream', 'origin', issue.branch_name], root)
	await git_pr.create_with_issue_info(issue)
}

const start_setup_pr = { open, changed_paths, is_setup_branch }

export { start_setup_pr }
