import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hook_bundle_stamp } from '#scripts/build/hook-bundle-stamp'
import { hook_bundle_load } from '#tools/hooks/hook-bundle-load'

// The built fast path of kit's own hook launch (`dist/hooks/ready.js`, joshuafolkken/kit#6948):
// `scripts/hooks/run-hook.sh` runs `node dist/hooks/ready.js <name> <josh command> [arguments...]`
// when it exists. Fresh bundles run in this same process, so a hook call loads no TypeScript at all;
// anything else — stale or missing bundles — is handed whole to the source gate
// (`hook-bundle-ready.ts`), which owns the background and in-call rebuilds. A stale copy of this file
// is itself caught by the freshness check, since its source is a stamped input.
//
// Built into `dist/hooks/` and run from source in tests: both sit two levels under the package.

const LAUNCH_SCRIPT = fileURLToPath(import.meta.url)
const PACKAGE_DIR = path.join(path.dirname(LAUNCH_SCRIPT), '..', '..')
const OUT_DIR = path.join(PACKAGE_DIR, 'dist', 'hooks')
const SOURCE_GATE = path.join(PACKAGE_DIR, 'tools', 'hooks', 'hook-bundle-ready.ts')
const TYPE_STRIPPING_QUIET = '--disable-warning=ExperimentalWarning'
const GATE_FAILED_EXIT = 1
// `process.argv` is node, this script, then the hook name, its josh command and its arguments.
const LAUNCH_ARGUMENTS_START = 2
const HOOK_ARGUMENTS_START = 2

function run_source_gate(launch_arguments: ReadonlyArray<string>): void {
	const { status } = spawnSync(
		process.execPath,
		[TYPE_STRIPPING_QUIET, SOURCE_GATE, ...launch_arguments],
		{ stdio: 'inherit' },
	)

	process.exitCode = status ?? GATE_FAILED_EXIT
}

async function launch(
	launch_arguments: ReadonlyArray<string>,
	out_directory: string = OUT_DIR,
): Promise<void> {
	if (!hook_bundle_stamp.is_fresh(out_directory, PACKAGE_DIR)) {
		run_source_gate(launch_arguments)

		return
	}

	const [hook_name = ''] = launch_arguments
	const bundle = path.join(out_directory, `${hook_name}.js`)

	await hook_bundle_load.run_bundle(bundle, launch_arguments.slice(HOOK_ARGUMENTS_START))
}

if (process.argv[1] === LAUNCH_SCRIPT) await launch(process.argv.slice(LAUNCH_ARGUMENTS_START))

const hook_bundle_fast = { launch, SOURCE_GATE }

export { hook_bundle_fast }
