#!/usr/bin/env tsx
/**
 * Fetch a GitHub issue and report title status + suggested branch name.
 *
 * Usage: tsx scripts-ai/issue-prep.ts <issue-number>
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { issue_logic } from '../scripts/issue/issue-logic'

const ARGV_INDEX = 2
const IN_PROGRESS_LABEL = 'in-progress'
const IN_PROGRESS_COLOR = '#0075ca'
const IN_PROGRESS_DESCRIPTION = 'Work is actively in progress'

function display_language_status(is_cjk: boolean): string {
	return is_cjk ? '⚠ Contains CJK — needs English translation' : '✔ English'
}

function fetch_issue_title(number_string: string): string {
	return execFileSync('gh', ['issue', 'view', number_string, '--json', 'title', '--jq', '.title'], {
		encoding: 'utf8',
	}).trim()
}

function parse_issue_number(): string {
	const argument = process.argv[ARGV_INDEX]

	if (argument === undefined || !/^[1-9]\d*$/u.test(argument)) {
		console.error('Usage: tsx scripts-ai/issue-prep.ts <issue-number>')
		process.exit(1)
	}

	return argument
}

function fetch_title_for_issue(issue_number_string: string): string {
	let title = ''

	try {
		title = fetch_issue_title(issue_number_string)
	} catch (error) {
		console.error(`✖ Failed to fetch issue #${issue_number_string}`)
		console.error(error instanceof Error ? error.message : String(error))
		process.exit(1)
	}

	return title
}

function display_issue_info(
	issue_number: number,
	issue_number_string: string,
	title: string,
): void {
	const result = issue_logic.prepare(issue_number, title)

	console.info('')
	console.info(`📋 Issue #${issue_number_string}`)
	console.info(`  Title:    ${result.title}`)
	console.info(`  Language: ${display_language_status(result.is_cjk)}`)
	console.info(`  Branch:   ${result.suggested_branch}`)
	console.info('')
}

function ensure_in_progress_label(): void {
	try {
		execFileSync(
			'gh',
			[
				'label',
				'create',
				IN_PROGRESS_LABEL,
				'--color',
				IN_PROGRESS_COLOR,
				'--description',
				IN_PROGRESS_DESCRIPTION,
			],
			{ encoding: 'utf8', stdio: 'pipe' },
		)
	} catch {
		// Label already exists
	}
}

function assign_in_progress_label(issue_number_string: string): void {
	execFileSync('gh', ['issue', 'edit', issue_number_string, '--add-label', IN_PROGRESS_LABEL], {
		encoding: 'utf8',
	})
	console.info(`  Label:    ${IN_PROGRESS_LABEL} ✔`)
}

function main(): void {
	const issue_number_string = parse_issue_number()
	const issue_number = Number(issue_number_string)
	const title = fetch_title_for_issue(issue_number_string)

	display_issue_info(issue_number, issue_number_string, title)
	ensure_in_progress_label()
	assign_in_progress_label(issue_number_string)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

const issue_prep = {
	display_language_status,
	fetch_issue_title,
	ensure_in_progress_label,
	assign_in_progress_label,
}

export { issue_prep }
