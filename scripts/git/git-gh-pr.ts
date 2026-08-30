import { git_command } from './git-command'
import { git_gh_api_path } from './git-gh-api-path'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_helpers } from './git-gh-helpers'
import { git_gh_issue_write } from './git-gh-issue-write'
import { forget_pr_numbers, git_gh_pr_read, require_pr_number } from './git-gh-pr-read'
import { git_gh_pr_snapshot } from './git-gh-pr-snapshot'

// The pull-request writes, through REST.
//
// `gh pr create` / `comment` / `merge` / `checkout` all go through GraphQL, which a cloud session is
// answered 403 for while the REST endpoints are served normally (joshuafolkken/kit#1022). The reads
// converted first — the ones `gh pr view` served in `git-gh-pr-read.ts` (joshuafolkken/kit#1027) and
// the merge gate's snapshot in `git-gh-pr-snapshot.ts` (joshuafolkken/kit#1028) — and these are the
// last four calls, plus the one whose API use the epic left unconfirmed.
//
// **Every path here was measured against the live API before it was written**, on a throwaway pull
// request opened between two throwaway branches so that neither `main` nor any real pull request was
// touched. Two of the four did not behave as reading the documentation would suggest: see
// `pr_create` for the duplicate-head response and `pr_checkout` for what `gh` actually does.
//
// `pr_checks` — a `gh pr checks <branch>` wrapper — is gone rather than converted. Nothing called it:
// the merge gate reads the rollup out of the snapshot and `git-pr-checks-watch.ts` runs the watching
// variant, so rebuilding it on REST would have added a second, unread path to the same data.

// The browser URL of the pull request, which is what `gh pr create` printed and what `git-pr.ts`
// displays. REST answers the whole object, so the same value is unwrapped out of it.
const HTML_URL_FILTER = '.html_url'
const PUT_METHOD = 'PUT'
// `gh pr merge --merge` produced a merge commit, and this repository allows nothing else
// (`allow_squash_merge` and `allow_rebase_merge` are both false). Sent explicitly rather than left to
// the endpoint's default, so a change to either would fail loudly instead of silently squashing.
const MERGE_COMMIT_METHOD = 'merge'

// **`head` is required and `gh pr create` never asked for it.** The CLI inferred it from the current
// branch; REST does not, and a request without it is a 422. The branch is read from git rather than
// from the pull request the run is about to create.
//
// A branch whose previous pull request merged gets a second one, so the branch → number resolution
// the reads memoize is stale from here on. Clearing it is what keeps `pr_get_url` from answering
// with the merged pull request afterwards.
//
// **The duplicate-head answer is the trap.** `gh pr create` wrote `a pull request for branch … into
// branch … already exists` to stderr, and `handle_pr_create_error` turns any `already exists` into
// the `PR_ALREADY_EXISTS` that `git-pr.ts` recovers from. REST answers 422 with
// `{"message":"Validation Failed","errors":[{"resource":"PullRequest","code":"custom","message":"A
// pull request already exists for <owner>:<branch>."}]}` — which `gh` writes to **stdout**, putting
// only `gh: Validation Failed (HTTP 422)` on stderr. The body reaches the thrown Error because
// `to_gh_error` appends stdout (joshuafolkken/kit#1029); the `already exists` match itself is
// unchanged, because both wordings contain it and the 422 carries no machine-readable code for the
// case (`"code":"custom"`).
async function pr_create(title: string, body: string): Promise<string> {
	const base = await git_command.get_default_branch()
	const head = await git_command.branch()

	forget_pr_numbers()

	try {
		return await git_gh_exec.exec_gh_api({
			path: git_gh_api_path.pulls_api_path(),
			body: JSON.stringify({ title, body, head, base }),
			jq_filter: HTML_URL_FILTER,
		})
	} catch (error) {
		return git_gh_helpers.handle_pr_create_error(error)
	}
}

// **`gh pr checkout` does use GraphQL** — one `POST /graphql` to resolve the pull request, measured
// with `GH_DEBUG=api` on the throwaway pull request (joshuafolkken/kit#1029). Everything after that
// is git, so only the resolution had to move: `pr_head_reference` is the REST read that already
// replaced it for this file's one caller, `sync-dependabot-pins.ts`.
//
// `fetch_branch` updates `refs/remotes/origin/<branch>`, which is what lets the plain `checkout`
// resolve a branch that exists only on the remote — the tracking branch `gh` left behind, by the
// operations `git-command.ts` already owns rather than a new wrapper. The fast-forward is the third
// thing the CLI did and the one a fetch-and-checkout pair silently drops: a branch that is already
// local is checked out at whatever commit the last run left it on.
//
// A fork's head is refused by `pr_head_reference` rather than fetched from `origin` under a name
// that repository may use for something else.
async function pr_checkout(pr_number: number): Promise<void> {
	const branch_name = await git_gh_pr_read.pr_head_reference(pr_number)

	await git_command.fetch_branch(branch_name)
	await git_command.checkout(branch_name)
	await git_command.merge_fast_forward(branch_name)
}

// A pull request's conversation comment is an **issue** comment: `POST issues/{N}/comments` is the
// endpoint, and it answers the same `html_url` for a pull request as for an issue (measured on the
// throwaway pull request). `git-gh-issue-write.ts` already posts to it, so this resolves the number
// and reuses that writer rather than adding a second call site for one endpoint.
async function pr_comment(branch_name: string, body: string): Promise<string> {
	const pr_number = await require_pr_number(branch_name)

	return await git_gh_issue_write.issue_comment(String(pr_number), body)
}

// **The least idempotent write in this layer.** Since joshuafolkken/kit#1065 it carries the shared
// request budget like everything else, and a merge that lands server-side but overruns it throws:
// `followup` then skips its completion notification and the epic auto-close, and a re-run answers
// 405 on a pull request that is already merged. The budget is not what created that — before it the
// same request hung forever, with no notification either and no end to the run — but what `followup`
// should *do* about a request that failed after its effect landed is a recovery design of its own,
// deliberately out of joshuafolkken/kit#1065's scope. Tracked in joshuafolkken/kit#1077.
async function pr_merge(branch_name: string): Promise<void> {
	const pr_number = await require_pr_number(branch_name)

	await git_gh_exec.exec_gh_api({
		path: git_gh_api_path.pull_merge_api_path(String(pr_number)),
		method: PUT_METHOD,
		body: JSON.stringify({ merge_method: MERGE_COMMIT_METHOD }),
	})
}

const git_gh_pr = {
	...git_gh_pr_read,
	...git_gh_pr_snapshot,
	pr_create,
	pr_checkout,
	pr_comment,
	pr_merge,
}

export { git_gh_pr, MERGE_COMMIT_METHOD }
