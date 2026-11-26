import { process_directories } from '#scripts/lane/process-directories'
import type { LiveHold } from '#scripts/run/hold/run-hold-live'

// Which lane `run:board` counts each listed process in.
// **The working directory first:** a process whose directory sits under this repository's
// `.kit-lanes/<N>` is lane N's — looked up once and remembered, since a process detached with
// `josh ship --detach` is re-parented and no longer traceable to its lane by its ancestry.
// **Its nearest ancestor's lane next:** a process whose directory names no lane — `lsof` did not
// answer for it, or it works outside the lane — is counted in the lane of the nearest ancestor that
// has one, so a gate's eslint started inside a lane is that lane's whatever its directory read gave.
// **A process a lookup cut short left out is asked again on the next sample**, never remembered as
// being in no lane: such a miss pinned a 130%-CPU eslint to none for its whole life
// (joshuafolkken/kit#4359). What it did answer is kept, so under sustained load each sample asks fewer
// rather than every process again. A process a finished `lsof` left out — another user's, which a
// non-root `lsof` never reads, or one gone — is remembered, since asking again would rerun `lsof` every
// second.
// **A run holding the board's checkout seeds its own session** (joshuafolkken/kit#8922): a run in the
// root checkout sits under no lane's directory, so its hold's session is put in its issue's lane and its
// descendants follow by ancestry. Those are remembered in no lane, so they leave it once the hold does.

interface DirectoryRead {
	// The working directory of each process that answered.
	directories: ReadonlyMap<number, string>
	// Whether the lookup ran to its end; a process missing from one cut short is asked again.
	is_complete: boolean
}

interface LaneLookup {
	directories: (pids: ReadonlyArray<number>) => Promise<DirectoryRead>
	// The board's own lanes root.
	root: string
	// The run holding the board's checkout, read each sample (`run-hold-live.ts`).
	held?: (() => LiveHold | undefined) | undefined
}

interface ProcessLanes {
	// Every listed process's lane, `undefined` for one under none.
	lanes: ReadonlyMap<number, string | undefined>
	// The processes whose lookup was cut short — asked again next time.
	unread: ReadonlySet<number>
	// The processes counted in a lane through the hold alone, remembered in none.
	held?: ReadonlySet<number> | undefined
}

function directory_lane(directory: string | undefined, root: string): string | undefined {
	return directory === undefined ? undefined : process_directories.lane_of(directory, root)
}

// The lanes still worth keeping: a gone process dropped, and one left unread asked again.
function remembered(
	before: ProcessLanes | undefined,
	parents: ReadonlyMap<number, number>,
): Map<number, string | undefined> {
	if (before === undefined) return new Map()

	const held = before.held ?? new Set()
	const kept = [...before.lanes].filter(([pid]) => parents.has(pid) && !before.unread.has(pid))

	return new Map(kept.map(([pid, lane]) => [pid, held.has(pid) ? undefined : lane]))
}

// A process's ancestors, nearest first, each listed once.
function ancestors_of(pid: number, parents: ReadonlyMap<number, number>): Array<number> {
	const chain: Array<number> = []
	let ancestor = parents.get(pid)

	while (ancestor !== undefined && !chain.includes(ancestor)) {
		chain.push(ancestor)
		ancestor = parents.get(ancestor)
	}

	return chain
}

// The nearest ancestor with a lane of its own.
function lane_ancestor(
	pid: number,
	known: ReadonlyMap<number, string | undefined>,
	parents: ReadonlyMap<number, number>,
): number | undefined {
	return ancestors_of(pid, parents).find((ancestor) => known.get(ancestor) !== undefined)
}

function ancestor_lane(
	pid: number,
	known: ReadonlyMap<number, string | undefined>,
	parents: ReadonlyMap<number, number>,
): string | undefined {
	const ancestor = lane_ancestor(pid, known, parents)

	return ancestor === undefined ? undefined : known.get(ancestor)
}

// The hold's session put in its run's lane, where that session is still listed in no lane of its own:
// one working in a lane's directory keeps that lane.
function seeded(
	known: ReadonlyMap<number, string | undefined>,
	hold: LiveHold | undefined,
): ReadonlyMap<number, string | undefined> {
	if (hold === undefined || !known.has(hold.pid) || known.get(hold.pid) !== undefined) return known

	return new Map([...known, [hold.pid, hold.issue]])
}

// The processes in no lane of their own whose lane is the hold's: its session and what descends from it
// with no nearer lane — never a person's session beside it, which the session's tree does not hold.
function held_of(
	known: ReadonlyMap<number, string | undefined>,
	live: ReadonlyMap<number, string | undefined>,
	hold: LiveHold | undefined,
	parents: ReadonlyMap<number, number>,
): Set<number> {
	if (hold === undefined || known === live) return new Set()

	const unplaced = [...known.keys()].filter((pid) => known.get(pid) === undefined)

	return new Set(
		unplaced.filter((pid) => pid === hold.pid || lane_ancestor(pid, live, parents) === hold.pid),
	)
}

// The working directories of `fresh`, with no lookup run when there is none to ask about.
async function directories_of(
	fresh: ReadonlyArray<number>,
	lookup: LaneLookup,
): Promise<DirectoryRead> {
	if (fresh.length === 0) return { directories: new Map(), is_complete: true }

	return await lookup.directories(fresh)
}

function unread_of(fresh: ReadonlyArray<number>, read: DirectoryRead): Set<number> {
	return new Set(read.is_complete ? [] : fresh.filter((pid) => !read.directories.has(pid)))
}

// The lanes of the processes `parents` lists: one not seen before, or left unread, looked up.
// The ancestry fallback assumes no long-lived process outside a lane's tree — a tmux server, a shell —
// was started inside `.kit-lanes/<N>`; one that was pulls its descendants into that lane.
async function lanes_for(
	before: ProcessLanes | undefined,
	parents: ReadonlyMap<number, number>,
	lookup: LaneLookup,
): Promise<ProcessLanes> {
	const kept = remembered(before, parents)
	const fresh = [...parents.keys()].filter((pid) => !kept.has(pid))
	const read = await directories_of(fresh, lookup)
	const found = fresh.map(
		(pid) => [pid, directory_lane(read.directories.get(pid), lookup.root)] as const,
	)
	const known = new Map([...kept, ...found])
	const hold = lookup.held?.()
	const live = seeded(known, hold)
	const lanes = [...live].map(
		([pid, lane]) => [pid, lane ?? ancestor_lane(pid, live, parents)] as const,
	)
	const held = held_of(known, live, hold, parents)

	return { lanes: new Map(lanes), unread: unread_of(fresh, read), held }
}

const run_board_usage_lanes = { lanes_for }

export { run_board_usage_lanes }
export type { DirectoryRead, LaneLookup, ProcessLanes }
