import path from 'node:path'
import { lane_paths } from '#scripts/lane/lane-paths'

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
}

interface ProcessLanes {
	// Every listed process's lane, `undefined` for one under none.
	lanes: ReadonlyMap<number, string | undefined>
	// The processes whose lookup was cut short — asked again next time.
	unread: ReadonlySet<number>
}

// The lane of `root` a directory sits under — itself or a directory above it, the outermost first.
function lane_of(directory: string, root: string): string | undefined {
	const parts = directory.split(path.sep)
	const ancestors = parts.map((_, index) => parts.slice(0, index + 1).join(path.sep)).slice(1)
	const environment = { [lane_paths.LANE_ROOT_KEY]: root }

	return ancestors.map((ancestor) => lane_paths.lane_issue_of(ancestor, environment)).find(Boolean)
}

function directory_lane(directory: string | undefined, root: string): string | undefined {
	return directory === undefined ? undefined : lane_of(directory, root)
}

// The lanes still worth keeping: a gone process dropped, and one left unread asked again.
function remembered(
	before: ProcessLanes | undefined,
	parents: ReadonlyMap<number, number>,
): Map<number, string | undefined> {
	if (before === undefined) return new Map()

	return new Map([...before.lanes].filter(([pid]) => parents.has(pid) && !before.unread.has(pid)))
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

function ancestor_lane(
	pid: number,
	known: ReadonlyMap<number, string | undefined>,
	parents: ReadonlyMap<number, number>,
): string | undefined {
	return ancestors_of(pid, parents)
		.map((ancestor) => known.get(ancestor))
		.find((lane) => lane !== undefined)
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
	const lanes = [...known].map(
		([pid, lane]) => [pid, lane ?? ancestor_lane(pid, known, parents)] as const,
	)

	return { lanes: new Map(lanes), unread: unread_of(fresh, read) }
}

const run_board_usage_lanes = { lane_of, lanes_for }

export { run_board_usage_lanes }
export type { DirectoryRead, LaneLookup, ProcessLanes }
