import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { git_stash } from '#scripts/git/stash/git-stash'
import { stash_push_cli } from '#scripts/git/stash/stash-push-cli'
import { error_text } from '#scripts/lib/error-message'
import { run_hold_cli } from '#scripts/run/hold/run-hold-cli'
import { run_pause_comment } from './run-pause-comment'
import { run_set_aside_commit } from './run-set-aside-commit'

// Setting a run aside — the work committed on the run's lane branch (`run-set-aside-commit.ts`) or,
// off a lane, stashed under a fixed name, a comment naming the resume, the hold released — and the
// resumable step list `run:pause` and `run:split` both run it through.
//
// **Every step asks whether it is already done before it acts**, so a rerun after a failure carries on
// from the step that failed rather than setting aside or commenting twice. The state lives where each
// write lands — the branch head, the stash stack and the Issue's comments — so no record of its own is
// kept.

const SUCCESS_EXIT_CODE = 0
const ALREADY = 'already'

interface AsideRequest {
	issue: string
	stash_message: string
	// A hidden line the comment carries, so a rerun finds the comment it already posted.
	marker: string
	headline: string
	// The work leaves this issue (a split into children) rather than resuming on its own lane, so it
	// is stashed even on the lane branch — a WIP commit there would strand it and keep the lane open.
	is_handed_off?: boolean
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

async function is_committed_aside(request: AsideRequest): Promise<boolean> {
	if (request.is_handed_off === true) return false

	return await run_set_aside_commit.is_lane(request.issue)
}

async function set_aside(request: AsideRequest): Promise<string> {
	if (!(await is_committed_aside(request))) return await stash(request)

	return await run_set_aside_commit.commit(request.stash_message)
}

const NOTHING_SET_ASIDE = '- The tree held no uncommitted work, so nothing was set aside.'

function committed_line(request: AsideRequest): string {
	const message = run_set_aside_commit.message_of(request.stash_message)

	return `- The work in progress was committed on the lane branch as \`${message}\`. To resume, run \`pnpm josh main:merge\` on the lane and continue.`
}

function stashed_line(request: AsideRequest): string {
	return `- The work in progress was stashed. After \`pnpm josh ms\`, recover it with \`pnpm josh stash:pop "${request.stash_message}"\`.`
}

async function work_line(request: AsideRequest): Promise<string> {
	if (await is_committed_aside(request)) {
		const is_committed = await run_set_aside_commit.is_committed(request.stash_message)

		return is_committed ? committed_line(request) : NOTHING_SET_ASIDE
	}

	return (await is_stashed(request)) ? stashed_line(request) : NOTHING_SET_ASIDE
}

async function comment(request: AsideRequest): Promise<string> {
	if (await run_pause_comment.has_comment(request)) return ALREADY

	const body = [request.headline, await work_line(request), request.marker].join('\n')

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
		['set-aside', async () => await set_aside(request)],
		['comment', async () => await comment(request)],
		...between,
		['release', async () => await release(request.issue)],
	]
}

const run_set_aside = { steps_of, run_steps }

export type { AsideRequest, Step, StepReport, StepsResult }
export { run_set_aside }
