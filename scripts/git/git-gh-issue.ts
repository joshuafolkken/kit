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

async function issue_list_by_label(label: string, limit: number): Promise<string | undefined> {
	try {
		return await git_gh_exec.exec_gh_command([
			'issue',
			'list',
			'--label',
			label,
			'--state',
			'open',
			'--limit',
			String(limit),
			'--json',
			'number,body',
		])
	} catch {
		return undefined
	}
}

// State and dependency relations come from a single `gh issue view`: the epic auto-close needs both
// per child, and splitting them would double the API calls for no gain.
async function issue_get_state_and_relations(issue_number: string): Promise<string | undefined> {
	try {
		return await git_gh_exec.exec_gh_command([
			'issue',
			'view',
			issue_number,
			'--json',
			'state,blockedBy',
		])
	} catch {
		return undefined
	}
}

// `gh issue close` takes the comment as a plain string flag — unlike create/comment it has no
// `--body-file`, so the text cannot be piped through stdin. execa passes argv as an array without a
// shell, so the value needs no quoting.
async function issue_close(issue_number: string, comment: string): Promise<boolean> {
	try {
		await git_gh_exec.exec_gh_command(['issue', 'close', issue_number, '--comment', comment])

		return true
	} catch {
		return false
	}
}

const git_gh_issue = {
	issue_get_title,
	issue_get_body,
	issue_edit_body,
	issue_comment,
	issue_list_by_label,
	issue_get_state_and_relations,
	issue_close,
}

export { git_gh_issue }
