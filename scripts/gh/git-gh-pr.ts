import { pr_classification, type ReleaseClassification } from '#scripts/ci/pr-classification'
import { git_command } from '#scripts/git/git-command'
import { poll } from '#scripts/lib/poll'
import { z } from 'zod'
import { git_gh_api_path } from './git-gh-api-path'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_helpers } from './git-gh-helpers'
import { git_gh_issue_write } from './git-gh-issue-write'
import { forget_pr_numbers, git_gh_pr_read, read_pull, require_pr_number } from './git-gh-pr-read'
import { git_gh_pr_rest } from './git-gh-pr-rest'
import { git_gh_pr_snapshot } from './git-gh-pr-snapshot'

// The pull-request writes, through REST.
//
// `gh pr create` / `comment` / `merge` / `checkout` all go through GraphQL, which a cloud session is
// answered 403 for while the REST endpoints are served normally. The reads
// converted first — the ones `gh pr view` served in `git-gh-pr-read.ts` and
// the merge gate's snapshot in `git-gh-pr-snapshot.ts` — and these are the
// last four calls, plus the one whose API use the epic left unconfirmed.
//
// **Every path here was measured against the live API before it was written**, on a throwaway pull
// request opened between two throwaway branches so that neither `main` nor any real pull request was
// touched. Two of the four did not behave as reading the documentation would suggest: see
// `pr_create` for the duplicate-head response. The other, `pr_checkout`, is gone with its one caller,
// `sync-dependabot-pins`.
//
// `pr_checks` — a `gh pr checks <branch>` wrapper — is gone rather than converted. Nothing called it:
// the merge gate reads the rollup out of the snapshot and `git-pr-checks-watch.ts` runs the watching
// variant, so rebuilding it on REST would have added a second, unread path to the same data.

// The browser URL of the pull request, which is what `gh pr create` printed and what `git-pr.ts`
// displays. REST answers the whole object, so the same value is unwrapped out of it.
const HTML_URL_FILTER = '.html_url'
const PUT_METHOD = 'PUT'
const PATCH_METHOD = 'PATCH'
// `gh pr merge --merge` produced a merge commit, and this repository allows nothing else
// (`allow_squash_merge` and `allow_rebase_merge` are both false). Sent explicitly rather than left to
// the endpoint's default, so a change to either would fail loudly instead of silently squashing.
const MERGE_COMMIT_METHOD = 'merge'
// The one write worth waiting longer for, and the only per-request override in this file. It is the
// least idempotent request the layer makes, so the failure the shared 60-second budget produces is
// the expensive one: a merge that landed while the request was already being abandoned. Three
// minutes lowers how often that happens without leaving the request unbounded — the recovery below
// is what actually removes the failure mode, and this only makes it rarer.
const MERGE_REQUEST_TIMEOUT_MS = 180_000
// What a failed merge whose outcome could not be read back is reported as. Deliberately neither
// "merged" nor "not merged": nobody read it.
const MERGE_UNCONFIRMED_MESSAGE =
	'gh api could not read the pull request back after the merge request failed'
const MERGE_READ_BACK_ATTEMPTS = 3
const MERGE_READ_BACK_INTERVAL_MS = 1000
const PR_NUMBER_PATTERN = /\/pull\/([1-9]\d*)$/u
const LABELS_SEGMENT = '/labels'
const PR_LABELS = z.array(z.object({ name: z.string() }))

async function add_pr_classification(number: string, label: ReleaseClassification): Promise<void> {
	await git_gh_exec.exec_gh_api({
		path: `${git_gh_api_path.issue_api_path(number)}${LABELS_SEGMENT}`,
		body: JSON.stringify({ labels: [label] }),
	})
}

async function pr_get_classification(
	branch_name: string,
): Promise<ReleaseClassification | undefined> {
	const number = await require_pr_number(branch_name)
	const response = await git_gh_exec.exec_gh_api({
		path: `${git_gh_api_path.issue_api_path(String(number))}${LABELS_SEGMENT}`,
	})
	const names = PR_LABELS.parse(JSON.parse(response)).map((label) => label.name.toLowerCase())
	const selected = names.filter((name) => pr_classification.is_classification(name))
	if (selected.length === 0) return undefined

	const error = pr_classification.classification_error(names, 'human')
	if (error !== undefined) throw new Error(error)

	return selected[0]
}

async function pr_ensure_classification(
	branch_name: string,
	label: ReleaseClassification,
): Promise<void> {
	if ((await pr_get_classification(branch_name)) !== undefined) return

	const number = await require_pr_number(branch_name)

	await add_pr_classification(String(number), label)
}

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
// `to_gh_error` appends stdout; the `already exists` match itself is
// unchanged, because both wordings contain it and the 422 carries no machine-readable code for the
// case (`"code":"custom"`).
async function post_pull_request(title: string, body: string): Promise<string> {
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

async function pr_create(
	title: string,
	body: string,
	label: ReleaseClassification,
): Promise<string> {
	const classification_error = pr_classification.classification_error([label], 'human')
	if (classification_error !== undefined) throw new Error(classification_error)

	const url = await post_pull_request(title, body)
	const number = PR_NUMBER_PATTERN.exec(url)?.[1]

	if (number === undefined) throw new Error(`Could not identify the created pull request: ${url}`)

	await add_pr_classification(number, label)

	return url
}

// A pull request's conversation comment is an **issue** comment: `POST issues/{N}/comments` is the
// endpoint, and it answers the same `html_url` for a pull request as for an issue (measured on the
// throwaway pull request). `git-gh-issue-write.ts` already posts to it, so this resolves the number
// and reuses that writer rather than adding a second call site for one endpoint.
async function pr_comment(branch_name: string, body: string): Promise<string> {
	const pr_number = await require_pr_number(branch_name)

	return await git_gh_issue_write.issue_comment(String(pr_number), body)
}

// Replaces the body of the branch's open pull request. `git -y` opens a pull request once, so a
// body supplied on a later run — the live-execution evidence `followup` gates the merge on
// — reaches an already-open one only through this write. The remembered
// detail read holds the old body, so it is cleared first.
async function pr_update_body(branch_name: string, body: string): Promise<void> {
	const pr_number = await require_pr_number(branch_name)

	forget_pr_numbers()
	await git_gh_exec.exec_gh_api({
		path: git_gh_api_path.pull_api_path(String(pr_number)),
		method: PATCH_METHOD,
		body: JSON.stringify({ body }),
	})
}

// A merge moves the remembered detail read's state, so it is cleared first.
async function put_merge(pr_number: number): Promise<void> {
	forget_pr_numbers()
	await git_gh_exec.exec_gh_api({
		path: git_gh_api_path.pull_merge_api_path(String(pr_number)),
		method: PUT_METHOD,
		body: JSON.stringify({ merge_method: MERGE_COMMIT_METHOD }),
		timeout_ms: MERGE_REQUEST_TIMEOUT_MS,
	})
}

// `undefined` is "nobody read it", kept apart from the `false` that means "the pull request is not
// merged". Folding the two would report an unread state as a settled answer.
async function read_merge_state(pr_number: number): Promise<boolean | undefined> {
	try {
		return git_gh_pr_rest.is_merged(await read_pull(pr_number))
	} catch (error) {
		// The reason goes in the line, for the same reason the poll loop's warning carries one: the
		// failure this throws below names the *merge* request as its cause, so without this an operator
		// is told the pull request could not be read back and never why.
		console.warn(`Could not read the pull request back: ${String(error)}`)

		return undefined
	}
}

// The wait goes **between** attempts and never after the last one — the convention `poll.wait_between`
// and `git-pr-checks.ts`'s own `sleep_before_next_attempt` both hold to. Without the guard a merge
// whose read-back never succeeds delays its own failure report by a whole interval.
async function sleep_between_read_backs(attempt: number): Promise<void> {
	if (attempt < MERGE_READ_BACK_ATTEMPTS - 1) await poll.sleep(MERGE_READ_BACK_INTERVAL_MS)
}

// Whether the merge is actually there, asked only after the request failed.
//
// **The read-back is retried, because the outage that killed the merge request is the one most
// likely to kill the read that follows it** — the same rate limit, the same dropped connection. One
// unretried request would therefore fail hardest in exactly the case this recovery exists for. Three
// attempts a second apart get past a dropped connection; a real outage still ends below, and a
// re-run of `followup` recovers from that.
//
// **A read that failed is still not an answer.** Out of attempts it throws rather than reporting
// `false`, carrying the merge failure as its `cause`, so no run ever concludes "the merge did not
// happen" from a read nobody got.
async function has_merge_landed(pr_number: number, merge_error: unknown): Promise<boolean> {
	for (let attempt = 0; attempt < MERGE_READ_BACK_ATTEMPTS; attempt += 1) {
		// eslint-disable-next-line no-await-in-loop -- a retry runs only after the previous attempt has answered
		const is_merged = await read_merge_state(pr_number)
		if (is_merged !== undefined) return is_merged

		// eslint-disable-next-line no-await-in-loop -- a retry runs only after the previous attempt has answered
		await sleep_between_read_backs(attempt)
	}

	throw new Error(MERGE_UNCONFIRMED_MESSAGE, { cause: merge_error })
}

// **The least idempotent write in this layer, made re-entrant**.
//
// The request carries a budget like everything else, and a merge that lands server-side but overruns
// it throws: on its own that would make `followup` skip its completion notification and the epic
// auto-close, and a re-run answer 405 on a pull request that is already merged. The budget does not
// create that — without it the same request hangs forever, with no notification either and no end to
// the run — it only turns a silent hang into a loud failure.
//
// **A failed merge request is not proof the merge did not happen**, so the pull request's own state
// settles it: merged, and this returns as if the request had succeeded, which is what lets
// `followup` carry on to the notification and the epic close, and what makes re-running it recover
// instead of failing on the 405. Not merged, and the original failure is rethrown unchanged.
//
// **The question is "is this pull request merged", not "did my request merge it"**, and that is
// deliberate: the state the recovery has to act on is whether the branch is in, and a merge someone
// made by hand between the failure and the read leaves `followup` with exactly the same work to
// finish. REST offers nothing that would tell the two apart without keeping the merge commit's SHA
// across a request that never answered.
async function pr_merge(branch_name: string): Promise<void> {
	const pr_number = await require_pr_number(branch_name)

	try {
		await put_merge(pr_number)
	} catch (error) {
		if (!(await has_merge_landed(pr_number, error))) throw error
	}
}

const git_gh_pr = {
	...git_gh_pr_read,
	...git_gh_pr_snapshot,
	pr_create,
	pr_get_classification,
	pr_ensure_classification,
	pr_comment,
	pr_merge,
	pr_update_body,
}

export { git_gh_pr, MERGE_COMMIT_METHOD, MERGE_REQUEST_TIMEOUT_MS, MERGE_UNCONFIRMED_MESSAGE }
