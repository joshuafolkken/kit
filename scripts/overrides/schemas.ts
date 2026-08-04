import { z } from 'zod'

const optional_string_record_schema = z.record(z.string(), z.string()).optional()

const package_pnpm_schema = z.object({
	pnpm: z
		.object({
			overrides: optional_string_record_schema,
		})
		.optional(),
})

const package_with_deps_schema = z.object({
	dependencies: optional_string_record_schema,
	devDependencies: optional_string_record_schema,
})

// pnpm 11 reads workspace-level settings — `overrides` among them — from pnpm-workspace.yaml.
// Loose so the unrelated keys that share the file (`allowBuilds`, `minimumReleaseAgeExclude`, …)
// pass through untouched.
const workspace_overrides_schema = z.looseObject({
	overrides: optional_string_record_schema,
})

// pnpm-lock.yaml importer entries. Loose at every level so the sibling keys that share the
// document (`packages`, `snapshots`, per-importer `configDependencies`, …) pass through untouched.
const lockfile_dependency_schema = z.looseObject({ specifier: z.string() })

const optional_dependency_group_schema = z.record(z.string(), lockfile_dependency_schema).optional()

const lockfile_importer_schema = z.looseObject({
	dependencies: optional_dependency_group_schema,
	devDependencies: optional_dependency_group_schema,
	optionalDependencies: optional_dependency_group_schema,
})

const lockfile_importers_schema = z.looseObject({
	importers: z.record(z.string(), lockfile_importer_schema).optional(),
})

type LockfileImporter = z.infer<typeof lockfile_importer_schema>

export type { LockfileImporter }
export {
	package_pnpm_schema,
	package_with_deps_schema,
	workspace_overrides_schema,
	lockfile_importers_schema,
}
