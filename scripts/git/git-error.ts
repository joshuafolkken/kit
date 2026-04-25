import { has_stderr_field } from './git-gh-exec'

function get_error_message(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function get_stderr_from_error(cause: Error): string | undefined {
	if (!has_stderr_field(cause)) return undefined

	const stderr = cause.stderr.trim()

	return stderr.length > 0 ? stderr : undefined
}

function get_error_message_from_cause(cause: Error): string | undefined {
	const message = cause.message.trim()

	if (message.length > 0) {
		return message
	}

	return get_stderr_from_error(cause)
}

function get_cause_message(cause: unknown): string | undefined {
	if (cause instanceof Error) {
		return get_error_message_from_cause(cause)
	}

	if (typeof cause === 'string') {
		return cause.trim()
	}

	return undefined
}

function display_error_details(cause: unknown): void {
	const cause_message = get_cause_message(cause)

	if (cause_message !== undefined && cause_message.length > 0) {
		console.error('')
		console.error('💡 Details:', cause_message)
	}
}

function handle(error: unknown): void {
	const error_message = get_error_message(error)

	console.error('')
	console.error('❌ Error:', error_message)

	if (error instanceof Error && error.cause !== undefined) {
		display_error_details(error.cause)
	}

	console.error('')
	process.exit(1)
}

function display_branch_mismatch_error(current_branch: string, target_branch_name: string): void {
	console.error('')
	console.error('❌ Branch mismatch detected')
	console.error('')
	console.error(`Current branch: ${current_branch}`)
	console.error(`Expected branch: ${target_branch_name}`)
	console.error('')
	console.error('💡 Please update main branch to the latest and try again.')
	process.exit(1)
}

const git_error = {
	handle,
	display_branch_mismatch_error,
}

export { git_error }
