import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { hook_bundle_stamp } from '#scripts/build/hook-bundle-stamp'

// Plain node shares the hook's freshness check before loading either the built dispatcher or tsx.
const LAUNCH_SCRIPT = fileURLToPath(import.meta.url)
const PACKAGE_DIR = path.resolve(path.dirname(LAUNCH_SCRIPT), '..', '..')
const ARGUMENTS_START = 2

function launch_target(package_directory: string): string {
	const distribution = path.join(package_directory, 'dist')
	const is_fresh = [distribution, path.join(distribution, 'commands')].every((directory) =>
		hook_bundle_stamp.is_fresh(directory, package_directory),
	)

	return is_fresh
		? path.join(distribution, 'josh.js')
		: path.join(package_directory, 'scripts/josh/josh.ts')
}

async function launch(package_directory: string = PACKAGE_DIR): Promise<void> {
	const target = launch_target(package_directory)

	if (target.endsWith('.ts')) {
		const { register } = await import('tsx/esm/api')

		register()
	}

	process.argv = [process.execPath, target, ...process.argv.slice(ARGUMENTS_START)]
	await import(pathToFileURL(target).href)
}

if (process.argv[1] === LAUNCH_SCRIPT) await launch()

export { launch, launch_target }
