import { epic_blocked_by } from '#scripts/epic/epic-blocked-by'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { parse_json_array_or_undefined } from '#scripts/git/parse-json-array'
import { git_stash } from '#scripts/git/stash/git-stash'
import { stash_push_cli } from '#scripts/git/stash/stash-push-cli'
import { issue_cite } from '#scripts/issue/issue-cite'
import { session_cite } from '#scripts/issue/session-cite'
import { error_text } from '#scripts/lib/error-message'
import { run_hold_cli } from '#scripts/run/hold/run-hold-cli'
import { z } from 'zod'

// `josh run:pause <M> --for <N>` — set a run aside while its prerequisite `#N` lands first
// (`prerequisite.md`): the work in progress stashed under a fixed name, a comment on `#M` naming the
// pop, `#M` blocked by `#N` and the hold released, in that order.
//
// **Every step asks whether it is already done before it acts**, so a rerun after a failure carries on
// from the step that failed rather than stashing, commenting or recording twice. The state lives where
// each write lands — the stash stack, the Issue's comments and its `blocked_by` relations — so no
// record of its own is kept. Each write is the existing command's implementation, not a copy of it;
// the relation is `epic_blocked_by.record`'s, which keeps the tracking epic's declaration beside it.

const SUCCESS_EXIT_CODE = 0
const ALREADY = 'already'
const comment_schema = z.object({ body: z.string().nullish() })

interface PauseRequest {
	issue: string
	prerequisite: string
}

type StepName = 'stash' | 'comment' | 'blocked-by' | 'release'

interface StepReport {
	step: StepName
	detail: string
}

type PauseResult =
	| { kind: 'paused'; done: ReadonlyArray<StepReport> }
	| { kind: 'failed'; step: StepName; reason: string; done: ReadonlyArray<StepReport> }

function stash_message(request: PauseRequest): string {
	return `run:pause: ${issue_cite.plain(request.issue)} waits on ${issue_cite.plain(request.prerequisite)}`
}

function comment_marker(request: PauseRequest): string {
	return `<!-- josh:run-pause ${issue_cite.plain(request.issue)} for ${issue_cite.plain(request.prerequisite)} -->`
}

async function is_stashed(request: PauseRequest): Promise<boolean> {
	return git_stash.select(await git_stash.list(), stash_message(request)).kind !== 'none'
}

async function stash_step(request: PauseRequest): Promise<string> {
	if (await is_stashed(request)) return ALREADY

	return await stash_push_cli.set_aside({ message: stash_message(request), dir: undefined })
}

function pause_comment(request: PauseRequest, is_work_stashed: boolean): string {
	const work = is_work_stashed
		? `- The work in progress was stashed. After \`pnpm josh ms\`, recover it with \`pnpm josh stash:pop "${stash_message(request)}"\` (expect conflicts).`
		: '- The tree held no uncommitted work, so nothing was stashed.'

	return [
		`Paused: ${issue_cite.plain(request.prerequisite)} has to land first.`,
		work,
		comment_marker(request),
	].join('\n')
}

async function has_pause_comment(request: PauseRequest): Promise<boolean> {
	const json = await git_gh_issue_read.issue_list_comments(request.issue)
	const rows = json === undefined ? undefined : parse_json_array_or_undefined(json, comment_schema)

	if (rows === undefined) {
		throw new Error(`the comments on ${session_cite.issue(request.issue)} could not be read`)
	}

	return rows.some((row) => row.body?.includes(comment_marker(request)) === true)
}

async function comment_step(request: PauseRequest): Promise<string> {
	if (await has_pause_comment(request)) return ALREADY

	const body = pause_comment(request, await is_stashed(request))

	return await git_gh_issue_write.issue_comment(request.issue, body)
}

// Releasing a free record is a success, so a rerun past this step answers `released` again.
async function release_step(request: PauseRequest): Promise<string> {
	const code = await run_hold_cli.run(['--release', request.issue])
	if (code !== SUCCESS_EXIT_CODE) throw new Error('`run:release` refused')

	return 'released'
}

const STEPS: ReadonlyArray<[StepName, (request: PauseRequest) => Promise<string>]> = [
	['stash', stash_step],
	['comment', comment_step],
	['blocked-by', epic_blocked_by.record],
	['release', release_step],
]

async function attempt(
	act: (request: PauseRequest) => Promise<string>,
	request: PauseRequest,
): Promise<{ detail: string } | { reason: string }> {
	try {
		return { detail: await act(request) }
	} catch (error) {
		return { reason: error_text.message_of(error) }
	}
}

async function pause(request: PauseRequest): Promise<PauseResult> {
	const done: Array<StepReport> = []

	for (const [step, act] of STEPS) {
		// eslint-disable-next-line no-await-in-loop -- each step runs only once the one before it landed
		const outcome = await attempt(act, request)
		if ('reason' in outcome) return { kind: 'failed', step, reason: outcome.reason, done }
		done.push({ step, detail: outcome.detail })
	}

	return { kind: 'paused', done }
}

const run_pause = { pause }

export type { PauseRequest, PauseResult, StepReport }
export { run_pause }
