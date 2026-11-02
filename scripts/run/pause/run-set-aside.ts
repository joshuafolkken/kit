import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { parse_json_array_or_undefined } from '#scripts/git/parse-json-array'
import { git_stash } from '#scripts/git/stash/git-stash'
import { stash_push_cli } from '#scripts/git/stash/stash-push-cli'
import { session_cite } from '#scripts/issue/session-cite'
import { error_text } from '#scripts/lib/error-message'
import { run_hold_cli } from '#scripts/run/hold/run-hold-cli'
import { z } from 'zod'

// Setting a run aside — the work stashed under a fixed name, a comment naming the pop, the hold
// released — and the resumable step list `run:pause` and `run:split` both run it through.
//
// **Every step asks whether it is already done before it acts**, so a rerun after a failure carries on
// from the step that failed rather than stashing or commenting twice. The state lives where each write
// lands — the stash stack and the Issue's comments — so no record of its own is kept.

const SUCCESS_EXIT_CODE = 0
const ALREADY = 'already'
const comment_schema = z.object({ body: z.string().nullish() })

interface AsideRequest {
	issue: string
	stash_message: string
	// A hidden line the comment carries, so a rerun finds the comment it already posted.
	marker: string
	headline: string
}

interface StepReport {
	step: string
	detail: string
}

type Step = readonly [string, () => Promise<string>]

type StepsResult =
	| { kind: 'done'; done: ReadonlyArray<StepReport> }
	| { kind: 'failed'; step: string; reason: string; done: ReadonlyArray<StepReport> }

async function is_stashed(request: AsideRequest): Promise<boolean> {
	return git_stash.select(await git_stash.list(), request.stash_message).kind !== 'none'
}

async function stash(request: AsideRequest): Promise<string> {
	if (await is_stashed(request)) return ALREADY

	return await stash_push_cli.set_aside({ message: request.stash_message, dir: undefined })
}

function aside_comment(request: AsideRequest, is_work_stashed: boolean): string {
	const work = is_work_stashed
		? `- The work in progress was stashed. After \`pnpm josh ms\`, recover it with \`pnpm josh stash:pop "${request.stash_message}"\` (expect conflicts).`
		: '- The tree held no uncommitted work, so nothing was stashed.'

	return [request.headline, work, request.marker].join('\n')
}

async function has_comment(request: AsideRequest): Promise<boolean> {
	const json = await git_gh_issue_read.issue_list_comments(request.issue)
	const rows = json === undefined ? undefined : parse_json_array_or_undefined(json, comment_schema)

	if (rows === undefined) {
		throw new Error(`the comments on ${session_cite.issue(request.issue)} could not be read`)
	}

	return rows.some((row) => row.body?.includes(request.marker) === true)
}

async function comment(request: AsideRequest): Promise<string> {
	if (await has_comment(request)) return ALREADY

	const body = aside_comment(request, await is_stashed(request))

	return await git_gh_issue_write.issue_comment(request.issue, body)
}

// Releasing a free record is a success, so a rerun past this step answers `released` again.
async function release(issue: string): Promise<string> {
	const code = await run_hold_cli.run(['--release', issue])
	if (code !== SUCCESS_EXIT_CODE) throw new Error('`run:release` refused')

	return 'released'
}

async function attempt(
	act: () => Promise<string>,
): Promise<{ detail: string } | { reason: string }> {
	try {
		return { detail: await act() }
	} catch (error) {
		return { reason: error_text.message_of(error) }
	}
}

async function run_steps(steps: ReadonlyArray<Step>): Promise<StepsResult> {
	const done: Array<StepReport> = []

	for (const [step, act] of steps) {
		// eslint-disable-next-line no-await-in-loop -- each step runs only once the one before it landed
		const outcome = await attempt(act)
		if ('reason' in outcome) return { kind: 'failed', step, reason: outcome.reason, done }
		done.push({ step, detail: outcome.detail })
	}

	return { kind: 'done', done }
}

// The set-aside steps in order, `between` running after the comment and before the release.
function steps_of(request: AsideRequest, between: ReadonlyArray<Step> = []): ReadonlyArray<Step> {
	return [
		['stash', async () => await stash(request)],
		['comment', async () => await comment(request)],
		...between,
		['release', async () => await release(request.issue)],
	]
}

const run_set_aside = { steps_of, run_steps }

export type { AsideRequest, Step, StepReport, StepsResult }
export { run_set_aside }
