import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { doctor_io } from '#scripts/doctor/doctor-io'
import { doctor_logic } from '#scripts/doctor/doctor-logic'
import { KIT_PACKAGE_NAME } from './kit-descriptor'
import { create_version_command_config, type VersionCommandConfig } from './version-command-config'

const SELF_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))

// Warn when the `josh` first on PATH is not the pnpm-global install (a stale shim shadowing it),
// pointing at the `doctor --fix` recovery command. This is kit-specific (keyed off the `josh`
// binary), so it lives in kit's config rather than the package-agnostic library.
function read_shadow_warning(): string | undefined {
	const path_josh = doctor_io.resolve_path_josh()
	const global_josh = doctor_io.resolve_pnpm_global_josh()
	if (path_josh === undefined || global_josh === undefined) return undefined
	if (!doctor_logic.is_shadowed(path_josh, global_josh)) return undefined

	return doctor_logic.format_shadow_warning(path_josh, global_josh)
}

// Kit sits at the top of the version chain, so it declares no upstreams and its endpoint is
// derived from the package name — `josh v` / `josh vu` behavior is unchanged.
const kit_version_config: VersionCommandConfig = create_version_command_config({
	package_name: KIT_PACKAGE_NAME,
	self_directory: SELF_DIRECTORY,
	resolve_warning: read_shadow_warning,
})

export { kit_version_config }
