import { SEPARATOR_LINE } from './constants'
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
	const kebab_title = normalize_title_for_branch(title)

	return `${issue_number}-${kebab_title}`
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

const git_issue = {
	get_and_display,
}

export type { IssueInfo }
export { git_issue }
