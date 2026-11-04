import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { require_pr_number } from '#scripts/gh/git-gh-pr-read'
import { git_closes_keyword } from '#scripts/git/git-closes-keyword'
import { NEEDS_HUMAN_MERGE_LABEL, REPOSITORY_LABELS } from '#scripts/issue/issue-labels'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

const WORKFLOW_PREFIX = '.github/workflows/'
// GitHub truncates comparisons at 300 files; an incomplete listing cannot authorize a merge.
const FILE_LIMIT = 300
const HEAD_CHANGED = 'The pull request head changed; rerun followup'
const FILES_SCHEMA = z.array(
	z.object({ filename: z.string(), previous_filename: z.string().optional() }),
)
const PULL_SCHEMA = z.object({
	base: z.object({ sha: z.string().min(1) }),
	head: z.object({ sha: z.string().min(1) }),
})
const COMPARISON_SCHEMA = z.object({ files: FILES_SCHEMA })

class HumanMergeRequiredError extends Error {
	override name = 'HumanMergeRequiredError'
}

function touches_workflow(files: z.infer<typeof FILES_SCHEMA>): boolean {
	return files.some(
		(file) =>
			file.filename.startsWith(WORKFLOW_PREFIX) ||
			file.previous_filename?.startsWith(WORKFLOW_PREFIX) === true,
	)
}

async function comparison_path(branch: string, expected_head: string | undefined): Promise<string> {
	const number = await require_pr_number(branch)
	const pull_raw = await git_gh_exec.exec_gh_api({
		path: git_gh_api_path.pull_api_path(String(number)),
	})
	const pull = json_value.parse_with(pull_raw, PULL_SCHEMA)

	if (pull === undefined) throw new Error('Cannot read the pull request comparison commits')

	if (expected_head !== undefined && pull.head.sha !== expected_head) {
		throw new Error(HEAD_CHANGED)
	}

	return `${git_gh_api_path.repo_api_path()}/compare/${encodeURIComponent(pull.base.sha)}...${encodeURIComponent(pull.head.sha)}?per_page=1`
}

async function read_files(
	branch: string,
	expected_head: string | undefined,
): Promise<z.infer<typeof FILES_SCHEMA>> {
	const raw = await git_gh_exec.exec_gh_api({ path: await comparison_path(branch, expected_head) })
	const comparison = json_value.parse_with(raw, COMPARISON_SCHEMA)

	if (comparison === undefined || comparison.files.length >= FILE_LIMIT) {
		throw new Error('Cannot authorize a merge without a complete pull request file listing')
	}

	return comparison.files
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
	const files = await read_files(branch, expected_head)

	await assert_head(branch, expected_head)
	if (!touches_workflow(files)) return
	const url = await git_gh_command.pr_get_url(branch)

	if (url === undefined) throw new Error('Could not read the workflow pull request URL')
	await mark_waiting(branch, issue)
	throw new HumanMergeRequiredError(
		`Human merge required: ${url}\nRead the diff on GitHub and merge the pull request there.`,
	)
}

const followup_human_merge = { assert_allowed }

export { followup_human_merge, HumanMergeRequiredError }
