import { epic_cross_repo } from './epic-cross-repo'
import { epic_fetch, type EpicSnapshot } from './epic-fetch'
import { epic_graph } from './epic-graph'
import type { EpicReference } from './epic-issue'

// Reading the epics `josh epic:next` was given, before anything is classified (joshuafolkken/kit#1493).
//
// Split from the command itself because naming several epics turned one read into a walk, and a walk
// has answers a single read did not: an epic that was skipped, and one that stopped everything.

// A qualified epic is read by naming its repository in the read's REST path, so naming one we do
// not own would send this command to a third party's tracker — which joshuafolkken/kit#869 forbids
// for a child and forbids here for the same reason (joshuafolkken/kit#1016).
const FOREIGN_EPIC = 'That epic belongs to another owner; this command only reads our own.'
const NO_CHILDREN = 0

// One epic as it was read: the reference the caller typed, and what GitHub answered for it. The
// reference is kept because `EpicSnapshot` carries the repository the epic lives in but not the
// epic's own number, and a multi-epic report has to say which graph a block came from.
interface EpicRead {
	reference: EpicReference
	snapshot: EpicSnapshot
}

// What one reference produced: an epic to classify, a reason it was skipped, or a refusal that stops
// the whole command. Exactly one field is ever set.
interface ReadOutcome {
	read?: EpicRead
	notice?: string
	refusal?: string
}

// Every epic that could be read, why any were skipped, and the refusal that stopped the walk.
interface SnapshotReads {
	reads: ReadonlyArray<EpicRead>
	notices: ReadonlyArray<string>
	refusal?: string
}

// Where the epic lives, or nothing when it belongs to another owner.
function epic_repo_of(reference: EpicReference, current_repo: string): string | undefined {
	const epic_repo = reference.repo ?? current_repo
	const owner = epic_cross_repo.owner_of(current_repo)

	return epic_cross_repo.is_same_owner_repo(epic_repo, owner) ? epic_repo : undefined
}

function childless(reference: EpicReference): string {
	return `#${String(reference.number)} tracks no children in a task list.`
}

// The same epic named twice is one epic. Removed here rather than left to
// `epic_lane_offer.dedupe_pools`: that one keeps a *child* from being entered twice, but by then the
// duplicate epic has already been fetched — and an unattended run pays that fetch every polling
// round. Keyed through `epic_graph.key_of`, so `858` and `joshuafolkken/kit#858` in one command are
// recognized as the same epic rather than as two.
function unique_references(
	references: ReadonlyArray<EpicReference>,
	current_repo: string,
): ReadonlyArray<EpicReference> {
	const seen = new Set<string>()
	const unique: Array<EpicReference> = []

	for (const reference of references) {
		const repo = reference.repo ?? current_repo
		const key = epic_graph.key_of({ repo, number: reference.number })

		if (seen.has(key)) continue
		seen.add(key)
		unique.push(reference)
	}

	return unique
}

// **An epic whose body could not be read is not a childless epic.** The two are indistinguishable
// downstream — a body that never arrived parses to zero children exactly as an unpopulated task list
// does — and skipping it drops the epic from the views with no anomaly anywhere, so the run reports
// the backlog empty and ends. Kept as a read instead, so `epic:next` sees the failed body and says so
// (joshuafolkken/kit#1690).
function is_childless(snapshot: EpicSnapshot): boolean {
	if (snapshot.body_failure !== undefined) return false

	return snapshot.child_numbers.length === NO_CHILDREN
}

// **A childless epic is skipped; a foreign one refuses.** The distinction is what each says about
// the caller. A reference naming another owner's tracker is a read we must not make at all, so it
// stops the command. An epic that is simply not populated yet is a valid, readable epic of ours — an
// `epic:plan` epic whose task list has not been filled in is the ordinary case — and refusing the
// whole command for it would stop every *other* named epic's children being offered, on every
// polling round, until a person noticed (joshuafolkken/kit#1493).
async function read_one(reference: EpicReference, current_repo: string): Promise<ReadOutcome> {
	const epic_repo = epic_repo_of(reference, current_repo)
	if (epic_repo === undefined) return { refusal: FOREIGN_EPIC }
	const snapshot = await epic_fetch.fetch_epic(reference.number, epic_repo, current_repo)

	if (is_childless(snapshot)) return { notice: childless(reference) }

	return { read: { reference, snapshot } }
}

function collect(outcome: ReadOutcome, reads: Array<EpicRead>, notices: Array<string>): void {
	if (outcome.read !== undefined) reads.push(outcome.read)
	if (outcome.notice !== undefined) notices.push(outcome.notice)
}

// **The reads are serial on purpose.** A reference naming another owner has to stop the command
// before that repository is asked anything, and issuing them together would send every fetch before
// the first refusal was seen — the read joshuafolkken/kit#1016 exists to prevent. The latency is the
// price of that guarantee, and `unique_references` above is what keeps it from being paid twice for
// one epic.
async function read_snapshots(
	references: ReadonlyArray<EpicReference>,
	current_repo: string,
): Promise<SnapshotReads> {
	const reads: Array<EpicRead> = []
	const notices: Array<string> = []

	for (const reference of unique_references(references, current_repo)) {
		const outcome = await read_one(reference, current_repo)

		if (outcome.refusal !== undefined) return { reads, notices, refusal: outcome.refusal }
		collect(outcome, reads, notices)
	}

	return { reads, notices }
}

const epic_next_read = {
	FOREIGN_EPIC,
	epic_repo_of,
	childless,
	unique_references,
	is_childless,
	read_one,
	read_snapshots,
}

export type { EpicRead, ReadOutcome, SnapshotReads }
export { epic_next_read }
