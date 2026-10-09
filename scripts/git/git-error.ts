import { has_stderr_field } from '#scripts/gh/git-gh-exec'
import { error_text } from '#scripts/lib/error-message'

function get_stderr_from_error(cause: Error): string | undefined {
	if (!has_stderr_field(cause)) return undefined

	const stderr = cause.stderr.trim()

	return stderr.length > 0 ? stderr : undefined
}

function get_error_message_from_cause(cause: Error): string | undefined {
	const message = cause.message.trim()

	if (message.length > 0) return message

	return get_stderr_from_error(cause)
}

function get_cause_message(cause: unknown): string | undefined {
	if (cause instanceof Error) return get_error_message_from_cause(cause)

	if (typeof cause === 'string') return cause.trim()

	return undefined
}

function display_error_details(cause: unknown): void {
	const cause_message = get_cause_message(cause)

	if (cause_message === undefined || cause_message.length === 0) return

	console.error('')
	console.error('💡 Details:', cause_message)
}

const FAILURE_EXIT_CODE = 1
const OPERATION_CANCELLED_MESSAGE = '💡 Operation cancelled.'

// **A library refuses by throwing; only the CLI entry decides the exit code**.
// `process.exit()` from an imported module skips every `finally` above it (a lock release included)
// and truncates a piped stdout, so these modules throw a typed error instead, and `handle` — the catch
// at each entry — renders it and sets `process.exitCode`.
interface BranchMismatch {
	current_branch: string
	target_branch_name: string
}

class BranchMismatchError extends Error {
	readonly current_branch: string
	readonly target_branch_name: string

	constructor(mismatch: BranchMismatch, options?: ErrorOptions) {
		super(
			`Branch mismatch: on ${mismatch.current_branch}, expected ${mismatch.target_branch_name}`,
			options,
		)
		this.name = 'BranchMismatchError'
		this.current_branch = mismatch.current_branch
		this.target_branch_name = mismatch.target_branch_name
	}
}

class OperationCancelledError extends Error {
	constructor() {
		super('Operation cancelled')
		this.name = 'OperationCancelledError'
	}
}

function display_failure(error: unknown): void {
	const error_message = error_text.message_of(error)

	console.error('')
	console.error('❌ Error:', error_message)

	if (error instanceof Error && error.cause !== undefined) {
		display_error_details(error.cause)
	}

	console.error('')
}

function display_branch_mismatch(error: BranchMismatchError): void {
	console.error('')
	console.error('❌ Branch mismatch detected')
	console.error('')
	console.error(`Current branch: ${error.current_branch}`)
	console.error(`Expected branch: ${error.target_branch_name}`)
	console.error('')
	console.error('💡 Please update main branch to the latest and try again.')
}

function display_cancelled(): void {
	console.info(OPERATION_CANCELLED_MESSAGE)
	console.info('')
}

function display(error: unknown): void {
	if (error instanceof BranchMismatchError) {
		display_branch_mismatch(error)

		return
	}

	if (error instanceof OperationCancelledError) {
		display_cancelled()

		return
	}

	display_failure(error)
}

function handle(error: unknown): void {
	display(error)
	process.exitCode = FAILURE_EXIT_CODE
}

const git_error = {
	handle,
}

export { git_error, BranchMismatchError, OperationCancelledError }
