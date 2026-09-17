import { lane_paths } from '#scripts/lane/lane-paths'
import { SEPARATOR_LINE } from './constants'
import { git_gh_issue_read } from './git-gh-issue-read'
import { git_prompt } from './git-prompt'

interface IssueInfo {
	title: string
	number: string
	branch_name: string
	commit_message: string
}

const ISSUE_NUMBER_PATTERN = /#(\d+)$/u

function extract_issue_number(input: string): string {
	const match = ISSUE_NUMBER_PATTERN.exec(input)

	if (match === null) {
		throw new Error('Invalid format: Issue number not found (e.g., "title #52")')
	}

	return match[1] ?? ''
}

function extract_issue_title(input: string): string {
	const title = input.replace(/#\d+$/u, '').trim()

	if (title.length === 0) {
		throw new Error('Invalid format: Issue title is required')
	}

	return title
}

function normalize_title_for_branch(title: string): string {
	const replaced = title
		.toLowerCase()
		.normalize('NFKD')
		.replaceAll(/[^a-z0-9]+/gu, '-')
		.replaceAll(/-+/gu, '-')
		.replaceAll(/(^-)|(-$)/gu, '')

	return replaced.length === 0 ? 'update' : replaced
}

function create_branch_name(issue_number: string, title: string): string {
	return `${issue_number}-${normalize_title_for_branch(title)}`
}

function parse_issue_input(input: string): IssueInfo {
	const trimmed_input = input.trim()
	const issue_number = extract_issue_number(trimmed_input)
	const title = extract_issue_title(trimmed_input)
	const branch_name = create_branch_name(issue_number, title)
	const commit_message = `${title} #${issue_number}`

	return {
		title,
		number: issue_number,
		branch_name,
		commit_message,
	}
}

const BRANCH_NUMBER_PATTERN = /^(\d+)-(.+)$/u

// A lane's branch is `<N>-lane` (joshuafolkken/kit#1490), so its second segment is the fixed word
// `lane` rather than a slug of the title — de-slugging it produced commit messages like `lane #1465`
// on joshuafolkken/kit#1586. The shape is recognized through `lane_paths.lane_branch` rather than a
// second copy of the suffix, so the two ends cannot drift apart (joshuafolkken/kit#1590).
function is_lane_branch(branch_name: string, issue_number: string): boolean {
	return branch_name === lane_paths.lane_branch(issue_number)
}

const EXAMPLE_ISSUE_NUMBER = '42'

function argument_hint(issue_number: string): string {
	return `Provide an issue argument like "title #${issue_number}".`
}

// Never falls back to the branch's own word: `lane` is not a title, and a commit message cannot be
// rewritten once it is on the default branch. Failing loudly leaves the caller one argument away.
async function lane_issue_title(branch_name: string, issue_number: string): Promise<string> {
	const title = await git_gh_issue_read.issue_get_title(issue_number)

	if (title === undefined) {
		throw new Error(
			`Cannot read the title of issue #${issue_number} for lane branch "${branch_name}". ${argument_hint(issue_number)}`,
		)
	}

	return title
}

async function derive_issue_input_from_branch(branch_name: string): Promise<string> {
	const match = BRANCH_NUMBER_PATTERN.exec(branch_name)

	if (match === null) {
		throw new Error(
			`Cannot derive issue info from branch "${branch_name}" in non-interactive mode. ${argument_hint(EXAMPLE_ISSUE_NUMBER)}`,
		)
	}

	const [, number = '', slug = ''] = match
	const title = is_lane_branch(branch_name, number)
		? await lane_issue_title(branch_name, number)
		: slug.replaceAll('-', ' ').trim()

	return `${title} #${number}`
}

async function derive_from_branch(branch_name: string): Promise<IssueInfo> {
	const parsed = parse_issue_input(await derive_issue_input_from_branch(branch_name))

	// Pin to the actual branch so a non-round-tripping slug never triggers a branch switch.
	return { ...parsed, branch_name }
}

function display_issue_info(issue_info: IssueInfo): void {
	console.info('')
	console.info('📋 Issue Information')
	console.info(SEPARATOR_LINE)
	console.info(`  Issue Title: ${issue_info.title}`)
	console.info(`  Issue Number: ${issue_info.number}`)
	console.info(`  Branch Name: ${issue_info.branch_name}`)
	console.info(`  Commit Message: ${issue_info.commit_message}`)
	console.info(SEPARATOR_LINE)
}

async function get_and_display(cli_input?: string): Promise<IssueInfo> {
	const input = cli_input ?? (await git_prompt.get_issue_info())
	const issue_info = parse_issue_input(input)

	display_issue_info(issue_info)

	return issue_info
}

interface ResolveIssueInput {
	cli_input: string | undefined
	current_branch: string
	is_non_interactive: boolean
}

// In non-interactive mode (e.g. `josh pr` / `-y` with no issue arg, or no TTY) the issue
// info is derived from the current branch instead of prompting, so headless runs never throw.
async function resolve_and_display(input: ResolveIssueInput): Promise<IssueInfo> {
	if (input.cli_input !== undefined) return await get_and_display(input.cli_input)

	if (input.is_non_interactive) {
		const issue_info = await derive_from_branch(input.current_branch)

		display_issue_info(issue_info)

		return issue_info
	}

	return await get_and_display()
}

const git_issue = {
	get_and_display,
	resolve_and_display,
	derive_from_branch,
}

export type { IssueInfo }
export { git_issue }
