const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SUCCESS_ICON = '✅'
const ANIMATION_INTERVAL_MS = 100
const CLEAR_PADDING = 3
const ICON_DISPLAY_WIDTH = 4

type AnimationStopFunction = (result?: string, icon?: string) => void

interface AnimationController {
	stop: AnimationStopFunction
	pause: () => void
}

function create_pause_function(interval_id: NodeJS.Timeout, message: string): () => void {
	return () => {
		clearInterval(interval_id)
		const clear_length = message.length + CLEAR_PADDING

		process.stdout.write(`\r${' '.repeat(clear_length)}\r`)
		process.stdout.write('\n')
	}
}

function create_stop_function(interval_id: NodeJS.Timeout, message: string): AnimationStopFunction {
	return (result?: string, icon?: string) => {
		clearInterval(interval_id)

		if (result === undefined) {
			const clear_length = message.length + CLEAR_PADDING

			process.stdout.write(`\r${' '.repeat(clear_length)}\r`)

			return
		}

		const display_icon = icon ?? SUCCESS_ICON
		const icon_without_space = display_icon.trimEnd()

		process.stdout.write(`\r${icon_without_space} ${message} ${result}\n`)
	}
}

function get_next_frame_index(current_index: number, total_frames: number): number {
	return current_index % total_frames
}

function create_animation(message: string): AnimationController {
	if (!process.stdout.isTTY) {
		return {
			stop: () => {
				// No-op when not in TTY
			},
			pause: () => {
				// No-op when not in TTY
			},
		}
	}

	let frame_index = 0
	const first_frame = SPINNER_FRAMES[0] ?? ''

	console.info('')
	process.stdout.write(`\r${first_frame} ${message}`)

	const interval_id = setInterval(() => {
		frame_index += 1
		const frame_index_modulo = get_next_frame_index(frame_index, SPINNER_FRAMES.length)
		const frame = SPINNER_FRAMES[frame_index_modulo] ?? ''

		process.stdout.write(`\r${frame} ${message}`)
	}, ANIMATION_INTERVAL_MS)

	return {
		stop: create_stop_function(interval_id, message),
		pause: create_pause_function(interval_id, message),
	}
}

const git_animation = {
	ANIMATION_INTERVAL_MS,
	ICON_DISPLAY_WIDTH,
	create_animation,
}

export { git_animation }
