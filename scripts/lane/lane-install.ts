import { existsSync } from 'node:fs'
import { core_budget } from '#scripts/gate/core-budget'
import { buffered_process } from '#scripts/lib/buffered-process'
import { PACKAGE_JSON, package_manifest } from '#scripts/lib/package-manifest'
import { INSTALL_TIMEOUT_MS } from '#scripts/lib/timeouts'

// Filling the lane, which is the other half of opening one.
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
// is how a fix to one missed the other before.

// `--frozen-lockfile` because a lane is cut from `refs/remotes/origin/<default>` and has to build
// exactly the lock committed there. A lock the install would rather rewrite is a finding, not
// something to absorb silently into six parallel lanes.
const INSTALL_ARGUMENTS = ['install', '--frozen-lockfile']
// The lane opens with no dependencies installed, and that is the reported state rather than a
// failure — there was nothing to install, so nothing failed.
const NO_MANIFEST_OUTPUT = `No ${PACKAGE_JSON} in the lane, so the dependency install was skipped.`

interface InstallResult {
	is_installed: boolean
	// Captured rather than inherited, and reported only on a failure: `lane:open` prints the lane
	// directory on standard output and nothing else, so an install writing there directly would
	// break `dir=$(pnpm josh lane:open 1554)` for every caller.
	output: string
}

// A lane with no manifest has nothing to install, so the install is skipped rather than run — the
// seam a cross-process lane test needs, and a root-cause fix rather than a switch, because running
// an install with no install target is the defect. The condition is strictly the file's absence:
// `existsSync` answers only whether the path is there, never whether its contents parse, so a
// present-but-broken manifest falls through to the real install and fails there.
function has_manifest(directory: string): boolean {
	return existsSync(package_manifest.manifest_path(directory))
}

/**
 * Install the lane's dependencies, and report whether it worked rather than throwing.
 *
 * **A lane with no `package.json` skips the install** — there is nothing to install, so the reported
 * state is installed rather than failed, and no child is spawned. This is
 * the only seam: the production call path, its arguments and its environment are all unchanged.
 *
 * **The verdict is the exit code and only the exit code.** `pnpm install` runs `prepare`, which runs
 * the lefthook installer, and in a linked work tree the hooks are shared with the primary repository
 * — so a warning from it is expected and correct. Reading the child's
 * text for a word like "failed" would turn that correct warning into a refusal to open a lane.
 */
async function install_dependencies(directory: string): Promise<InstallResult> {
	if (!has_manifest(directory)) return { is_installed: true, output: NO_MANIFEST_OUTPUT }

	// The install claims its place in the core budget (joshuafolkken/kit#3944): a batch opens its lanes
	// together, and each install ran beside the other lanes' gates off the ledger.
	const result = await core_budget.with_command_reservation(
		core_budget.CORE_WEIGHTS.install,
		async () =>
			await buffered_process.run_buffered_process(INSTALL_ARGUMENTS, {
				cwd: directory,
				timeout_ms: INSTALL_TIMEOUT_MS,
			}),
		{ memory_mb: core_budget.MEMORY_MB.install, command: 'lane install' },
	)

	return { is_installed: !buffered_process.is_process_failed(result), output: result.output }
}

const lane_install = { install_dependencies }

export type { InstallResult }
export { lane_install, INSTALL_ARGUMENTS, NO_MANIFEST_OUTPUT }
