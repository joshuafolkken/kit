import { epic_relations } from '#scripts/epic/epic-relations'
import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { session_language } from '#scripts/josh/session-language'
import { issue_cite } from './issue-cite'
import { INTERRUPT_ROUTE_LABEL, NEEDS_DECISION_LABEL } from './issue-labels'
import { session_cite } from './session-cite'

// What `josh issue:file` just filed on `--route interrupt --blocks-finder`: the Issue whose work turned
// the defect up is recorded as blocked by it, in the same command as the filing — so a session that
// dies after the filing still leaves the dispatch a relation that keeps the finder back until the
// interrupt lands (`upstream-interrupt.md` → the run-machinery case). An interrupt that blocks nobody
// (`wip-cap.md` → the three conditions) omits the flag, since a relation there is a false dependency.
// Written through the relation path epic creation and `epic --add` use for a filing in this
// repository; a filing in another repository (an upstream interrupt) resolves the blocker there, so the
// finder waits on it as on a local one (joshuafolkken/kit#7695).
//
// The Issue already exists, so a failed write is reported rather than failed, for the reason
// `issue-file-cli.ts` → `place` gives.
//
// **A parked finder blocks without the flag.** A finder carrying `needs-decision` stopped for what the
// interrupt now names, so the stop is a dependency, not a person's judgement (`prerequisite.md`): the
// relation is recorded, the conversion is written as the decision, and the label goes — the merge of
// the interrupt then relaunches the finder (`backlog_drive_retry.after_merge`, joshuafolkken/kit#6741).

// Only the note follows the session language; `DECISION_PREFIX` stays fixed in every language.
const DECISION_PREFIX = '決定:'
const JAPANESE_CONVERTED_NOTE = 'の着地待ち（依存に変換）'
const ENGLISH_CONVERTED_NOTE = 'to land (converted to a dependency)'

// `blocker_repo` is the filed Issue's `owner/repo` where it is not this repository, else `undefined`.
// `repo` is the finder's, named on every finder-side call: a filing in another repository points
// `GH_REPO` at its target, so `{owner}/{repo}` would resolve the finder's number there.
interface BlockedPair {
	blocked: number
	blocker: number
	blocker_repo: string | undefined
	repo: string
}

interface InterruptFiling {
	route: string | undefined
	is_blocking_finder: boolean
	found_during: string | undefined
	blocker: number
	blocker_repo: string | undefined
	finder_repo: string
}

function is_issue_number(value: number): boolean {
	return Number.isSafeInteger(value) && value > 0
}

function finder_of(filing: InterruptFiling): number | undefined {
	if (filing.route !== INTERRUPT_ROUTE_LABEL) return undefined
	const finder = Number(filing.found_during)

	return is_issue_number(finder) ? finder : undefined
}

// An explicit `--blocks-finder` that records nothing is said, so the caller does not read the
// silence as a recorded relation and leave the finder dispatchable.
function ignored_line(filing: InterruptFiling): string {
	const reason =
		filing.route === INTERRUPT_ROUTE_LABEL
			? 'no finder and filed Issue pair was read'
			: 'it applies to `--route interrupt` only'

	return `⚠ --blocks-finder recorded nothing: ${reason}.`
}

// The re-run writes the one relation and nothing else — no epic placement and no chain splice, which
// would record dependencies the interrupt does not have.
function failure_line(pair: BlockedPair): string {
	const path = git_gh_api_path.blocked_by_api_path(String(pair.blocked), pair.repo)
	const blocker_path = git_gh_api_path.issue_api_path(String(pair.blocker), pair.blocker_repo)
	const id = `$(gh api ${blocker_path} --jq .id)`
	const blocker = issue_cite.plain_for('linked', pair.blocker, pair.blocker_repo)
	const cited = `${session_cite.issue(pair.blocked)} could not be recorded as blocked by ${blocker}`

	return session_cite.text(`⚠ ${cited} — run \`gh api ${path} -F issue_id=${id}\`.`)
}

// A blocker here goes through the epic relation path; one in another repository is written directly,
// since that path resolves both numbers in this repository.
async function write_relation(pair: BlockedPair): Promise<boolean> {
	if (pair.blocker_repo !== undefined) {
		const { blocked, blocker, blocker_repo, repo } = pair

		return await git_gh_issue_write.issue_add_blocked_by(
			String(blocked),
			String(blocker),
			blocker_repo,
			repo,
		)
	}

	const { blocked, blocker } = pair

	return (await epic_relations.apply_relations([{ blocked, blocker }], 'record')) === 0
}

function recorded_line(pair: BlockedPair): string {
	if (pair.blocker_repo === undefined) {
		return epic_relations.format_relation_report({ links: [pair], failures: 0, action: 'record' })
	}

	const blocker = issue_cite.plain_for('linked', pair.blocker, pair.blocker_repo)

	return session_cite.text(`${session_cite.issue(pair.blocked)} recorded as blocked by ${blocker}`)
}

async function record(pair: BlockedPair): Promise<boolean> {
	const is_recorded = await write_relation(pair)

	if (is_recorded) console.info(recorded_line(pair))
	else console.error(failure_line(pair))

	return is_recorded
}

function pair_of(filing: InterruptFiling): BlockedPair | undefined {
	const blocked = finder_of(filing)
	const { blocker, blocker_repo, finder_repo } = filing

	return blocked !== undefined && is_issue_number(blocker)
		? { blocked, blocker, blocker_repo, repo: finder_repo }
		: undefined
}

async function is_parked(pair: BlockedPair | undefined): Promise<boolean> {
	if (pair === undefined) return false
	const names = await git_gh_issue_write.read_label_names(String(pair.blocked), pair.repo)

	return names?.includes(NEEDS_DECISION_LABEL) === true
}

function kept_line(finder: string, decision: string): string {
	return `⚠ ${session_cite.issue(finder)} kept ${NEEDS_DECISION_LABEL} — post "${decision}" if it is missing, then run \`pnpm josh run:park ${finder} --clear\`.`
}

function blocker_note(blocker: string): string {
	return session_language.is_japanese(session_language.resolve_session_lang().lang)
		? `${blocker} ${JAPANESE_CONVERTED_NOTE}`
		: `waiting for ${blocker} ${ENGLISH_CONVERTED_NOTE}`
}

// The label goes only after the decision is written, so the relaunched finder never reads its park
// question unanswered; either failure keeps the park and names the re-run.
async function convert_park(pair: BlockedPair): Promise<void> {
	const finder = String(pair.blocked)
	const blocker = issue_cite.plain_for('github', pair.blocker, pair.blocker_repo)
	const decision = `${DECISION_PREFIX} ${blocker_note(blocker)}`
	const is_cleared =
		(await git_gh_issue_write.issue_try_comment(finder, decision, pair.repo)) &&
		(await git_gh_issue_write.issue_clear_label(finder, NEEDS_DECISION_LABEL, pair.repo))

	if (!is_cleared) console.error(kept_line(finder, decision))
}

async function block_pair(
	filing: InterruptFiling,
	pair: BlockedPair | undefined,
	is_converting: boolean,
): Promise<void> {
	if (pair === undefined) {
		console.warn(ignored_line(filing))

		return
	}

	const is_recorded = await record(pair)

	if (is_converting && is_recorded) await convert_park(pair)
}

async function block_finder(filing: InterruptFiling): Promise<void> {
	const pair = pair_of(filing)
	const is_converting = await is_parked(pair)

	if (!is_converting && !filing.is_blocking_finder) return
	await block_pair(filing, pair, is_converting)
}

const issue_file_interrupt = { block_finder }

export { issue_file_interrupt }
