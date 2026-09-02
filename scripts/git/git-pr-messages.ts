// What `pnpm josh git` prints once the pull request is open. It no longer claims anything about the
// checks: this command returns before they have run (joshuafolkken/kit#1232), and the old
// "All checks passed successfully." was printed on the strength of a watch whose verdict decided
// nothing. Naming `pnpm josh followup` here is the whole replacement — it is what waits, and what
// merges.
function display_pr_opened_message(): void {
	console.info('')
	console.info('✅ Pull request opened.')
	console.info('')
	console.info('`pnpm josh followup` waits for the checks and merges.')
}

function display_pr_url(pr_url: string): void {
	console.info('')
	console.info(`🔗 PR: ${pr_url}`)
}

function display_merged_pr_message(): void {
	console.info('')
	console.info('ℹ️  Existing PR is already merged. Creating a new PR...')
	console.info('')
}

function display_pr_exists_message(): void {
	console.info('')
	console.info('ℹ️  Pull request already exists.')
	console.info('')
}

const git_pr_messages = {
	display_pr_opened_message,
	display_merged_pr_message,
	display_pr_exists_message,
	display_pr_url,
}

export { git_pr_messages }
