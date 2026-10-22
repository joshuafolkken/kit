import { epic_add } from '#scripts/epic/epic-add'
import { epic_bundle_gaps } from '#scripts/epic/epic-bundle-gaps'
import { epic_index } from '#scripts/epic/epic-index'
import { epic_reconcile } from '#scripts/epic/epic-reconcile'
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
// record of its own is kept. Each write is the existing command's implementation, not a copy of it.

// `epic:bundle`'s own listing limit, so both commands see the same epics.
const EPIC_LIMIT = 200
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

async function is_blocked(request: PauseRequest): Promise<boolean> {
	const blockers = await git_gh_issue_read.issue_blocked_by_numbers(request.issue)

	return blockers.includes(Number(request.prerequisite))
}

interface Tracking {
	epic: number
	// Whether the same epic already tracks the prerequisite as a row of its own.
	is_prerequisite_child: boolean
}

// Every epic listing the child, not the one `build_epic_index` keeps: a child a second epic also
// lists is still a row of this one.
function is_listed_by(
	epics: ReadonlyArray<{ number: number; body: string }>,
	child: string,
	epic: number,
): boolean {
	return epic_index.build_tracking_index(epics).get(Number(child))?.includes(epic) === true
}

// A listing cut short is no answer about absence: an epic past the cut tracks `#M` invisibly, and a
// direct relation written then leaves that epic recording an order its body never declares.
async function tracking_epic(request: PauseRequest): Promise<Tracking | undefined> {
	const fetched = await epic_index.fetch_epics(EPIC_LIMIT)
	if (fetched === undefined) throw new Error('the open epics could not be read')
	const index = epic_index.build_epic_index(fetched.epics)
	const epic = index.get(Number(request.issue))

	if (epic === undefined && !epic_bundle_gaps.is_membership_established(fetched.cutoff)) {
		throw new Error('the open epics were not read in full, so an epic tracking it may be unseen')
	}

	if (epic === undefined) return undefined

	return { epic, is_prerequisite_child: is_listed_by(fetched.epics, request.prerequisite, epic) }
}

async function add_to_epic(epic: number, request: PauseRequest): Promise<void> {
	const code = await epic_add.add_children({
		epic_number: epic,
		children: [Number(request.prerequisite)],
		position: { kind: 'before', target: Number(request.issue) },
	})

	if (code !== SUCCESS_EXIT_CODE) {
		throw new Error(`\`epic --add\` into ${session_cite.issue(epic)} failed`)
	}
}

async function record_relation(request: PauseRequest): Promise<void> {
	if (await git_gh_issue_write.issue_add_blocked_by(request.issue, request.prerequisite)) return

	throw new Error('the blocked-by relation was not recorded')
}

async function refuse_unreconcilable(epic: number, request: PauseRequest): Promise<void> {
	const link = { blocker: Number(request.prerequisite), blocked: Number(request.issue) }
	const refusal = await epic_reconcile.refusal_after(epic, link)
	if (refusal === undefined) return

	throw new Error(
		`\`pnpm josh epic --reconcile ${String(epic)}\` would refuse the relation, so none was recorded: ${refusal}`,
	)
}

async function reconcile_epic(epic: number): Promise<void> {
	if ((await epic_reconcile.reconcile_epic(epic)) === SUCCESS_EXIT_CODE) return

	throw new Error(
		`the relation was recorded, but \`pnpm josh epic --reconcile ${String(epic)}\` failed to declare it`,
	)
}

// A prerequisite outside the epic gains its row, declaration and relation from `epic --add --before`.
// One the epic already tracks does not: `epic --add` reads it as a move and drops every order it
// already had, where a pause only adds one — so the relation is recorded directly and
// `epic --reconcile` copies it into the declaration beside the others, once a dry plan shows the
// reconcile accepts it: a refusal after the write would leave the relation undeclared. `epic --add`
// exits 0 on a relation it failed to post, so the relation is read back after the insertion.
async function record_in_epic(tracking: Tracking, request: PauseRequest): Promise<string> {
	if (tracking.is_prerequisite_child) {
		await refuse_unreconcilable(tracking.epic, request)
		await record_relation(request)
		await reconcile_epic(tracking.epic)
	} else {
		await add_to_epic(tracking.epic, request)
		if (!(await is_blocked(request))) await record_relation(request)
	}

	return `recorded in epic ${session_cite.issue(tracking.epic)}`
}

// A relation recorded inside an epic tracking both issues is only done once it is declared, so a
// rerun past a failed reconcile reconciles again — a no-op on an epic that already declares it.
async function settle_recorded(request: PauseRequest): Promise<string> {
	const tracking = await tracking_epic(request)
	if (tracking?.is_prerequisite_child === true) await reconcile_epic(tracking.epic)

	return ALREADY
}

async function blocked_by_step(request: PauseRequest): Promise<string> {
	if (await is_blocked(request)) return await settle_recorded(request)

	const tracking = await tracking_epic(request)
	if (tracking !== undefined) return await record_in_epic(tracking, request)
	await record_relation(request)

	return 'recorded'
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
	['blocked-by', blocked_by_step],
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
