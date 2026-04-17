import { git_command } from './git-command'
import { git_prompt } from './git-prompt'
import { git_status } from './git-status'

async function confirm_package_json_staged(force = false): Promise<boolean> {
	const is_package_json_staged = await git_status.check_package_json_staged()

	if (!is_package_json_staged) {
		if (force) {
			console.info('💡 Skipping package.json staging check (force).')

			return false
		}

		await git_prompt.confirm_missing_package_json()

		return false
	}

	return true
}

async function confirm_package_json_version(force = false): Promise<void> {
	const is_version_updated = await git_status.check_package_json_version()

	if (!is_version_updated) {
		if (force) {
			console.info('💡 Skipping package.json version check (force).')

			return
		}

		await git_prompt.confirm_without_version_update()
	}
}

async function check_and_confirm_package_json(force = false): Promise<void> {
	const is_already_updated = await git_status.check_branch_version()

	if (is_already_updated) {
		console.info('💡 Version already updated on this branch. Skipping package.json check.')

		return
	}

	const is_staged = await confirm_package_json_staged(force)

	if (is_staged) {
		await confirm_package_json_version(force)
	}
}

async function stage_untracked_files(files: ReadonlyArray<string>): Promise<void> {
	if (files.length === 0) return

	for (const file of files) {
		await git_command.add_path(file)
	}

	console.info(`💡 Auto-staged ${String(files.length)} untracked non-ignored file(s):`)
	for (const file of files) console.info(`   + ${file}`)
}

async function stage_tracked_files(): Promise<void> {
	const status_output = await git_command.status()
	const untracked = git_status.list_untracked_files(status_output)

	await git_command.add_tracked()
	console.info('💡 Auto-staged tracked modified files (git add -u).')
	await stage_untracked_files(untracked)
}

async function check_and_confirm_staging(force = false): Promise<void> {
	const has_unstaged = await git_status.check_unstaged()

	if (has_unstaged) {
		await (force ? stage_tracked_files() : git_prompt.confirm_unstaged_files())
	}

	await check_and_confirm_package_json(force)
}

const git_staging = {
	check_and_confirm_staging,
}

export { git_staging }
