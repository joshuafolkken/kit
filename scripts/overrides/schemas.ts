import { z } from 'zod'

const package_pnpm_schema = z.object({
	pnpm: z
		.object({
			overrides: z.record(z.string(), z.string()).optional(),
		})
		.optional(),
})

const package_with_deps_schema = z.object({
	dependencies: z.record(z.string(), z.string()).optional(),
	devDependencies: z.record(z.string(), z.string()).optional(),
})

export { package_pnpm_schema, package_with_deps_schema }
