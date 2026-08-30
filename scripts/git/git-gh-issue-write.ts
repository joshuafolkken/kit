import { git_gh_api_path } from './git-gh-api-path'
import { git_gh_exec } from './git-gh-exec'

// Writing issues and labels through REST, in the return-value contracts the `gh <noun> <verb>`
// wrappers had.
//
// `gh issue edit` / `comment` / `create` / `close` and `gh label create` all go through GraphQL,
// which a cloud session is answered 403 for while the REST endpoints are served normally
// (joshuafolkken/kit#1022). Split out of `git-gh-issue.ts` rather than added to it: that file was
// already at 215 of the 300 lines a file may hold, and the reads had been split out for the same
// reason (joshuafolkken/kit#957, joshuafolkken/kit#1026).
//
// **Every path here was measured against the live API before it was written.**
// joshuafolkken/kit#1022 deliberately measured only the reads, because a write has side effects, and
// left the write side as candidates to confirm one at a time. They were confirmed on a pair of
// throwaway issues, and one of them did not behave as its name suggests — see `read_issue_id`.
//
// The bodies still travel over stdin: `exec_gh_api` hands `body` to gh as `--input -`, so multi-line
// markdown depends on no shell quoting, exactly as `--body-file -` did before.

// `gh api` promotes a request carrying `--input` to POST, so a creation names no method; the two
// verbs that are not implied by a body do.
const PATCH_METHOD = 'PATCH'
const DELETE_METHOD = 'DELETE'

// `gh issue edit`, `gh issue comment` and `gh issue create` each printed one URL, and the callers
// read it — `git-epic-run.ts` parses the epic's number back out of it. REST answers the whole
// object, so the same value is unwrapped out of it rather than the shape being changed.
const HTML_URL_FILTER = '.html_url'
const ID_FILTER = '.id'

const LABELS_SEGMENT = '/labels'
const COMMENTS_SEGMENT = '/comments'
const CLOSED_STATE = 'closed'
const COLOR_HASH = '#'

// The four writers below answered `boolean` under `gh`, and their callers read it: `git-epic-run.ts`
// only reports the epic label when it was applied, `git-epic-relations.ts` counts the relations it
// could not apply, and `git-epic-close.ts` prints "close it manually" on a false. One try/catch
// rather than four copies of it (`CLAUDE.md` → "No clones").
async function did_write_succeed(write: () => Promise<unknown>): Promise<boolean> {
	try {
		await write()

		return true
	} catch {
		return false
	}
}

async function issue_edit_body(issue_number: string, body: string): Promise<string> {
	return await git_gh_exec.exec_gh_api({
		path: git_gh_api_path.issue_api_path(issue_number),
		method: PATCH_METHOD,
		body: JSON.stringify({ body }),
		jq_filter: HTML_URL_FILTER,
	})
}

async function issue_comment(issue_number: string, body: string): Promise<string> {
	return await git_gh_exec.exec_gh_api({
		path: `${git_gh_api_path.issue_api_path(issue_number)}${COMMENTS_SEGMENT}`,
		body: JSON.stringify({ body }),
		jq_filter: HTML_URL_FILTER,
	})
}

// `gh issue close --comment` posted the comment and closed the issue in one call; REST splits them.
// **The comment goes first**, which is what keeps the return value meaning what it meant: a `false`
// then says "the issue is still open" in *both* failure branches, because the state change is the
// last thing attempted. Closing first would answer `false` for an issue that is in fact closed, and
// `git-epic-close.ts` prints "close it manually" on that answer.
//
// **`comment: undefined` closes without commenting**, and it is what the ordering above costs: a run
// whose comment landed and whose close was refused leaves the issue open carrying the comment, so
// the next run must close it without posting a second copy (joshuafolkken/kit#1039). The return
// value keeps meaning what it meant — with no comment to post, the state change is not merely the
// last thing attempted but the only one.
//
// It is a required parameter that may be `undefined` rather than an optional one: skipping the
// announcement is a decision the caller makes from what it read, never something a call site can
// fall into by leaving an argument off.
async function issue_close(issue_number: string, comment: string | undefined): Promise<boolean> {
	return await did_write_succeed(async () => {
		if (comment !== undefined) await issue_comment(issue_number, comment)
		await git_gh_exec.exec_gh_api({
			path: git_gh_api_path.issue_api_path(issue_number),
			method: PATCH_METHOD,
			body: JSON.stringify({ state: CLOSED_STATE }),
		})
	})
}

// `gh label create` accepted `#5319e7` and stripped the `#` itself; REST answers 422
// `{"resource":"Label","code":"invalid","field":"color"}` for the same value. The one caller passes
// the hash form (`EPIC_LABEL_COLOR`), so dropping it here is what keeps that call site unchanged.
function to_label_color(color: string): string {
	return color.startsWith(COLOR_HASH) ? color.slice(COLOR_HASH.length) : color
}

// `|| true` semantics, unchanged: an existing label answers 422 `already_exists`, which is not an
// error here.
//
// **What swallowing it costs did change, and in the safe direction.** Under `gh`, a label this call
// failed to create surfaced later — `gh issue create --label epic` could not resolve it and failed
// there. REST does not fail: `POST /issues` with `labels: [...]`, and `POST /issues/{N}/labels`,
// both **create** a label the repository does not have, with a generated color and no description
// (measured on joshuafolkken/kit#1026). So a swallowed failure here costs the label's color and
// description, never the label itself — `epic:next` and the auto-close filter on the name, and the
// name is applied either way.
async function label_ensure(input: {
	name: string
	color: string
	description: string
}): Promise<void> {
	try {
		await git_gh_exec.exec_gh_api({
			path: `${git_gh_api_path.repo_api_path()}${LABELS_SEGMENT}`,
			body: JSON.stringify({
				name: input.name,
				color: to_label_color(input.color),
				description: input.description,
			}),
		})
	} catch {
		/* the label already exists */
	}
}

// The browser URL of the created issue, which is what `gh issue create` printed and what
// `git-epic-run.ts` parses the epic's number out of.
async function issue_create_with_label(input: {
	title: string
	label: string
	body: string
}): Promise<string> {
	return await git_gh_exec.exec_gh_api({
		path: git_gh_api_path.issues_api_path(),
		body: JSON.stringify({ title: input.title, labels: [input.label], body: input.body }),
		jq_filter: HTML_URL_FILTER,
	})
}

// Applied after the body edit so a failure leaves an issue with the epic sections and no label,
// which `epic:check` reports — rather than a labelled issue with nothing to track. The caller checks
// the return: the label is what the auto-close filters on (joshuafolkken/kit#865).
async function issue_add_label(issue_number: string, label: string): Promise<boolean> {
	return await did_write_succeed(
		async () =>
			await git_gh_exec.exec_gh_api({
				path: `${git_gh_api_path.issue_api_path(issue_number)}${LABELS_SEGMENT}`,
				body: JSON.stringify({ labels: [label] }),
			}),
	)
}

// The blocker's **database id**, which is the only thing the dependencies endpoint accepts — and the
// reason this resolution exists rather than the issue number being sent straight through.
//
// The endpoint takes `{"issue_id": <n>}` and does not check that `<n>` is an issue in this
// repository, or that it is the number the caller meant. Posting `{"issue_id":1036}` to a scratch
// issue in this repository recorded an issue in a completely unrelated repository — the one whose
// database id happens to be 1036 — as a blocker, with a 200 and no warning (measured on
// joshuafolkken/kit#1026, which names it). Every caller here names a blocker by its issue number, so
// sending that number would silently record an arbitrary issue from anywhere on GitHub.
//
// A resolution that does not produce a usable id throws rather than returning something to send:
// `jq` prints an empty line for a field it cannot reach, and `Number('')` is `0`, which is a value
// the endpoint would happily be given.
async function read_issue_id(issue_number: string): Promise<number> {
	const raw = await git_gh_exec.exec_gh_api({
		path: git_gh_api_path.issue_api_path(issue_number),
		jq_filter: ID_FILTER,
	})
	const issue_id = Number(raw.trim())

	if (!Number.isSafeInteger(issue_id) || issue_id <= 0) {
		throw new Error(`gh api answered no database id for issue #${issue_number}`)
	}

	return issue_id
}

// Applied after creation, never as part of it: the relation is a nicety and the Issue is not, so a
// failure here costs only the relation. It no longer depends on the gh CLI's version — the
// dependencies endpoint is REST, and `gh api` has proxied REST since long before `--add-blocked-by`
// existed (joshuafolkken/kit#1026).
async function issue_add_blocked_by(issue_number: string, blocker: string): Promise<boolean> {
	return await did_write_succeed(async () => {
		const issue_id = await read_issue_id(blocker)

		await git_gh_exec.exec_gh_api({
			path: git_gh_api_path.blocked_by_api_path(issue_number),
			body: JSON.stringify({ issue_id }),
		})
	})
}

// The counterpart, for an insertion that re-points an existing chain: inserting `#N` between `#B`
// and `#M` has to drop `#B -> #M`, or the epic would declare one order and record two
// (joshuafolkken/kit#890). The id goes in the path here rather than in a body, and the endpoint is
// idempotent — deleting a relation that is not there answers 200.
async function issue_remove_blocked_by(issue_number: string, blocker: string): Promise<boolean> {
	return await did_write_succeed(async () => {
		const issue_id = await read_issue_id(blocker)
		const relations_path = git_gh_api_path.blocked_by_api_path(issue_number)

		await git_gh_exec.exec_gh_api({
			path: `${relations_path}/${String(issue_id)}`,
			method: DELETE_METHOD,
		})
	})
}

const git_gh_issue_write = {
	issue_edit_body,
	issue_comment,
	issue_close,
	label_ensure,
	issue_create_with_label,
	issue_add_label,
	issue_add_blocked_by,
	issue_remove_blocked_by,
}

export { git_gh_issue_write }
