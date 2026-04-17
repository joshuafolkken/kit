#!/usr/bin/env node
import { execute_check, get_current_branch, type CheckResult } from './common'

function check_main_branch(): CheckResult {
	const current_branch = get_current_branch()

	if (current_branch === 'main') {
		return {
			success: false,
			message:
				`🚫 Error: Direct commits to main branch are not allowed\n` +
				`   Please create a new branch and commit there:\n` +
				`   git checkout -b feature/your-feature-name\n`,
		}
	}

	return {
		success: true,
		message: `✅ Branch check passed: '${current_branch}'`,
	}
}

function main(): void {
	execute_check(check_main_branch)
}

main()
