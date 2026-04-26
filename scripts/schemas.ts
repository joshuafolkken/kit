import { z } from 'zod'

const overrides_snapshot_schema = z.record(z.string(), z.string())

const package_version_schema = z.object({ version: z.string() })

const package_with_version_schema = z.looseObject({ version: z.string() })

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

const json_object_schema = z.record(z.string(), z.unknown())

const string_array_schema = z.array(z.string())

export {
	overrides_snapshot_schema,
	package_version_schema,
	package_with_version_schema,
	package_with_deps_schema,
	vscode_settings_schema,
	with_extends_schema,
	with_scripts_schema,
	with_development_deps_schema,
	with_package_manager_schema,
	json_object_schema,
	string_array_schema,
}
