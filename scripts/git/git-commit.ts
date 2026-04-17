import { animation_helpers, type AnimationOptions } from './animation-helpers'
import { git_command } from './git-command'

function create_git_operation_config(error_message: string): AnimationOptions<string> {
	return {
		error_message,
		icon_selector: () => '✅',
		result_formatter: (message) => message,
	}
}

async function commit(commit_message: string): Promise<void> {
	const config = create_git_operation_config('Failed to commit changes')

	console.info('')
	await animation_helpers.execute_with_animation(
		'Committing staged changes...',
		async (pause_animation: (() => void) | undefined) => {
			if (pause_animation !== undefined) {
				pause_animation()
			}

			await git_command.commit(commit_message)

			return 'Commit completed.'
		},
		config,
	)
}

const git_commit = {
	commit,
}

export { git_commit }
