import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { JOSH_TMP_DIRECTORY } from '#scripts/lib/josh-temporary-directory'
import type { LaunchResult } from '#scripts/run/detached-launch'
import { run_review_steps } from '#scripts/run/review/run-review-steps'
import { run_wait_cli, type WaitOptions } from '#scripts/run/run-wait-cli'
import type { CommandEntry } from './josh-command-types'
import { outer_command } from './outer-command'

// **A standalone check a lane child runs returns inside one prompt-cache chunk** (joshuafolkken/kit#8708).
// A foreground call past the 5-minute cache TTL rewrites the whole prompt on the next turn, so an
// `is_bounded` command the lane child calls itself runs detached and the call waits
// `run_ship_wait_cli.chunk_left()`: a check that finishes inside replays its log and exit code as the
// synchronous run would have; a longer one prints `pending` and the `josh wait --result` that collects
// it. A nested call (`check:related`, the gate, `run:chain`, a pre-push hook) and every call outside a
// lane child stay synchronous. The detached child finds its result directory in `RESULT_KEY` and
// writes its exit code there as it exits.

const RESULT_KEY = 'JOSH_BOUNDED_RESULT'
const RESULTS_DIRECTORY = 'bounded-check'

type Dispatch = () => Promise<number>
type Source = Readonly<Record<string, string | undefined>>
type Launcher = (
	josh_args: ReadonlyArray<string>,
	log_path: string,
	root: string,
	environment: Readonly<Record<string, string>>,
) => LaunchResult

interface BoundedCall {
	command: string
	entry: Pick<CommandEntry, 'is_bounded'>
	args: ReadonlyArray<string>
}

interface Dependencies {
	directory: string
	source: Source
	root: string
	launcher: Launcher
	wait: () => WaitOptions
	on_exit: (listener: (code: number) => void) => void
}

function live_dependencies(): Dependencies {
	return {
		directory: process.cwd(),
		source: process.env,
		root: PROJECT_ROOT,
		launcher: run_review_steps.launch_josh_with,
		wait: run_wait_cli.live_chunk,
		on_exit: (listener) => process.once('exit', listener),
	}
}

// The detached child's result directory: only the outermost call records, not a check it nests.
function recording_directory(command: string, source: Source): string | undefined {
	const directory = source[RESULT_KEY] ?? ''

	return directory !== '' && outer_command.is_outermost(command, source) ? directory : undefined
}

function is_lane_direct(call: BoundedCall, dependencies: Dependencies): boolean {
	return (
		call.entry.is_bounded === true &&
		outer_command.is_outermost(call.command, dependencies.source) &&
		lane_child_marker.is_child_of(dependencies.directory, dependencies.source)
	)
}

// On exit rather than on return, so a check ending in `process.exit` still records its code.
async function record(
	directory: string,
	dispatch: Dispatch,
	dependencies: Dependencies,
): Promise<number> {
	dependencies.on_exit((code) => {
		writeFileSync(run_wait_cli.result_path(directory, 'exit'), String(code))
	})

	return await dispatch()
}

function result_directory(command: string, root: string): string {
	const name = `${command.replaceAll(':', '-')}-${String(process.pid)}-${String(Date.now())}`

	return path.join(root, JOSH_TMP_DIRECTORY, RESULTS_DIRECTORY, name)
}

// The result directory the detached check writes to, `undefined` when it could not start.
function launch(call: BoundedCall, dependencies: Dependencies): string | undefined {
	const directory = result_directory(call.command, dependencies.root)

	mkdirSync(directory, { recursive: true })
	const launched = dependencies.launcher(
		[call.command, ...call.args],
		run_wait_cli.result_path(directory, 'log'),
		dependencies.root,
		{ [RESULT_KEY]: directory },
	)

	return launched.kind === 'launched' ? directory : undefined
}

// A check that could not start detached runs synchronously, as it would outside a lane child.
async function run(
	call: BoundedCall,
	dispatch: Dispatch,
	dependencies: Dependencies = live_dependencies(),
): Promise<number> {
	const recording = recording_directory(call.command, dependencies.source)

	if (recording !== undefined) return await record(recording, dispatch, dependencies)
	if (!is_lane_direct(call, dependencies)) return await dispatch()
	const launched = launch(call, dependencies)

	if (launched === undefined) return await dispatch()

	return await run_wait_cli.collect(launched, dependencies.wait())
}

const bounded_check = { RESULT_KEY, run }

export type { BoundedCall, Dependencies }
export { bounded_check }
