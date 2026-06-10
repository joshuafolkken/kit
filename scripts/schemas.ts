import { z } from 'zod'

const overrides_snapshot_schema = z.record(z.string(), z.string())

const package_version_schema = z.object({ version: z.string() })

const package_with_version_schema = z.looseObject({ version: z.string() })

// Shape of `pnpm ls -g --json <pkg>`: an array whose first entry lists the matched
// global dependency under `dependencies[<pkg>].version`. Empty/absent when not installed.
const pnpm_ls_global_schema = z.array(
	z.looseObject({
		dependencies: z.record(z.string(), z.looseObject({ version: z.string() })).optional(),
	}),
)

const package_with_deps_schema = z.object({
	dependencies: z.record(z.string(), z.string()).optional(),
	devDependencies: z.record(z.string(), z.string()).optional(),
})

const vscode_settings_schema = z.record(z.string(), z.unknown())

const with_extends_schema = z.looseObject({
	extends: z.union([z.string(), z.array(z.string())]).optional(),
})

const with_scripts_schema = z.looseObject({
	scripts: z.record(z.string(), z.string()).optional(),
})

const with_development_deps_schema = z.looseObject({
	devDependencies: z.record(z.string(), z.string()).optional(),
})

const with_package_manager_schema = z.looseObject({
	packageManager: z.string().optional(),
})

const with_development_engine_schema = z.looseObject({
	devEngines: z.record(z.string(), z.unknown()).optional(),
})

const json_object_schema = z.record(z.string(), z.unknown())

const string_array_schema = z.array(z.string())

const string_record_schema = z.record(z.string(), z.string())

export {
	overrides_snapshot_schema,
	package_version_schema,
	package_with_version_schema,
	pnpm_ls_global_schema,
	package_with_deps_schema,
	vscode_settings_schema,
	with_extends_schema,
	with_scripts_schema,
	with_development_deps_schema,
	with_package_manager_schema,
	with_development_engine_schema,
	json_object_schema,
	string_array_schema,
	string_record_schema,
}
