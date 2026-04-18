#!/usr/bin/env tsx
import { readFileSync } from 'node:fs'
import { execute_check, get_current_branch, type CheckResult } from './common'

function get_commit_message(): string {
	// 引数からコミットメッセージファイルのパスを取得
	const FILE_INDEX = 2
	const commit_message_file = process.argv.at(FILE_INDEX)

	// 引数がない場合は、デフォルトのパスを試す
	const default_path = commit_message_file ?? '.git/COMMIT_EDITMSG'

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

function check_commit_message(): CheckResult {
	const current_branch = get_current_branch()
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

function main(): void {
	execute_check(check_commit_message)
}

main()
