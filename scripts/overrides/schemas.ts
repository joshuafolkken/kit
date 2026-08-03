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

export { package_pnpm_schema, package_with_deps_schema, workspace_overrides_schema }
