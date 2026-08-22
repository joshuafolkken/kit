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

// One invocation shape for every open-issue listing; the callers differ only in filter and fields.
async function issue_list_open(input: {
	json_fields: string
	limit: number
	filter_arguments?: ReadonlyArray<string>
}): Promise<string | undefined> {
	try {
		return await git_gh_exec.exec_gh_command([
			'issue',
			'list',
			...(input.filter_arguments ?? []),
			'--state',
			'open',
			'--limit',
			String(input.limit),
			'--json',
			input.json_fields,
		])
	} catch {
		return undefined
	}
}

// The newest open issues, for the next-issues display at workflow completion (#821). `createdAt`
// rides along because the caller re-sorts explicitly rather than inheriting `gh`'s default order.
async function issue_list_recent(limit: number): Promise<string | undefined> {
	return await issue_list_open({ json_fields: 'number,title,labels,createdAt', limit })
}

async function issue_list_by_label(label: string, limit: number): Promise<string | undefined> {
	return await issue_list_open({
		json_fields: 'number,body',
		limit,
		filter_arguments: ['--label', label],
	})
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

// `|| true` semantics: an existing label is not an error. Swallowing the failure is safe because a
// genuinely missing label surfaces at creation time instead — `gh issue create --label epic` cannot
// resolve it and fails there, so the anomaly is never lost.
async function label_ensure(input: {
	name: string
	color: string
	description: string
}): Promise<void> {
	try {
		await git_gh_exec.exec_gh_command([
			'label',
			'create',
			input.name,
			'--color',
			input.color,
			'--description',
			input.description,
		])
	} catch {
		/* the label already exists */
	}
}

// The body goes through stdin for the same reason the other writers use it: an epic body is
// multi-line markdown, and passing it as an argv string would depend on shell quoting.
async function issue_create_with_label(input: {
	title: string
	label: string
	body: string
}): Promise<string> {
	return await git_gh_exec.exec_gh_command_with_stdin({
		args: [
			'issue',
			'create',
			'--title',
			input.title,
			'--label',
			input.label,
			BODY_FILE_FLAG,
			BODY_FROM_STDIN,
		],
		stdin_body: input.body,
	})
}

// Applied after creation, never as `gh issue create --blocked-by`: an older `gh` rejects the
// unknown flag with exit 1 and the Issue is never created. Split this way, an outdated CLI costs
// only the relation. Requires gh >= 2.94.0; the caller treats a failure as non-fatal.
async function issue_add_blocked_by(issue_number: string, blocker: string): Promise<boolean> {
	try {
		await git_gh_exec.exec_gh_command(['issue', 'edit', issue_number, '--add-blocked-by', blocker])

		return true
	} catch {
		return false
	}
}

async function issue_get_labels_and_body(issue_number: string): Promise<string | undefined> {
	try {
		return await git_gh_exec.exec_gh_command([
			'issue',
			'view',
			issue_number,
			'--json',
			'number,labels,body',
		])
	} catch {
		return undefined
	}
}

const git_gh_issue = {
	label_ensure,
	issue_create_with_label,
	issue_add_blocked_by,
	issue_get_labels_and_body,
	issue_get_title,
	issue_get_body,
	issue_edit_body,
	issue_comment,
	issue_list_recent,
	issue_list_by_label,
	issue_get_state_and_relations,
	issue_close,
}

export { git_gh_issue }
