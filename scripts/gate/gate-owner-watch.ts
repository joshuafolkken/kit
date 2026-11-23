import { process_identity } from '#scripts/josh/process-identity'
import { lane_reap, type ReapProbes } from '#scripts/lane/lane-reap'

// Ends a `josh gate` whose owner died (joshuafolkken/kit#8845). A gate keeps running its children
// (ESLint, vitest) when whoever reads its verdict stops — the orphan holds gigabytes and cores until a
// person kills its group.
//
// **The launcher names the owner; the gate never guesses it.** `process.ppid` cannot tell: the gate
// runs under pnpm's `sh -c` wrapper, which outlives the launcher, and `run:review` detaches its gate
// and exits first by design — the reader is the lane child session that later runs `--join`. Only the
// launcher knows who reads the result, so it passes that process's pid and start time in the
// environment: `run:review` the lane child session among its ancestors, ship itself. With no owner
// named the gate does not watch, as before.
//
// The owner is polled with `is_same_process`, so a reissued pid reads as gone. A start time the
// platform cannot read leaves the pid's liveness alone to decide (`!== false`). On the owner's end
// the gate signals every process under it — each check it spawned and theirs — and exits non-zero.
// **Its tree, not its process group:** an attached `josh ship` runs its gate in ship's own group, so a
// group signal would reach ship's launcher and its siblings. The poll timer is `unref`ed, so a gate whose checks are done exits
// on its own and a live owner sees no change in what the gate does or how long it takes.
const OWNER_PID_KEY = 'JOSH_GATE_OWNER_PID'
const OWNER_START_KEY = 'JOSH_GATE_OWNER_START'
const OWNER_POLL_MS = 2000
const ORPHAN_EXIT_CODE = 1
const LOWEST_OWNER_PID = 2

interface GateOwner {
	pid: number
	process_start?: string
}

interface OwnerProbe {
	is_alive: (owner: GateOwner) => boolean
	end_tree: () => void
	exit: (code: number) => void
}

type OwnerSource = Readonly<Record<string, string | undefined>>

// The environment that names `owner` to a gate launched with it.
function environment_of(owner: GateOwner): Record<string, string> {
	return {
		[OWNER_PID_KEY]: String(owner.pid),
		...(owner.process_start !== undefined && { [OWNER_START_KEY]: owner.process_start }),
	}
}

// An unknown or blank start time leaves the key absent, which `is_same_process` reads as "cannot tell".
function owner_with(pid: number, process_start: string | undefined): GateOwner {
	return { pid, ...(process_start !== undefined && process_start !== '' && { process_start }) }
}

// `pid` with the start time the platform reads for it, the shape `environment_of` takes.
function owner_of(pid: number): GateOwner {
	return owner_with(pid, process_identity.read_start(pid))
}

function read_owner(source: OwnerSource = process.env): GateOwner | undefined {
	const pid = Number(source[OWNER_PID_KEY])

	if (!Number.isSafeInteger(pid) || pid < LOWEST_OWNER_PID) return undefined

	return owner_with(pid, source[OWNER_START_KEY])
}

function is_alive(owner: GateOwner): boolean {
	return process_identity.is_same_process(owner.pid, owner.process_start) !== false
}

// Every process under this one, collected before any is signalled (`lane-reap.ts`).
function end_tree(probes: ReapProbes = lane_reap.SYSTEM_PROBES): void {
	for (const pid of lane_reap.descendants_of(process.pid, probes)) probes.terminate(pid)
}

function exit(code: number): void {
	process.exit(code)
}

const PROCESS_PROBE: OwnerProbe = {
	is_alive,
	end_tree: () => {
		end_tree()
	},
	exit,
}

function check_owner(owner: GateOwner, probe: OwnerProbe): void {
	if (probe.is_alive(owner)) return

	probe.end_tree()
	probe.exit(ORPHAN_EXIT_CODE)
}

// The watch over the owner `source` names; `undefined` (no watch) where it names none.
function start(
	source: OwnerSource = process.env,
	probe: OwnerProbe = PROCESS_PROBE,
	interval_ms = OWNER_POLL_MS,
): NodeJS.Timeout | undefined {
	const owner = read_owner(source)

	if (owner === undefined) return undefined

	const timer = setInterval(() => {
		check_owner(owner, probe)
	}, interval_ms)

	timer.unref()

	return timer
}

const gate_owner_watch = {
	end_tree,
	ORPHAN_EXIT_CODE,
	OWNER_PID_KEY,
	OWNER_POLL_MS,
	OWNER_START_KEY,
	environment_of,
	owner_of,
	read_owner,
	start,
}

export type { GateOwner, OwnerProbe }
export { gate_owner_watch }
