import { animation_helpers, type AnimationOptions } from './animation-helpers'
import { git_command } from './git-command'
import { git_error } from './git-error'

function create_branch_operation_config(error_message: string): AnimationOptions<string> {
	return {
		error_message,
		icon_selector: () => '✅',
		result_formatter: (message) => message,
	}
}

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
	const config = create_branch_operation_config('Failed to create branch')

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
	const config = create_branch_operation_config('Failed to switch branch')

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
	const config = create_branch_operation_config('Failed to pull latest from remote')

	await animation_helpers.execute_with_animation(
		'Pulling latest from remote...',
		async () => {
			await git_command.pull()

			return 'Pulled latest from remote'
		},
		config,
	)
}

async function handle_default_branch(target_branch_name: string): Promise<void> {
	await pull_latest()
	const is_branch_exists: boolean = await exists(target_branch_name)

	await (is_branch_exists ? switch_to(target_branch_name) : create(target_branch_name))
}

async function check_and_create_branch(
	current_branch: string,
	target_branch_name: string,
): Promise<void> {
	const default_branch = await git_command.get_default_branch()

	if (current_branch === default_branch) {
		await handle_default_branch(target_branch_name)

		return
	}

	if (current_branch !== target_branch_name) {
		git_error.display_branch_mismatch_error(current_branch, target_branch_name)
	}
}

const git_branch = {
	current,
	create,
	switch_to,
	exists,
	check_and_create_branch,
}

export { git_branch }
