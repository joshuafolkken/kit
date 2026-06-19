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

export { package_pnpm_schema, package_with_deps_schema }
