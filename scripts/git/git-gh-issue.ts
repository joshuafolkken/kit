import { BODY_FILE_FLAG, BODY_FROM_STDIN, git_gh_exec } from './git-gh-exec'
import { git_gh_helpers } from './git-gh-helpers'

async function issue_get_title(issue_number: string): Promise<string | undefined> {
	try {
		const result: string = await git_gh_exec.exec_gh_command([
			'issue',
			'view',
			issue_number,
			'--json',
			'title',
			'--jq',
			'.title',
		])

		return git_gh_helpers.parse_pr_state_string(result)
	} catch {
		return undefined
	}
}

async function issue_get_body(issue_number: string): Promise<string | undefined> {
	try {
		const result: string = await git_gh_exec.exec_gh_command([
			'issue',
			'view',
			issue_number,
			'--json',
			'body',
			'--jq',
			'.body',
		])

		return result
	} catch {
		return undefined
	}
}

async function issue_edit_body(issue_number: string, body: string): Promise<string> {
	return await git_gh_exec.exec_gh_command_with_stdin({
		args: ['issue', 'edit', issue_number, BODY_FILE_FLAG, BODY_FROM_STDIN],
		stdin_body: body,
	})
}

async function issue_comment(issue_number: string, body: string): Promise<string> {
	return await git_gh_exec.exec_gh_command_with_stdin({
		args: ['issue', 'comment', issue_number, BODY_FILE_FLAG, BODY_FROM_STDIN],
		stdin_body: body,
	})
}

const git_gh_issue = {
	issue_get_title,
	issue_get_body,
	issue_edit_body,
	issue_comment,
}

export { git_gh_issue }
