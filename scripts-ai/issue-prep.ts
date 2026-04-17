#!/usr/bin/env tsx
/**
 * Fetch a GitHub issue and report title status + suggested branch name.
 *
 * Usage: tsx scripts-ai/issue-prep.ts <issue-number>
 */
import { execSync } from 'node:child_process'
import { issue_logic } from '../scripts/issue/issue-logic'

const ARGV_INDEX = 2
const issue_number_argument = process.argv[ARGV_INDEX]

if (issue_number_argument === undefined || !/^[1-9]\d*$/u.test(issue_number_argument)) {
	console.error('Usage: tsx scripts-ai/issue-prep.ts <issue-number>')
	process.exit(1)
}

const issue_number = Number(issue_number_argument)
const issue_number_string = String(issue_number)

function fetch_issue_title(number_string: string): string {
	const command = `gh issue view ${number_string} --json title --jq .title`

	return execSync(command, { encoding: 'utf8' }).trim() // eslint-disable-line sonarjs/os-command
}

let title = ''

try {
	title = fetch_issue_title(issue_number_string)
} catch (error) {
	console.error(`✖ Failed to fetch issue #${issue_number_string}`)
	console.error(error instanceof Error ? error.message : String(error))
	process.exit(1)
}

const result = issue_logic.prepare(issue_number, title)

function display_language_status(is_cjk: boolean): string {
	return is_cjk ? '⚠ Contains CJK — needs English translation' : '✔ English'
}

console.info('')
console.info(`📋 Issue #${issue_number_string}`)
console.info(`  Title:    ${result.title}`)
console.info(`  Language: ${display_language_status(result.is_cjk)}`)
console.info(`  Branch:   ${result.suggested_branch}`)
console.info('')
