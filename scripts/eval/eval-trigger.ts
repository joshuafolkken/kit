import { eval_sandbox } from './eval-sandbox'

// The set of distributed paths a `josh eval` run measures, and the predicate that tests membership
// (joshuafolkken/kit#907, joshuafolkken/kit#1922).
//
// `josh eval` is a manual command since joshuafolkken/kit#1922: the automated `eval:scope` trigger
// that decided "does this change have to be measured" from the changed paths left the completion gate
// and was removed with it. What remains here is the one thing the manual command still needs — the
// measured-path set `eval-stamp` walks, and the membership test over it.

// **Taken from the sandbox rather than restated.** A scenario runs against exactly what
// `eval_sandbox` copies into its throwaway directory, so that list *is* the set of paths the suite
// can see a change to.
const MEASURED_PATHS: ReadonlyArray<string> = [
	...eval_sandbox.DISTRIBUTED_PATHS,
	eval_sandbox.SETTINGS_PATH,
]

// An entry is either a file or a directory, and both are matched the same way: the path itself, or
// anything beneath it. A prefix test alone would match `prompts-archive/x.md` against `prompts`.
function is_measured(path: string): boolean {
	const normalized = path.trim()

	return MEASURED_PATHS.some((entry) => normalized === entry || normalized.startsWith(`${entry}/`))
}

const eval_trigger = {
	is_measured,
	MEASURED_PATHS,
}

export { eval_trigger }
