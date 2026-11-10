import type { HookContext } from '#scripts/hooks/hook-context'

// The per-call context a guard test judges under, written once rather than beside each guard suite
// (joshuafolkken/kit#6683). The guards these suites cover read only `cwd` and `env`, so the ancestry is
// empty.
function of(cwd: string, environment: HookContext['env']): HookContext {
	return { cwd, env: environment, ancestry: () => new Set() }
}

const hook_context_fixture = { of }

export { hook_context_fixture }
