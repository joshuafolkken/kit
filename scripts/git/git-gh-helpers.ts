import { has_stderr_field } from './git-gh-exec'

// One optional string answer from `gh`. Every caller asks with `--jq`, which unwraps the JSON
// string itself, so the value arrives raw and there is nothing to unquote — this used to strip a
// leading and trailing `"` anyway, which ate real characters from any answer that legitimately
// carried them. A title of `"queue" should stop at the first failure` reached Telegram as
// `queue" should stop at the first failure` (joshuafolkken/kit#993). Trimming and the empty answer
// are the whole contract.
function parse_pr_state_string(result: string): string | undefined {
	const trimmed = result.trim()

	return trimmed.length > 0 ? trimmed : undefined
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
