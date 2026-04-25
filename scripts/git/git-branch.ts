import {
	animation_helpers,
	create_git_operation_config,
	type AnimationOptions,
} from './animation-helpers'
import { git_command } from './git-command'
import { git_error } from './git-error'

async function current(): Promise<string> {
	const config: AnimationOptions<string> = {
		error_message: 'Failed to get current branch',
	}

	return await animation_helpers.execute_with_animation(
		'Getting current branch...',
		git_command.branch,
		config,
	)
}

async function create(branch_name: string): Promise<void> {
	const config = create_git_operation_config('Failed to create branch')

	await animation_helpers.execute_with_animation(
		`Creating branch: ${branch_name}...`,
		async () => {
			await git_command.checkout_b(branch_name)

			return `Branch created: ${branch_name}`
		},
		config,
	)
}

async function switch_to(branch_name: string): Promise<void> {
	const config = create_git_operation_config('Failed to switch branch')

	await animation_helpers.execute_with_animation(
		`Switching to branch: ${branch_name}...`,
		async () => {
			await git_command.checkout(branch_name)

			return `Switched to branch: ${branch_name}`
		},
		config,
	)
}

async function exists(branch_name: string): Promise<boolean> {
	const config: AnimationOptions<boolean> = {
		error_message: 'Failed to check branch existence',
		result_formatter: (is_exists: boolean) => (is_exists ? 'Exists' : 'Not found'),
	}

	return await animation_helpers.execute_with_animation(
		'Checking if branch exists...',
		async () => {
			return await git_command.branch_exists(branch_name)
		},
		config,
	)
}

async function pull_latest(): Promise<void> {
	const config = create_git_operation_config('Failed to pull latest from remote')

	await animation_helpers.execute_with_animation(
		'Pulling latest from remote...',
		async () => {
			await git_command.pull()

			return 'Pulled latest from remote'
		},
		config,
	)
}

const ISSUE_PREFIX_PATTERN = /^\d+-/u

function has_same_issue_prefix(branch_a: string, branch_b: string): boolean {
	const prefix_a = ISSUE_PREFIX_PATTERN.exec(branch_a)?.[0]
	const prefix_b = ISSUE_PREFIX_PATTERN.exec(branch_b)?.[0]

	return prefix_a !== undefined && prefix_a === prefix_b
}

async function handle_default_branch(target_branch_name: string): Promise<void> {
	await pull_latest()
	const is_branch_exists: boolean = await exists(target_branch_name)

	await (is_branch_exists ? switch_to(target_branch_name) : create(target_branch_name))
}

async function check_and_create_branch(
	current_branch: string,
	target_branch_name: string,
): Promise<string> {
	const default_branch = await git_command.get_default_branch()

	if (current_branch === default_branch) {
		await handle_default_branch(target_branch_name)

		return target_branch_name
	}

	if (current_branch !== target_branch_name) {
		if (has_same_issue_prefix(current_branch, target_branch_name)) return current_branch

		git_error.display_branch_mismatch_error(current_branch, target_branch_name)
	}

	return current_branch
}

const git_branch = {
	current,
	create,
	switch_to,
	exists,
	check_and_create_branch,
}

export { git_branch }
