import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { require_pr_number } from '#scripts/gh/git-gh-pr-read'
import { git_closes_keyword } from '#scripts/git/git-closes-keyword'
import { git_spawn } from '#scripts/git/git-spawn'
import { REPOSITORY_LABELS } from '#scripts/issue/issue-label-definitions'
import { NEEDS_HUMAN_MERGE_LABEL } from '#scripts/issue/issue-labels'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

const WORKFLOW_PREFIX = '.github/workflows/'
const HEAD_CHANGED = 'The pull request head changed; rerun followup'
// `--no-relative` keeps every path root-relative whatever the `diff.relative` setting or cwd.
const DIFF_NAMES = ['diff', '--name-only', '--no-renames', '--no-relative', '-z']
const PULL_SCHEMA = z.object({
	base: z.object({ sha: z.string().min(1) }),
	head: z.object({ sha: z.string().min(1) }),
})

interface ComparisonCommits {
	base: string
	head: string
}

class HumanMergeRequiredError extends Error {
	override name = 'HumanMergeRequiredError'
}

function touches_workflow(paths: Array<string>): boolean {
	return paths.some((path) => path.startsWith(WORKFLOW_PREFIX))
}

async function comparison_commits(
	branch: string,
	expected_head: string | undefined,
): Promise<ComparisonCommits> {
	const number = await require_pr_number(branch)
	const pull_raw = await git_gh_exec.exec_gh_api({
		path: git_gh_api_path.pull_api_path(String(number)),
	})
	const pull = json_value.parse_with(pull_raw, PULL_SCHEMA)

	if (pull === undefined) throw new Error('Cannot read the pull request comparison commits')

	if (expected_head !== undefined && pull.head.sha !== expected_head) {
		throw new Error(HEAD_CHANGED)
	}

	return { base: pull.base.sha, head: pull.head.sha }
}

// GitHub's comparison listing stops at 300 files, so the complete listing comes from local git;
// `--no-renames` lists both sides of a rename, and a failed fetch or diff throws.
async function read_paths(
	branch: string,
	expected_head: string | undefined,
): Promise<Array<string>> {
	const { base, head } = await comparison_commits(branch, expected_head)

	await git_spawn.read_remote(['fetch', '--no-tags', 'origin', base, head])
	const raw = await git_spawn.read([...DIFF_NAMES, `${base}...${head}`])

	return raw.split('\0').filter((path) => path !== '')
}

async function mark_waiting(branch: string, issue: string | undefined): Promise<void> {
	const number =
		issue ?? git_closes_keyword.parse_closes_issue_number(await git_gh_command.pr_get_body(branch))
	if (number === undefined) throw new Error('The workflow pull request must identify its Issue')
	const definition = REPOSITORY_LABELS.find((label) => label.name === NEEDS_HUMAN_MERGE_LABEL)

	if (definition === undefined) throw new Error('The human merge label definition is missing')
	await git_gh_command.label_ensure(definition)

	if (!(await git_gh_command.issue_add_label(number, NEEDS_HUMAN_MERGE_LABEL))) {
		throw new Error('Could not label the Issue waiting for a human merge')
	}
}

async function assert_head(branch: string, expected_head: string | undefined): Promise<void> {
	if (expected_head === undefined) return
	const state = await git_gh_command.pr_get_merge_state(branch)

	if (state?.head_sha !== expected_head) {
		throw new Error(HEAD_CHANGED)
	}
}

// Compare immutable commits so a head moving away and back cannot substitute another diff.
async function assert_allowed(
	branch: string,
	issue: string | undefined,
	expected_head?: string,
): Promise<void> {
	const paths = await read_paths(branch, expected_head)

	await assert_head(branch, expected_head)
	if (!touches_workflow(paths)) return
	const url = await git_gh_command.pr_get_url(branch)

	if (url === undefined) throw new Error('Could not read the workflow pull request URL')
	await mark_waiting(branch, issue)
	throw new HumanMergeRequiredError(
		`Human merge required: ${url}\nRead the diff on GitHub and merge the pull request there.`,
	)
}

const followup_human_merge = { assert_allowed }

export { followup_human_merge, HumanMergeRequiredError }
