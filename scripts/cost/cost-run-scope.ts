import type { Options } from './cost-cli'

// The `--run` scope's flag logic, split out of `cost-cli.ts` to keep that file under its line limit
// (joshuafolkken/kit#1937). One decides whether the scope was asked for, the other refuses the flags
// that cannot accompany it.

// `--run` names the whole run tree, so it cannot also name a session, an issue, the whole corpus, or
// a per-request verdict; `--json` is the one companion it keeps. `competing` is whether each such
// flag was given.
function is_conflict(is_run: boolean, competing: ReadonlyArray<boolean>): boolean {
	return is_run && competing.some(Boolean)
}

// No session, issue or corpus flag was given, so the bare default applies.
function no_explicit_scope(options: Options): boolean {
	return options.session === undefined && options.issue === undefined && !options.is_all
}

// The run-tree scope is the bare no-argument default and `--run` alike, but never beneath a
// per-request verdict — `--over` and `--cap` answer about the current session, not the whole run.
function wants(options: Options): boolean {
	if (options.over !== undefined || options.cap !== undefined) return false

	return options.is_run || no_explicit_scope(options)
}

const cost_run_scope = { is_conflict, wants }

export { cost_run_scope }
