#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { run_pickup_launch, type PickupLaunch } from '#scripts/run/run-pickup-launch'

// `josh run:pickup [<epic>...]` — the lanes a session resumed by hand after a cut picks up, in one
// call (`backlogrun-progress.md` → "Picking the lanes up in the fresh session"). It launches a lane
// per child the named epics offer (`run-pickup-launch.ts`), reads the open lanes, asks `run:liveness`
// about every lane that records an output path, and prints one line per action.
//
// It shells out to `run:liveness` rather than importing it, so the verdict and its guards are reused
// rather than cloned. The progress watcher is printed as a command line, never started: it has to run
// in the session's own background, which a child process cannot give it.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const USAGE = 'Usage: josh run:pickup [<epic>...]'
const NO_LANES = 'no open lane — nothing to pick up'
const UNDETERMINED = 'undetermined'
const WATCHER = 'pnpm josh run:progress --wait'
const PRUNE = 'close it with `pnpm josh lane:prune`'

async function liveness_line(issue: string, output: string): Promise<string> {
	const result = await josh_command.josh_run(['run:liveness', issue, '--output', output])

	return `${session_cite.issue(issue)} liveness: ${result.out === '' ? UNDETERMINED : result.out}`
}

// A lane with no recorded path is one nobody can poll, so it is named rather than assumed idle. A
// stranded lane records none because its tree is gone, so it is pointed at `lane:prune` instead.
async function lane_line(lane: LaneInfo): Promise<string> {
	if (lane.is_stranded) return `${session_cite.issue(lane.issue)} is stranded — ${PRUNE}`
	if (lane.output !== undefined) return await liveness_line(lane.issue, lane.output)

	return `${session_cite.issue(lane.issue)} records no output path — set one with \`pnpm josh lane:output ${lane.issue} <path>\``
}

function watcher_line(lanes: ReadonlyArray<LaneInfo>): string {
	const flags = lanes.flatMap((lane) =>
		lane.output === undefined ? [] : ['--output', lane.output],
	)

	return `watcher (start it in the background): ${[WATCHER, ...flags].join(' ')}`
}

async function pickup_lines(lanes: ReadonlyArray<LaneInfo>): Promise<Array<string>> {
	if (lanes.length === 0) return [NO_LANES]

	const lines = await Promise.all(lanes.map(async (lane) => await lane_line(lane)))

	return [...lines, watcher_line(lanes)]
}

async function launch_lines(epics: ReadonlyArray<string>): Promise<PickupLaunch> {
	if (epics.length === 0) return { lines: [], is_refused: false }

	return await run_pickup_launch.launch(epics)
}

// The launches run before the lanes are listed, so a lane just started is polled and watched too.
async function run(argv: ReadonlyArray<string>): Promise<number> {
	if (argv.some((epic) => !issue_number_shape.is_issue_number(epic))) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const launched = await launch_lines(argv)
	const lines = await pickup_lines(await lane_registry.list_lanes())

	console.info([...launched.lines, ...lines].join('\n'))

	return launched.is_refused ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(ARGV_OFFSET))
}

const run_pickup_cli = { run }

export { run_pickup_cli }
