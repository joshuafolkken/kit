import { eval_sandbox } from './eval-sandbox'

// The set of distributed paths a `josh eval` run measures, and the predicate that tests membership.
//
// `josh eval` is a manual command, outside the completion gate. What lives here is the one thing it
// needs — the measured-path set `eval-stamp` walks, and the membership test over it.

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
