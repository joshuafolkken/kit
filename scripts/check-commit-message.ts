#!/usr/bin/env tsx
import { readFileSync } from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { git_command } from './git/git-command'

interface CheckResult {
	success: boolean
	message: string
}

const GIT_DIR_PREFIX = '.git/'

function is_safe_commit_message_path(file_path: string): boolean {
	return file_path.startsWith(GIT_DIR_PREFIX) || file_path.startsWith(os.tmpdir())
}

function get_commit_message(): string {
	const FILE_INDEX = 2
	const commit_message_file = process.argv.at(FILE_INDEX)
	const default_path = commit_message_file ?? '.git/COMMIT_EDITMSG'

	if (commit_message_file !== undefined && !is_safe_commit_message_path(commit_message_file)) {
		throw new Error(
			`Commit message file must be in .git/ or system temp dir: ${commit_message_file}`,
		)
	}

	try {
		return readFileSync(default_path, 'utf8').trim()
	} catch (error) {
		throw new Error(`Failed to read commit message file: ${default_path}`, { cause: error })
	}
}

function extract_issue_number(branch_name: string): string | undefined {
	const branch_pattern = /^(\d+)-[\da-z-]+$/u
	const match = branch_pattern.exec(branch_name)

	return match?.[1]
}

function create_error_message(issue_number: string, branch: string, message: string): string {
	return (
		`🚫 Error: Commit message must include #${issue_number}\n` +
		`   Current branch: ${branch}\n` +
		`   Commit message: ${message}\n` +
		`   Please include #${issue_number} in your commit message\n`
	)
}

async function check_commit_message(): Promise<CheckResult> {
	const current_branch = await git_command.branch()
	const issue_number = extract_issue_number(current_branch)

	if (issue_number === undefined) {
		return {
			success: true,
			message: `✅ Branch format check passed: '${current_branch}' (no issue number required)`,
		}
	}

	const commit_message = get_commit_message()

	if (!commit_message.includes(`#${issue_number}`)) {
		return {
			success: false,
			message: create_error_message(issue_number, current_branch, commit_message),
		}
	}

	return {
		success: true,
		message: `✅ Commit message check passed: Found #${issue_number}`,
	}
}

async function main(): Promise<void> {
	const result = await check_commit_message()

	console.info(result.message)

	if (!result.success) process.exit(1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export { check_commit_message, extract_issue_number, is_safe_commit_message_path }

export type { CheckResult }
