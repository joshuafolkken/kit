const SECONDS_TO_MILLISECONDS = 1000
const COUNTDOWN_INTERVAL_MS = 1000
const COUNTDOWN_PADDING = 20

function clear_countdown_line(message_length: number): void {
	const clear_length = message_length + COUNTDOWN_PADDING

	process.stdout.write(`\r${' '.repeat(clear_length)}\r`)
}

function update_countdown_display(message: string, remaining: number): void {
	process.stdout.write(`\r${message} (${String(remaining)}s)`)
}

function create_countdown_interval(message: string, total_seconds: number): NodeJS.Timeout {
	let remaining_seconds = total_seconds

	update_countdown_display(message, remaining_seconds)

	return setInterval(() => {
		remaining_seconds -= 1

		if (remaining_seconds > 0) {
			update_countdown_display(message, remaining_seconds)
		} else {
			clear_countdown_line(message.length)
		}
	}, COUNTDOWN_INTERVAL_MS)
}

async function wait_for_seconds(seconds: number, countdown_message?: string): Promise<void> {
	if (countdown_message === undefined || !process.stdout.isTTY) {
		await new Promise((resolve) => {
			setTimeout(resolve, seconds * SECONDS_TO_MILLISECONDS)
		})

		return
	}

	const interval_id = create_countdown_interval(countdown_message, seconds)

	await new Promise((resolve) => {
		setTimeout(resolve, seconds * SECONDS_TO_MILLISECONDS)
	})

	clearInterval(interval_id)
	clear_countdown_line(countdown_message.length)
}

const git_countdown = {
	wait_for_seconds,
}

export { git_countdown }
