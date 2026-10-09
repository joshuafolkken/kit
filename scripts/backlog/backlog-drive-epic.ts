import { git_gh_repo } from '#scripts/gh/git-gh-repo'
import { issue_cite } from '#scripts/issue/issue-cite'
import { josh_command } from '#scripts/josh/josh-run'
import type { DriveState, OfferRead } from './backlog-drive'
import { backlog_drive_named } from './backlog-drive-named'
import { backlog_offer } from './backlog-offer'

// A named epic is driven from the epic itself. The work list is the epic's
// current children as `epic:next` derives them, never a copy in the carry record — so a child filed
// into the epic mid-run, by any route (`issue:file`, `epic --add`, a hand edit), is dispatched once it
// is runnable, without `run:add` and without waking a parent session.
//
// **Only what needs a person is handed back.** `stop` means every child left waits on a person, which a
// judgment session reads. A failed `epic:next` is either a network blip or a broken graph (a cycle, an
// undeclared order, an unreadable child), and its exit code does not tell them apart — so a failure is
// a `wait` that retries on the next pass, and `backlog:offer`'s consecutive-retry limit of them hands the
// epic back too, rather than waiting out the idle budget on an anomaly nobody is shown.

const NO_RETRIES = 0
const SUCCESS_EXIT_CODE = 0
const FIRST_LINE = 0
const ISSUE_TOKEN = /^\d+$/u
const WAIT: OfferRead = { verdict: 'wait', issues: [], retries: NO_RETRIES }

// `--lanes` lists every child a free lane could take, so one the loop already knows about is passed
// over rather than standing in front of the rest. `undefined` is an answer that could not be read.
async function ask_next(epic: string): Promise<ReadonlyArray<string> | undefined> {
	const repo = await git_gh_repo.repo_get_name_with_owner()
	if (repo === undefined) return undefined
	const result = await josh_command.josh_run(['epic:next', epic, '--repo', repo, '--lanes'], true)

	return result.code === SUCCESS_EXIT_CODE ? result.out.trim().split('\n') : undefined
}

function handed_back(epic: string): OfferRead {
	return { ...WAIT, verdict: `epic ${issue_cite.plain(epic)}` }
}

function failed_offer(epic: string, state: DriveState): OfferRead {
	const retries = state.retries + 1

	return retries >= backlog_offer.RETRY_LIMIT ? handed_back(epic) : { ...WAIT, retries }
}

// A child the loop already launched, or merged and excluded, can still read as runnable while GitHub
// catches up, so it is skipped rather than launched twice. One child per offer
// keeps the carried maximum checked before each launch.
function child_offer(children: ReadonlyArray<string>, state: DriveState): OfferRead {
	const child = children.find(
		(item) => !state.in_flight.includes(item) && !state.exclude.includes(item),
	)

	return child === undefined ? WAIT : { verdict: 'run', issues: [child], retries: NO_RETRIES }
}

async function answered_offer(
	epic: string,
	answers: ReadonlyArray<string>,
	state: DriveState,
	owner: string,
): Promise<OfferRead> {
	const token = answers[FIRST_LINE]

	if (token !== undefined && ISSUE_TOKEN.test(token)) return child_offer(answers, state)
	if (token === 'stop') return handed_back(epic)

	if (token === 'complete') {
		await backlog_drive_named.mark_done(epic, { outcome: 'merged', code: 0, token: 'none' }, owner)
	}

	return WAIT
}

async function offer(epic: string, state: DriveState, owner: string): Promise<OfferRead> {
	const answers = await ask_next(epic)

	return answers === undefined
		? failed_offer(epic, state)
		: await answered_offer(epic, answers, state, owner)
}

export const backlog_drive_epic = { offer }
