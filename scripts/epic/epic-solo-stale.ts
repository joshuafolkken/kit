import { setTimeout as sleep } from 'node:timers/promises'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { issue_cite } from '#scripts/issue/issue-cite'
import { has_any_label, IN_PROGRESS_LABEL, RUN_SOLO_LABEL } from '#scripts/issue/issue-labels'
import { lane_await } from '#scripts/lane/lane-await'
import { lane_registry } from '#scripts/lane/lane-registry'
import { issue_citation } from '#scripts/rules/issue-citation'
import type { BusyRead } from './epic-busy'

// A `run:solo` holder nothing is running for.
//
// A running `run:solo` issue lets nothing new start (`epic-solo.ts`), and "running" is read off the
// `in-progress` label alone. A label nothing removed — a child that parked itself, then had its
// `needs-decision` lifted by a person — therefore held the whole backlog: every candidate went to
// `waiting`, no lane was running to release it, and `backlog:offer` booked the run `exhausted`.
//
// **What decides it is the child's process, not its lane.** The lane of a child that parked itself
// stays open after the child has ended, so an open lane is no evidence of a run; the process pattern
// `lane:await` and `run:liveness` read is. A matching process keeps the holder, whatever its lane.
//
// **A missing process releases only what this machine dispatched, and only once re-confirmed.** The
// process read sees this machine alone, and a session a person started by hand matches no lane
// pattern, so an absent process is evidence of an ended run only for a holder with a lane here. A
// boundary cut drops the process for a moment before its resume takes over, so the absence is read
// again after `lane_await.RECONFIRM_MS` — the window `lane:await` measured for that handoff. Every
// doubt keeps the holder: a wrongly kept label waits, a wrongly released one runs beside a solo run.
//
// Only `run:solo` holders are released: theirs is the one label that blocks every candidate. A stale
// ordinary holder spends one lane, which `epic_busy.lanes_full_message` already names.

const SOLO_LABELS: ReadonlySet<string> = new Set([RUN_SOLO_LABEL])

interface StaleRelease {
	read: BusyRead
	notice?: string
}

function is_absent_solo(issue: OpenIssueData): boolean {
	if (!has_any_label(issue.labels, SOLO_LABELS)) return false

	return !lane_await.is_process_running_default(String(issue.number))
}

// The issue numbers of this checkout's lanes. A listing that cannot be read names none, which keeps
// every holder.
async function local_lanes(): Promise<ReadonlySet<string>> {
	try {
		const lanes = await lane_registry.list_lanes()

		return new Set(lanes.map((lane) => lane.issue))
	} catch {
		return new Set()
	}
}

async function settle(): Promise<void> {
	await sleep(lane_await.RECONFIRM_MS)
}

// Read through this object so a test can stand in for the git listing and the re-confirm wait.
const io = { local_lanes, settle }

async function find_stale(
	issues: ReadonlyArray<OpenIssueData>,
): Promise<ReadonlyArray<OpenIssueData>> {
	const absent = issues.filter((issue) => is_absent_solo(issue))

	if (absent.length === 0) return []

	const lanes = await io.local_lanes()
	const dispatched = absent.filter((issue) => lanes.has(String(issue.number)))

	if (dispatched.length === 0) return []

	await io.settle()

	return dispatched.filter((issue) => is_absent_solo(issue))
}

function stale_message(stale: ReadonlyArray<OpenIssueData>, repo: string): string {
	const named = stale.map((issue) => issue_cite.plain(issue.number)).join(', ')

	return issue_citation.linkify(
		`${named} carries \`${RUN_SOLO_LABEL}\` and \`${IN_PROGRESS_LABEL}\`, but no process of it is running in ${repo} — the \`${IN_PROGRESS_LABEL}\` label is stale, so it does not hold the backlog. Remove the label once you have confirmed nothing is running it.`,
		repo,
	)
}

// The read with every stale `run:solo` holder taken out, and the sentence naming them. A read with no
// holder left is `idle`, exactly as `epic_busy.parse_listing` answers an empty listing.
async function release(read: BusyRead, repo: string): Promise<StaleRelease> {
	if (read.kind !== 'busy') return { read }

	const stale = await find_stale(read.issues)

	if (stale.length === 0) return { read }

	const holders = read.issues.filter((issue) => !stale.includes(issue))
	const released: BusyRead =
		holders.length > 0 ? { kind: 'busy', issues: holders } : { kind: 'idle' }

	return { read: released, notice: stale_message(stale, repo) }
}

const epic_solo_stale = { io, release }

export type { StaleRelease }
export { epic_solo_stale }
