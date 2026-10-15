import { error_text } from '#scripts/lib/error-message'
import { lane_registry, type LaneInfo } from './lane-registry'
import { lane_relaunch } from './lane-relaunch'
import { lane_session_broker } from './lane-session-broker'

// The lane broker for every open Claude lane, run inside the `run:wake` supervisor for as long as the
// supervisor runs, so nobody has to start or stop it.
//
// **It lives in the supervisor because the supervisor is what holds the token.** `josh backlogrun`
// starts it from the terminal (joshuafolkken/kit#3804), so every session it starts can sign in with a
// token-only credential. A lane child's detached `josh ship` cannot: it descends from the child's Bash
// tool, which Claude Code starts without the token (joshuafolkken/kit#3817). Its reviewer and its relaunch
// are asked of this broker instead (`lane-session-broker.ts`).
//
// **Not inside one `backlog:drive`**: the supervisor runs a drive per pass, and a lane's ship reaches its
// review whenever it does — while the drive has handed back to a session too, when no drive runs.
//
// An OpenAI lane is left to its own supervisor, which serves the same broker for that lane's lifetime;
// two servers for one lane would overwrite each other's response.

const SCAN_INTERVAL_MS = 5000

type ListLanes = () => Promise<ReadonlyArray<LaneInfo>>

interface Served {
	stop: () => void
	done: Promise<void>
}

function is_served(lane: LaneInfo): boolean {
	return !lane.is_stranded && !lane_relaunch.is_openai_lane(lane)
}

// One lane's server, held open until `stop` — a lane that could not be served is traced, never thrown,
// so it costs the supervisor nothing but that lane's broker.
async function hold_server(lane: LaneInfo, held: Promise<void>): Promise<void> {
	try {
		await lane_session_broker.with_server(lane, async () => {
			await held
		})
	} catch (error) {
		error_text.trace_swallowed('claude_lane_broker.hold_server', error)
	}
}

function serve_lane(lane: LaneInfo): Served {
	const release = { stop: (): void => undefined }
	const held = new Promise<void>((resolve) => {
		release.stop = resolve
	})

	return { stop: release.stop, done: hold_server(lane, held) }
}

// **A closed lane's entry stays until its server has finished.** A server still answering a reviewer
// keeps writing its response, so a server opened beside it for a re-listed lane would have the two
// overwrite each other — the lane is reopened only by the scan after the old one is gone.
async function forget_when_done(
	served: Map<string, Served>,
	issue: string,
	entry: Served,
): Promise<void> {
	await entry.done
	if (served.get(issue) === entry) served.delete(issue)
}

function close_gone(served: Map<string, Served>, open: ReadonlySet<string>): void {
	for (const [issue, entry] of served) {
		if (open.has(issue)) {
			continue
		}

		entry.stop()
		void forget_when_done(served, issue, entry)
	}
}

function open_new(served: Map<string, Served>, lanes: ReadonlyArray<LaneInfo>): void {
	for (const lane of lanes) {
		if (!served.has(lane.issue)) served.set(lane.issue, serve_lane(lane))
	}
}

async function scan(served: Map<string, Served>, list: ListLanes): Promise<void> {
	try {
		const listed = await list()
		const lanes = listed.filter((lane) => is_served(lane))

		close_gone(served, new Set(lanes.map((lane) => lane.issue)))
		open_new(served, lanes)
	} catch (error) {
		error_text.trace_swallowed('claude_lane_broker.scan', error)
	}
}

// Each scan starts only once the previous one has finished, so two never race over the same map.
async function scan_after(
	previous: Promise<void>,
	served: Map<string, Served>,
	list: ListLanes,
): Promise<void> {
	await previous
	await scan(served, list)
}

// Starts serving now and on every interval; the returned stop closes every server and waits for them.
function start(list: ListLanes = lane_registry.list_lanes): () => Promise<void> {
	const served = new Map<string, Served>()
	const state = { scanning: scan(served, list) }
	const timer = setInterval(() => {
		state.scanning = scan_after(state.scanning, served, list)
	}, SCAN_INTERVAL_MS).unref()

	return async () => {
		clearInterval(timer)
		await state.scanning
		close_gone(served, new Set())
		await Promise.all(
			[...served.values()].map(async (entry) => {
				await entry.done
			}),
		)
	}
}

// Serves every open Claude lane for exactly as long as `run` runs.
async function serve_during<T>(
	run: () => Promise<T>,
	list: ListLanes = lane_registry.list_lanes,
): Promise<T> {
	const stop = start(list)

	try {
		return await run()
	} finally {
		await stop()
	}
}

const claude_lane_broker = { SCAN_INTERVAL_MS, serve_during, start }

export { claude_lane_broker }
