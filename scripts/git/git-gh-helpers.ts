import { has_stderr_field } from './git-gh-exec'

function parse_pr_state_string(result: string): string | undefined {
	const trimmed = result.trim()

	if (trimmed.length === 0) {
		return undefined
	}

	const without_quotes = trimmed.replaceAll(/(?:^")|(?:"$)/gu, '')

	return without_quotes.length > 0 ? without_quotes : undefined
}

function parse_number_output(result: string): number | undefined {
	const parsed = Number(result.trim())
	if (!Number.isFinite(parsed)) return undefined

	return parsed
}

function is_pr_already_exists_message(error_message: string): boolean {
	return error_message.toLowerCase().includes('already exists')
}

function get_error_message_with_stderr(error: unknown): string {
	if (!(error instanceof Error)) return String(error)

	if (has_stderr_field(error) && error.stderr.length > 0) return `${error.message}\n${error.stderr}`

	return error.message
}

function handle_pr_create_error(error: unknown): never {
	const error_message = get_error_message_with_stderr(error)

	if (is_pr_already_exists_message(error_message)) {
		throw new Error('PR_ALREADY_EXISTS')
	}

	throw error
}

const git_gh_helpers = {
	parse_pr_state_string,
	parse_number_output,
	is_pr_already_exists_message,
	get_error_message_with_stderr,
	handle_pr_create_error,
}

export { git_gh_helpers, parse_pr_state_string }
