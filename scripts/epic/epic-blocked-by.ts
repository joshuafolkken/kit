import { epic_add } from '#scripts/epic/epic-add'
import { epic_bundle_gaps } from '#scripts/epic/epic-bundle-gaps'
import { epic_index } from '#scripts/epic/epic-index'
import { epic_reconcile } from '#scripts/epic/epic-reconcile'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { session_cite } from '#scripts/issue/session-cite'

// `#issue` blocked by `#prerequisite`, recorded so the epic tracking `#issue` declares it too — the
// one write `run:pause` and `backlog:triage --blocked-by` share (joshuafolkken/kit#5647). A direct
// relation between two children of a declared epic, with no declaration beside it, is the
// `declaration_mismatch` anomaly that stops every epic's offer (`epic-graph.ts`).
//
// **It asks whether the relation is already recorded before it writes**, so a rerun after a later
// step failed settles the declaration rather than posting the relation twice. Failures throw, the
// message naming what was or was not recorded.

// `epic:bundle`'s own listing limit, so both commands see the same epics.
const EPIC_LIMIT = 200
const SUCCESS_EXIT_CODE = 0
const ALREADY = 'already'

interface BlockedByRequest {
	issue: string
	prerequisite: string
}

async function is_blocked(request: BlockedByRequest): Promise<boolean> {
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
async function tracking_epic(request: BlockedByRequest): Promise<Tracking | undefined> {
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

async function add_to_epic(epic: number, request: BlockedByRequest): Promise<void> {
	const code = await epic_add.add_children({
		epic_number: epic,
		children: [Number(request.prerequisite)],
		position: { kind: 'before', target: Number(request.issue) },
	})

	if (code !== SUCCESS_EXIT_CODE) {
		throw new Error(`\`epic --add\` into ${session_cite.issue(epic)} failed`)
	}
}

async function record_relation(request: BlockedByRequest): Promise<void> {
	if (await git_gh_issue_write.issue_add_blocked_by(request.issue, request.prerequisite)) return

	throw new Error('the blocked-by relation was not recorded')
}

async function refuse_unreconcilable(epic: number, request: BlockedByRequest): Promise<void> {
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
// already had, where this only adds one — so the relation is recorded directly and
// `epic --reconcile` copies it into the declaration beside the others, once a dry plan shows the
// reconcile accepts it: a refusal after the write would leave the relation undeclared. `epic --add`
// exits 0 on a relation it failed to post, so the relation is read back after the insertion.
async function record_in_epic(tracking: Tracking, request: BlockedByRequest): Promise<string> {
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
async function settle_recorded(request: BlockedByRequest): Promise<string> {
	const tracking = await tracking_epic(request)
	if (tracking?.is_prerequisite_child === true) await reconcile_epic(tracking.epic)

	return ALREADY
}

// What was done — `already`, `recorded` or `recorded in epic #E` — or a throw naming the failure.
async function record(request: BlockedByRequest): Promise<string> {
	if (await is_blocked(request)) return await settle_recorded(request)

	const tracking = await tracking_epic(request)
	if (tracking !== undefined) return await record_in_epic(tracking, request)
	await record_relation(request)

	return 'recorded'
}

const epic_blocked_by = { record }

export type { BlockedByRequest }
export { epic_blocked_by }
