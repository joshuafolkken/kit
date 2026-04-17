function is_pr_already_exists_message(message: string): boolean {
	return message === 'PR_ALREADY_EXISTS'
}

function check_error_cause(error: Error): boolean {
	return error.cause instanceof Error && is_pr_already_exists_message(error.cause.message)
}

function is_pr_already_exists_error(error: unknown): boolean {
	if (error instanceof Error) {
		if (is_pr_already_exists_message(error.message)) {
			return true
		}

		return check_error_cause(error)
	}

	return false
}

const git_pr_error = {
	is_pr_already_exists_error,
}

export { git_pr_error }
