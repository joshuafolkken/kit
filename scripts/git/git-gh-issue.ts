import { BODY_FILE_FLAG, BODY_FROM_STDIN, git_gh_exec } from './git-gh-exec'
import { git_gh_helpers } from './git-gh-helpers'

const NUMBER_AND_BODY_FIELDS = 'number,body'

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

// `repo` reads an issue in another repository — the form a cross-repository epic is referenced in
// (joshuafolkken/kit#864). Without it a qualified reference would read *this* repository's issue of
// that number, a different issue entirely.
async function issue_get_body(issue_number: string, repo?: string): Promise<string | undefined> {
	const scope = repo === undefined ? [] : ['--repo', repo]

	try {
		return await git_gh_exec.exec_gh_command([
			'issue',
			'view',
			issue_number,
			...scope,
			'--json',
			'body',
			'--jq',
			'.body',
		])
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

// Every open issue with its body. Used by `epic:bundle` to scan the backlog; a search with an empty
// term is not a listing, and asking `gh` for one produced a partial and arbitrary answer
// (joshuafolkken/kit#873).
async function issue_list_open_bodies(limit: number): Promise<string | undefined> {
	return await issue_list_open({ json_fields: NUMBER_AND_BODY_FIELDS, limit })
}

// Open issues whose body mentions `term`. Used by `epic:audit` to find an issue that names an epic
// as its parent while the epic's task list does not track it (joshuafolkken/kit#870).
async function issue_search_body(term: string, limit: number): Promise<string | undefined> {
	return await issue_list_open({
		json_fields: NUMBER_AND_BODY_FIELDS,
		limit,
		filter_arguments: ['--search', `${term} in:body`],
	})
}

async function issue_list_by_label(label: string, limit: number): Promise<string | undefined> {
	return await issue_list_open({
		json_fields: NUMBER_AND_BODY_FIELDS,
		limit,
		filter_arguments: ['--label', label],
	})
}

// One `gh issue view --json <fields>`, for every caller that wants a JSON view of one issue. Callers
// differ only in which fields they ask for, and a helper per field list is how four near-identical
// functions accumulated (joshuafolkken/kit#862).
async function issue_view_json(
	issue_number: string,
	fields: string,
	repo?: string,
): Promise<string | undefined> {
	const scope = repo === undefined ? [] : ['--repo', repo]

	try {
		return await git_gh_exec.exec_gh_command([
			'issue',
			'view',
			issue_number,
			...scope,
			'--json',
			fields,
		])
	} catch {
		return undefined
	}
}

// State, labels and dependency relations in one read: the epic auto-close needs state and relations
// per child, `epic:next` needs the labels too, and splitting them would multiply the API calls for
// no gain (joshuafolkken/kit#860).
//
// `repo` reads a child in another repository. Cross-repository children are read this way rather
// than from a local checkout: their state is a GitHub fact, and requiring a clone to learn it is
// what kept the auto-close from ever running on such an epic (joshuafolkken/kit#864).
async function issue_get_state_and_relations(
	issue_number: string,
	repo?: string,
): Promise<string | undefined> {
	return await issue_view_json(issue_number, 'number,state,labels,blockedBy', repo)
}

// Everything `epic:plan` puts in front of the batch decision. Read separately from the poll above
// because it carries the bodies, which a `wait` poll never looks at.
//
// `epic:bundle` reads a referenced issue through the same call rather than adding a helper for its
// own field list — it needs the body and the state, which is a subset of this one, and a helper per
// field list is exactly how the four near-identical functions above accumulated
// (joshuafolkken/kit#947).
async function issue_get_plan_fields(issue_number: string): Promise<string | undefined> {
	return await issue_view_json(issue_number, 'number,title,body,state,url,labels,blockedBy')
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

// Applied after the body edit so a failure leaves an issue with the epic sections and no label,
// which `epic:check` reports — rather than a labelled issue with nothing to track. The caller checks
// the return: the label is what the auto-close filters on (joshuafolkken/kit#865).
async function issue_add_label(issue_number: string, label: string): Promise<boolean> {
	try {
		await git_gh_exec.exec_gh_command(['issue', 'edit', issue_number, '--add-label', label])

		return true
	} catch {
		return false
	}
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

// The counterpart to the above, for an insertion that re-points an existing chain: inserting `#N`
// between `#B` and `#M` has to drop `#B -> #M`, or the epic would declare one order and record two
// (joshuafolkken/kit#890). Same gh >= 2.94.0 requirement, same non-fatal treatment.
async function issue_remove_blocked_by(issue_number: string, blocker: string): Promise<boolean> {
	try {
		await git_gh_exec.exec_gh_command([
			'issue',
			'edit',
			issue_number,
			'--remove-blocked-by',
			blocker,
		])

		return true
	} catch {
		return false
	}
}

async function issue_get_labels_and_body(issue_number: string): Promise<string | undefined> {
	return await issue_view_json(issue_number, 'number,labels,body')
}

const git_gh_issue = {
	label_ensure,
	issue_create_with_label,
	issue_add_blocked_by,
	issue_remove_blocked_by,
	issue_add_label,
	issue_get_labels_and_body,
	issue_get_title,
	issue_get_body,
	issue_edit_body,
	issue_comment,
	issue_list_recent,
	issue_list_by_label,
	issue_search_body,
	issue_list_open_bodies,
	issue_view_json,
	issue_get_state_and_relations,
	issue_get_plan_fields,
	issue_close,
}

export { git_gh_issue }
