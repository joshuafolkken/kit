#!/usr/bin/env tsx
import { git_command } from './git/git-command'

interface CheckResult {
	success: boolean
	message: string
}

async function check_main_branch(): Promise<CheckResult> {
	const current_branch = await git_command.branch()
	const default_branch = await git_command.get_default_branch()

	if (current_branch === default_branch) {
		return {
			success: false,
			message:
				`🚫 Error: Direct commits to main branch are not allowed\n` +
				`   Please create a new branch and commit there:\n` +
				`   git checkout -b feature/your-feature-name\n`,
		}
	}

	return { success: true, message: `✅ Branch check passed: '${current_branch}'` }
}

const result = await check_main_branch()

console.info(result.message)

if (!result.success) process.exit(1)

export { check_main_branch }
export type { CheckResult }
