import { git_gh_api_path } from '#scripts/git/git-gh-api-path'
import { git_gh_exec } from '#scripts/git/git-gh-exec'
import { poll, type PollOptions } from '#scripts/poll'

// **The release is not finished when the pull request merges — it is finished when the tag exists.**
//
// Merging is what starts the distribution chain: `ci.yml`'s `notify-auto-tag` dispatches, `auto-tag.yml`
// creates `v<version>`, and `publish.yml` / `production.yml` run off that tag. Every link after the
// merge can fail silently, and one of them is known to (joshuafolkken/kit#1481: a later push to main
// cancels the release commit's CI run, so nothing dispatches and nothing is tagged). An automatic
// release would have been picked up by the next cycle; a release a person types has no next cycle, so
// the person walks away believing something shipped when nothing did.
//
// So this waits for the tag and **reports its absence as a failure** (joshuafolkken/kit#1169 → §3).

const HTTP_OK = 200
const TAG_POLL_INTERVAL_MS = 15_000
const MILLISECONDS_PER_SECOND = 1000

// Long enough for main's full CI run plus the dispatch hop that follows it. A release that has not
// been tagged after this has not been slow, it has been lost — which is the answer this reports.
const DEFAULT_TIMEOUT_SECONDS = 1800
const TIMEOUT_ENV = 'JOSH_RELEASE_TAG_TIMEOUT_SECONDS'

function tag_name(version: string): string {
	return `v${version}`
}

function configured_timeout_seconds(raw: string | undefined): number {
	const parsed = Number(raw)

	if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_SECONDS

	return parsed
}

function attempts_for(timeout_seconds: number): number {
	const budget_ms = timeout_seconds * MILLISECONDS_PER_SECOND

	return Math.max(1, Math.ceil(budget_ms / TAG_POLL_INTERVAL_MS))
}

// REST answers 404 for a tag that does not exist, so the status code alone is the whole question.
async function tag_exists(version: string): Promise<boolean> {
	const status = await git_gh_exec.exec_gh_api_status(
		git_gh_api_path.tag_ref_api_path(tag_name(version)),
	)

	return status === HTTP_OK
}

async function wait_for_tag(
	version: string,
	sleeper?: (duration_ms: number) => Promise<void>,
): Promise<boolean> {
	const timeout_seconds = configured_timeout_seconds(process.env[TIMEOUT_ENV])
	// Spread rather than a conditional call: `exactOptionalPropertyTypes` refuses an explicit
	// `sleeper: undefined`, and writing the call twice to satisfy it would duplicate the predicate.
	const options: PollOptions = {
		attempts: attempts_for(timeout_seconds),
		interval_ms: TAG_POLL_INTERVAL_MS,
		...(sleeper !== undefined && { sleeper }),
	}

	return await poll.poll_until(async () => await tag_exists(version), options)
}

// **The failure text says what did not happen rather than what went wrong**, because the command
// cannot know which link broke — only that the tag it was waiting for is not there, and that nothing
// downstream of the tag can have run.
function format_result(version: string, is_tagged: boolean): string {
	if (is_tagged) return `🏷 ${tag_name(version)} exists — the release is published.`

	return [
		`❌ ${tag_name(version)} never appeared.`,
		`  The release pull request merged, but no tag was created, so nothing was published.`,
		`  Check the CI run on main: a later push cancels the release commit's run, which skips the tag (joshuafolkken/kit#1481).`,
	].join('\n')
}

const release_tag = {
	attempts_for,
	configured_timeout_seconds,
	format_result,
	tag_exists,
	tag_name,
	wait_for_tag,
	DEFAULT_TIMEOUT_SECONDS,
	TAG_POLL_INTERVAL_MS,
	TIMEOUT_ENV,
}

export { release_tag }
