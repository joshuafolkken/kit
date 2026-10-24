import { epic_relations } from '#scripts/epic/epic-relations'
import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { INTERRUPT_ROUTE_LABEL } from './issue-labels'
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

async function record(blocked: number, blocker: number): Promise<void> {
	const links = [{ blocked, blocker }]
	const failures = await epic_relations.apply_relations(links, 'record')

	if (failures === 0) {
		console.info(epic_relations.format_relation_report({ links, failures, action: 'record' }))

		return
	}

	console.error(failure_line(blocked, blocker))
}

async function block_finder(filing: InterruptFiling): Promise<void> {
	if (!filing.is_blocking_finder) return
	const blocked = finder_of(filing)

	if (blocked === undefined || !is_issue_number(filing.blocker)) {
		console.warn(ignored_line(filing))

		return
	}

	await record(blocked, filing.blocker)
}

const issue_file_interrupt = { block_finder }

export { issue_file_interrupt }
