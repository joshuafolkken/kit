import { epic_relations } from '#scripts/epic/epic-relations'
import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { issue_cite } from './issue-cite'
import { INTERRUPT_ROUTE_LABEL, NEEDS_DECISION_LABEL } from './issue-labels'
import { session_cite } from './session-cite'

// What `josh issue:file` just filed on `--route interrupt --blocks-finder`: the Issue whose work turned
// the defect up is recorded as blocked by it, in the same command as the filing — so a session that
// dies after the filing still leaves the dispatch a relation that keeps the finder back until the
// interrupt lands (`upstream-interrupt.md` → the run-machinery case). An interrupt that blocks nobody
// (`wip-cap.md` → the three conditions) omits the flag, since a relation there is a false dependency.
// Written through the relation path epic creation and `epic --add` use, and only for a filing in this
// repository: the relation write resolves both numbers here.
//
// The Issue already exists, so a failed write is reported rather than failed, for the reason
// `issue-file-cli.ts` → `place` gives.
//
// **A parked finder blocks without the flag.** A finder carrying `needs-decision` stopped for what the
// interrupt now names, so the stop is a dependency, not a person's judgement (`prerequisite.md`): the
// relation is recorded, the conversion is written as the decision, and the label goes — the merge of
// the interrupt then relaunches the finder (`backlog_drive_retry.after_merge`, joshuafolkken/kit#6741).

const DECISION_PREFIX = '決定:'
const CONVERTED_NOTE = 'の着地待ち（依存に変換）'

interface BlockedPair {
	blocked: number
	blocker: number
}

interface InterruptFiling {
	route: string | undefined
	is_blocking_finder: boolean
	found_during: string | undefined
	blocker: number
	is_here: boolean
}

function is_issue_number(value: number): boolean {
	return Number.isSafeInteger(value) && value > 0
}

function finder_of(filing: InterruptFiling): number | undefined {
	if (filing.route !== INTERRUPT_ROUTE_LABEL || !filing.is_here) return undefined
	const finder = Number(filing.found_during)

	return is_issue_number(finder) ? finder : undefined
}

// An explicit `--blocks-finder` that records nothing is said, so the caller does not read the
// silence as a recorded relation and leave the finder dispatchable.
function ignored_line(filing: InterruptFiling): string {
	const reason =
		filing.route === INTERRUPT_ROUTE_LABEL
			? 'no finder and filed Issue pair in this repository was read'
			: 'it applies to `--route interrupt` only'

	return `⚠ --blocks-finder recorded nothing: ${reason}.`
}

// The re-run writes the one relation and nothing else — no epic placement and no chain splice, which
// would record dependencies the interrupt does not have.
function failure_line(blocked: number, blocker: number): string {
	const path = git_gh_api_path.blocked_by_api_path(String(blocked))
	const id = `$(gh api ${git_gh_api_path.issue_api_path(String(blocker))} --jq .id)`
	const cited = `${session_cite.issue(blocked)} could not be recorded as blocked by ${session_cite.issue(blocker)}`

	return `⚠ ${cited} — run \`gh api ${path} -F issue_id=${id}\`.`
}

async function record(pair: BlockedPair): Promise<boolean> {
	const links = [pair]
	const failures = await epic_relations.apply_relations(links, 'record')

	if (failures === 0) {
		console.info(epic_relations.format_relation_report({ links, failures, action: 'record' }))

		return true
	}

	console.error(failure_line(pair.blocked, pair.blocker))

	return false
}

function pair_of(filing: InterruptFiling): BlockedPair | undefined {
	const blocked = finder_of(filing)

	return blocked !== undefined && is_issue_number(filing.blocker)
		? { blocked, blocker: filing.blocker }
		: undefined
}

async function is_parked(pair: BlockedPair | undefined): Promise<boolean> {
	if (pair === undefined) return false
	const names = await git_gh_issue_write.read_label_names(String(pair.blocked))

	return names?.includes(NEEDS_DECISION_LABEL) === true
}

function kept_line(finder: string, decision: string): string {
	return `⚠ ${session_cite.issue(finder)} kept ${NEEDS_DECISION_LABEL} — post "${decision}" if it is missing, then run \`pnpm josh run:park ${finder} --clear\`.`
}

// The label goes only after the decision is written, so the relaunched finder never reads its park
// question unanswered; either failure keeps the park and names the re-run.
async function convert_park(pair: BlockedPair): Promise<void> {
	const finder = String(pair.blocked)
	const decision = `${DECISION_PREFIX} ${issue_cite.plain_for('github', pair.blocker)} ${CONVERTED_NOTE}`
	const is_cleared =
		(await git_gh_issue_write.issue_try_comment(finder, decision)) &&
		(await git_gh_issue_write.issue_clear_label(finder, NEEDS_DECISION_LABEL))

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
