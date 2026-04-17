import { animation_helpers, type AnimationOptions } from './animation-helpers'
import { git_command } from './git-command'

function create_git_operation_config(error_message: string): AnimationOptions<string> {
	return {
		error_message,
		icon_selector: () => '✅',
		result_formatter: (message) => message,
	}
}

async function push(): Promise<void> {
	const config = create_git_operation_config('')

	console.info('')
	await animation_helpers.execute_with_animation(
		'Pushing changes to remote...',
		async (pause_animation: (() => void) | undefined) => {
			if (pause_animation !== undefined) {
				pause_animation()
			}

			await git_command.push()

			return 'Push completed.'
		},
		config,
	)
}

const git_push = {
	push,
}

export { git_push }
