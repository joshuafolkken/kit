import { spawnSync } from 'node:child_process'
import { availableParallelism } from 'node:os'
import path from 'node:path'
import { PLATFORM_TEMP_ROOT } from '#scripts/josh/platform-temporary'
import { stamp_file } from '#scripts/josh/stamp-file'
import { PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { unit_run_marker } from '#scripts/test/unit-run-marker'

// The worker count `vitest.config.ts` hands vitest, so a run that does not go through `josh` — a
// lane child's `pnpm vitest run`, `npx vitest` — takes the same share of the machine as `josh test:*`
// (joshuafolkken/kit#4262). Before this, the share applied only where `josh` appended `--maxWorkers`,
// and one direct run beside a gate opened nine workers on eleven cores.
//
// **Exactly one of the two decides.** A `josh`-driven run is nested (`with_run_marker` set the flag
// before spawning vitest), and there `test-unit-guard.ts` sizes the run — passing `--maxWorkers` when
// a share or core-budget claim bounds it, vitest's default when it is alone — from readings this
// config cannot take cheaply, so the answer here is `undefined`. A `--maxWorkers` typed on the command
// line beats the config in vitest itself, so a person's number still wins.
//
// **A direct run is counted as well as counting.** It writes the same pid-keyed marker a `josh` run
// writes, so a gate started after it divides the machine with it instead of taking all of it. The
// marker is written before the count, which therefore includes this run — and a watch-mode reload
// re-reads its own marker rather than counting itself twice. It is cleared on exit; a run killed
// outright leaves one the next reader sweeps, as it does for `josh` runs.
//
// **Loading the config must never fail over bookkeeping**: any error answers `undefined`, vitest's
// own default.
const cleared_on_exit = new Set<string>()

function clear_on_exit(target: string): void {
	if (cleared_on_exit.has(target)) return

	cleared_on_exit.add(target)
	process.once('exit', () => {
		stamp_file.remove_stamp(target)
	})
}

function marked_share(
	available_cores: number,
	directory: string,
	lanes: number,
): number | undefined {
	const target = path.join(directory, path.basename(unit_run_marker.marker_path()))

	unit_run_marker.mark_run_started(target)
	clear_on_exit(target)

	return unit_run_marker.resolve_unit_workers(
		available_cores,
		unit_run_marker.sharing_runs(unit_run_marker.live_run_count(directory), lanes),
	)
}

function guarded_share(
	available_cores: number,
	directory: string,
	lanes: number,
): number | undefined {
	try {
		return marked_share(available_cores, directory, lanes)
	} catch {
		return undefined
	}
}

// **The lanes are counted in a child process, never imported** (joshuafolkken/kit#7254). Every module
// this config imports, statically or not, is a whole-suite file, and the lane reading pulls in the lane
// paths, the lane-state records and the git directory — each of which would then send any change to it
// to the whole suite, though the count moves only the worker share and never a result. The child
// resolves `#scripts` from the working directory, as the config does. A child that fails or prints no
// number counts no lane, which leaves the division to the run count, as `live_lane_count` does.
const LANE_COUNT_SOURCE = `import { unit_lane_count } from '#scripts/test/unit-lane-count'
process.stdout.write(String(unit_lane_count.live_lane_count(process.argv[1])))`

function spawned_lane_count(
	checkout: string = process.cwd(),
	environment: NodeJS.ProcessEnv = process.env,
): number {
	const child = spawnSync(
		process.execPath,
		['--input-type=module', '-e', LANE_COUNT_SOURCE, checkout],
		{
			encoding: 'utf8',
			env: environment,
			timeout: PROBE_TIMEOUT_MS,
		},
	)
	const count = Number(child.stdout)

	return Number.isSafeInteger(count) ? count : 0
}

const lane_count_probe = { spawned_lane_count }

// `lanes` is the live lanes on the machine (joshuafolkken/kit#6682): each holds a share before its
// suite starts, so a direct run beside idle lanes still takes only its own. A nested run spawns no
// lane count, since `josh` sizes it.
function config_workers(
	available_cores: number = availableParallelism(),
	directory: string = PLATFORM_TEMP_ROOT,
	lanes?: number,
): number | undefined {
	if (unit_run_marker.is_nested_run()) return undefined

	return guarded_share(available_cores, directory, lanes ?? lane_count_probe.spawned_lane_count())
}

const vitest_config_workers = { config_workers, lane_count_probe }

export { vitest_config_workers }
