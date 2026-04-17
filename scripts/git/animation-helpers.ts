import { git_animation } from './git-animation'

interface AnimationOptions<T> {
	icon_selector?: (result: T) => string | undefined
	error_message?: string
	result_formatter?: (result: T) => string
}

function get_error_message(error_message: string | undefined): string {
	return error_message ?? 'Operation failed'
}

function get_display_result<T>(result: T, formatter?: (result: T) => string): string {
	return formatter?.(result) ?? String(result)
}

function handle_animation_success<T>(
	animation: { stop: (result: string, icon?: string) => void },
	result: T,
	options?: AnimationOptions<T>,
): void {
	const icon = options?.icon_selector?.(result)
	const display_result = get_display_result(result, options?.result_formatter)

	animation.stop(display_result, icon)
}

function handle_animation_error(
	animation: { stop: () => void },
	error: unknown,
	error_message: string | undefined,
): never {
	animation.stop()

	if (error_message === undefined || error_message.length === 0) {
		if (error instanceof Error) {
			throw error
		}

		throw new Error(String(error), { cause: error })
	}

	throw new Error(get_error_message(error_message), { cause: error })
}

type CommandExecutor<T> = (pause_animation?: () => void) => Promise<T>

async function execute_with_animation<T>(
	message: string,
	command_executor: CommandExecutor<T>,
	options?: AnimationOptions<T>,
): Promise<T> {
	const animation = git_animation.create_animation(message)

	try {
		const result = await command_executor(() => {
			animation.pause()
		})

		handle_animation_success(animation, result, options)

		return result
	} catch (error) {
		return handle_animation_error(animation, error, options?.error_message)
	}
}

const animation_helpers = {
	execute_with_animation,
}

export type { AnimationOptions }
export { animation_helpers }
