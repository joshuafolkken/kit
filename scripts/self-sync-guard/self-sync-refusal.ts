import { self_sync_guard } from './self-sync-guard-logic'

// The half of the guard that `sync` and `init` share verbatim: print the refusal and leave a
// non-zero exit code. It lives beside the detection rather than in either entry point because the
// two commands do the same damage in the source repository — `init` a larger share of it, since it
// rewrites `package.json` scripts and devDependencies as well (joshuafolkken/kit#879) — and a copy
// in each `main()` would be the second implementation the shared module exists to prevent.
//
// Not re-exported from `index.ts`: the published `@joshuafolkken/kit/self-sync-guard` surface stays
// the pure detection, so a downstream distributor keeps deciding how its own CLI reports a refusal.
function did_refuse_self_run(package_directory: string, project_root: string): boolean {
	const refusal = self_sync_guard.self_sync_refusal(package_directory, project_root)

	if (refusal === undefined) return false

	console.error(`\n${refusal}\n`)
	process.exitCode = 1

	return true
}

export { did_refuse_self_run }
