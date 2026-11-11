import { session_cite } from '#scripts/issue/session-cite'
import { buffered_process } from '#scripts/lib/buffered-process'
import { package_manifest } from '#scripts/lib/package-manifest'
import type { LaneInfo } from './lane-registry'

// The project's own preparation of a lane, run once its dependencies are in (joshuafolkken/kit#7203).
//
// kit knows how to fill a lane for itself, not for the project. A Rust crate rebuilds `target/`
// from nothing in every new work tree — six minutes per lane in one consumer — and only the project
// knows that `target/` is what to carry over, or how. So the project names one command in its
// `package.json` (`josh.lane.setup`), and the lane runs it with the main checkout's path in
// `JOSH_MAIN_CHECKOUT` to copy or link from.
//
// The manifest read is the lane's own, never the main checkout's: the command belongs to the branch
// the lane is on, the same way its lock does. `pnpm exec --shell-mode` runs it through the same
// `buffered_process` as the install — buffered, non-throwing, bounded — with `node_modules/.bin` on
// its path, since the install has just put it there.

const MAIN_CHECKOUT_KEY = 'JOSH_MAIN_CHECKOUT'
const SHELL_ARGUMENTS = ['exec', '--shell-mode']

function read_setup_command(directory: string): string | undefined {
	const manifest = package_manifest.read_manifest_if_valid(
		directory,
		package_manifest.josh_schemas.lane_setup,
	)

	return manifest?.josh?.lane?.setup
}

function setup_environment(main_checkout: string): NodeJS.ProcessEnv {
	return { ...buffered_process.child_environment(), [MAIN_CHECKOUT_KEY]: main_checkout }
}

/**
 * Run the project's `josh.lane.setup` in the lane, and fail the open when it fails.
 *
 * Unset, nothing runs and the lane opens as it always has. A failure throws as a failed install does
 * — a lane the project could not prepare is one its first build fails in — and leaves the work tree
 * where it is, so the command can be run again there or the lane taken away.
 */
async function run_setup(lane: LaneInfo, main_checkout: string): Promise<void> {
	const command = read_setup_command(lane.directory)
	if (command === undefined) return

	const result = await buffered_process.run_buffered_process([...SHELL_ARGUMENTS, command], {
		cwd: lane.directory,
		environment: setup_environment(main_checkout),
	})
	if (!buffered_process.is_process_failed(result)) return

	throw new Error(
		`Opened a lane for ${session_cite.issue(lane.issue)} at ${lane.directory}, but its \`josh.lane.setup\` command failed. Run it again there with \`${MAIN_CHECKOUT_KEY}=${main_checkout}\` set, or take the lane away with \`pnpm josh lane:close ${lane.issue}\`.\n${result.output}`,
	)
}

const lane_setup = { run_setup }

export { lane_setup, MAIN_CHECKOUT_KEY, SHELL_ARGUMENTS }
