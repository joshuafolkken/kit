import path from 'node:path'

// Whether a repository-relative path is named by a glob, a bare directory naming everything under it:
// `crates/core` matches `crates/core/src/lib.rs` as `crates/core/**` does. Shared by the CI change
// classifier (`change-scope-action.ts`, run by plain `node`, so this module imports nothing aliased and
// is copied to consumers beside it, `init-logic.ts`) and the project gate steps' `paths`
// (`project-step-reuse.ts`).

function matches(file: string, pattern: string): boolean {
	return path.matchesGlob(file, pattern) || path.matchesGlob(file, `${pattern}/**`)
}

const path_glob = { matches }

export { path_glob }
