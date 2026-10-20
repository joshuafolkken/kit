import { existsSync } from 'node:fs'
import { ancestor_directories } from '#scripts/lib/ancestor-directories'
import { package_manifest } from '#scripts/lib/package-manifest'

// Resolve the kit package root by ascending to the nearest package.json. This works both
// from the bundled dist/josh.js (one level under the root) and from the tsx source at
// scripts/josh/ (two levels), so this file's depth no longer has to be hard-coded.
// A leaf apart from `josh-logic`, so a bundled command can import it without pulling the
// dispatcher's main-guarded closure into its single-file bundle.
function find_package_directory(start_directory: string): string {
	return (
		ancestor_directories.nearest(start_directory, (directory) =>
			existsSync(package_manifest.manifest_path(directory)),
		) ?? start_directory
	)
}

export { find_package_directory }
