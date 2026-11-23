import { registerHooks } from 'node:module'

// joshuafolkken/kit#8733. `josh scratch:run` preloads this into its child, so a scratch script imports
// `scripts/` modules the way `scripts/` does: native type stripping loads the `.ts`, and this hook adds
// the `.ts` an extensionless path import leaves off. Not tsx: its esbuild needs a worker, which the
// child's permission model refuses. This hook is synchronous and in-thread, so it needs no grant.
// Plain `.mjs`, not `.ts`: Node refuses to strip types under `node_modules`, where a consumer's copy
// of this file lives, and the bundled CLI resolves it beside its source.

const TS_EXTENSION = '.ts'
const MODULE_NOT_FOUND = 'ERR_MODULE_NOT_FOUND'
const PATH_PREFIXES = ['./', '../', '/', 'file:']

function is_not_found(error) {
	return error instanceof Error && 'code' in error && error.code === MODULE_NOT_FOUND
}

function is_extensionless_path(specifier) {
	if (specifier.endsWith(TS_EXTENSION)) return false

	return PATH_PREFIXES.some((prefix) => specifier.startsWith(prefix))
}

function resolve(specifier, context, next_resolve) {
	try {
		return next_resolve(specifier, context)
	} catch (error) {
		if (!is_not_found(error) || !is_extensionless_path(specifier)) throw error

		return next_resolve(`${specifier}${TS_EXTENSION}`, context)
	}
}

registerHooks({ resolve })
