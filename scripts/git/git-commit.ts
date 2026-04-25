import { animation_helpers, create_git_operation_config } from './animation-helpers'
import { git_command } from './git-command'

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
