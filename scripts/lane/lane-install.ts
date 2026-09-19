import { existsSync } from 'node:fs'
import path from 'node:path'
import { buffered_process } from '#scripts/lib/buffered-process'

// Filling the lane, which is the other half of opening one (joshuafolkken/kit#1554).
//
// **A work tree with no `node_modules` is not a lane yet.** A linked work tree starts as a checkout
// and nothing else, and the lane root is a hidden *sibling* of the repository, so nothing above it
// resolves either — every `pnpm josh …` typed inside a fresh lane failed with `tsx: command not
// found`. The install itself is cheap, about 3.5 s from a warm store because pnpm hard-links out of
// it; what it cost was one failed command and one diagnostic round trip, per lane, every time.
//
// **The seconds are not the reason this module exists.** `tsx: command not found` reads like a
// broken toolchain to anyone who does not know the cause, and the way around a broken toolchain is
// to verify by some other means — a verification nobody would report as non-standard, because
// whoever ran it believed it was the only one available.
//
// The child is spawned through `buffered_process` rather than through `execa` here. What this needs
// is exactly that module's contract — output buffered rather than inherited, a non-zero exit
// reported rather than thrown, and a bound on how long the child may hang — and a second copy of it
// is how a fix to one missed the other before (joshuafolkken/kit#914).

// `--frozen-lockfile` because a lane is cut from `refs/remotes/origin/<default>` and has to build
// exactly the lock committed there. A lock the install would rather rewrite is a finding, not
// something to absorb silently into six parallel lanes.
const INSTALL_ARGUMENTS = ['install', '--frozen-lockfile']
// The manifest whose absence is the whole skip condition. A lane cut from a repository that has no
// `package.json` has nothing to install, so running `pnpm install` there could only fail on a
// manifest that was never there — which is exactly the fixture a cross-process lane test needs
// (joshuafolkken/kit#2148). The condition is strictly "the file does not exist": a manifest that is
// present but unreadable or broken still runs the install and still fails as before, so a genuinely
// broken repository is never passed silently.
const MANIFEST_FILE_NAME = 'package.json'
// The lane opens with no dependencies installed, and that is the reported state rather than a
// failure — there was nothing to install, so nothing failed.
const NO_MANIFEST_OUTPUT = `No ${MANIFEST_FILE_NAME} in the lane, so the dependency install was skipped.`
// The 3.5 s above is a warm store; a first run, or one after a dependency change, goes to the
// network, so that figure is not the bound to write here. Ten minutes covers that fetch and still
// ends `lane:open` when a registry never answers, rather than holding a parallel run open with
// nothing printed. It is well under the fan-out's own half hour because this one blocks a command a
// person is waiting on, not a check suite.
const INSTALL_TIMEOUT_MS = 600_000

interface InstallResult {
	is_installed: boolean
	// Captured rather than inherited, and reported only on a failure: `lane:open` prints the lane
	// directory on standard output and nothing else, so an install writing there directly would
	// break `dir=$(pnpm josh lane:open 1554)` for every caller.
	output: string
}

// A lane with no manifest has nothing to install, so the install is skipped rather than run — the
// seam a cross-process lane test needs, and a root-cause fix rather than a switch, because running
// an install with no install target was the defect (joshuafolkken/kit#2148). The condition is
// strictly the file's absence: `existsSync` answers only whether the path is there, never whether
// its contents parse, so a present-but-broken manifest falls through to the real install and fails
// exactly as before.
function has_manifest(directory: string): boolean {
	return existsSync(path.join(directory, MANIFEST_FILE_NAME))
}

/**
 * Install the lane's dependencies, and report whether it worked rather than throwing.
 *
 * **A lane with no `package.json` skips the install** — there is nothing to install, so the reported
 * state is installed rather than failed, and no child is spawned (joshuafolkken/kit#2148). This is
 * the only seam: the production call path, its arguments and its environment are all unchanged.
 *
 * **The verdict is the exit code and only the exit code.** `pnpm install` runs `prepare`, which runs
 * the lefthook installer, and in a linked work tree the hooks are shared with the primary repository
 * — so a warning from it is expected and correct (joshuafolkken/kit#1503, #1507). Reading the child's
 * text for a word like "failed" would turn that correct warning into a refusal to open a lane.
 */
async function install_dependencies(directory: string): Promise<InstallResult> {
	if (!has_manifest(directory)) return { is_installed: true, output: NO_MANIFEST_OUTPUT }

	const result = await buffered_process.run_buffered_process(INSTALL_ARGUMENTS, {
		cwd: directory,
		timeout_ms: INSTALL_TIMEOUT_MS,
	})

	return { is_installed: !buffered_process.is_process_failed(result), output: result.output }
}

const lane_install = { install_dependencies }

export type { InstallResult }
export {
	lane_install,
	INSTALL_ARGUMENTS,
	INSTALL_TIMEOUT_MS,
	MANIFEST_FILE_NAME,
	NO_MANIFEST_OUTPUT,
}
