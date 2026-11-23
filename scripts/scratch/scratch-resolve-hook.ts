import { registerHooks, type ResolveFnOutput, type ResolveHookContext } from 'node:module'

// joshuafolkken/kit#8733. `josh scratch:run` preloads this into its child, so a scratch script imports
// `scripts/` modules the way `scripts/` does: native type stripping loads the `.ts`, and this hook adds
// the `.ts` an extensionless path import leaves off. Not tsx: its esbuild needs a worker, which the
// child's permission model refuses. This hook is synchronous and in-thread, so it needs no grant.

const TS_EXTENSION = '.ts'
const MODULE_NOT_FOUND = 'ERR_MODULE_NOT_FOUND'
const PATH_PREFIXES = ['./', '../', '/', 'file:']

type NextResolve = (specifier: string, context?: Partial<ResolveHookContext>) => ResolveFnOutput

function is_not_found(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === MODULE_NOT_FOUND
}

function is_extensionless_path(specifier: string): boolean {
	if (specifier.endsWith(TS_EXTENSION)) return false

	return PATH_PREFIXES.some((prefix) => specifier.startsWith(prefix))
}

function resolve(
	specifier: string,
	context: ResolveHookContext,
	next_resolve: NextResolve,
): ResolveFnOutput {
	try {
		return next_resolve(specifier, context)
	} catch (error) {
		if (!is_not_found(error) || !is_extensionless_path(specifier)) throw error

		return next_resolve(`${specifier}${TS_EXTENSION}`, context)
	}
}

registerHooks({ resolve })
