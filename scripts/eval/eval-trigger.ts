import { eval_sandbox } from './eval-sandbox'

// Whether `josh eval` has to run for a change, decided from the changed paths alone
// (joshuafolkken/kit#907).
//
// joshuafolkken/kit#855 built the measurement and `docs/eval.md` said to run it "when you change a
// distributed document, a skill or a hook" — a sentence in a document, not a step in any gate. So a
// pull request that rewrote one rule and regressed another had no detection path, and the tool sat
// unpaid-for. **The trigger is a command for the same reason the review level is one**: "this edit
// is only wording" is a judgement made under cost pressure, and cost pressure resolves it toward
// "skip" exactly when a regression is most likely to ship.

type EvalScope = 'required' | 'skip'

const REQUIRED_SCOPE: EvalScope = 'required'
const SKIPPED_SCOPE: EvalScope = 'skip'

// **Taken from the sandbox rather than restated.** A scenario runs against exactly what
// `eval_sandbox` copies into its throwaway directory, so that list *is* the set of paths the suite
// can see a change to. A trigger naming anything else would demand a run of real Claude sessions for
// a change no scenario can observe; one naming less would let a measurable change through
// unmeasured, which is the gap this issue exists to close.
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

// How the set is written in prose: a directory entry is documented with the `/**` that says
// "anything beneath it", so the marker suite can compare a document against this list without a
// special case per document. Derived rather than listed a second time — a hand-written prose form
// is the drift this whole module is arranged to avoid.
//
// An entry is a directory when its last segment carries no extension. **The leading dot of a dotfile
// is part of the name, not an extension**, so `.claude` reads as a directory and `.claude/settings.json`
// as a file; a plain `\.[a-z]+$` test got the first of those wrong and would have had every
// distributed document state a set that describes the command's own answer wrongly.
function is_directory_entry(entry: string): boolean {
	const basename = entry.split('/').at(-1) ?? entry

	return !basename.slice(1).includes('.')
}

function documented_form(entry: string): string {
	return is_directory_entry(entry) ? `${entry}/**` : entry
}

const MEASURED_GLOBS: ReadonlyArray<string> = MEASURED_PATHS.map((entry) => documented_form(entry))

// The paths that forced the run, so the answer can say why rather than only what.
function deciding_paths(paths: ReadonlyArray<string>): Array<string> {
	return paths.map((path) => path.trim()).filter((path) => path !== '' && is_measured(path))
}

// **One measured path decides the whole change**, the mirror of the review level's rule: the suite
// measures the distribution as a whole, not the file that changed, so there is no such thing as
// running it for part of a diff.
//
// **An empty list also runs it.** There is nothing to measure when nothing changed, so the answer
// costs a run that finds the current state — while `skip` on "no paths" would hand a caller that
// failed to read the diff a skip as though it had measured. `josh review:level` takes the same side
// of the same ambiguity, and two sibling commands answering an unreadable diff differently would be
// a trap rather than a nuance.
function scope_for(paths: ReadonlyArray<string>): EvalScope {
	const changed = paths.map((path) => path.trim()).filter((path) => path !== '')

	if (changed.length === 0) return REQUIRED_SCOPE

	return deciding_paths(changed).length > 0 ? REQUIRED_SCOPE : SKIPPED_SCOPE
}

// The same question asked of a list that is already known to hold only measured paths — what the
// review changed while a concurrent `josh eval` was running (joshuafolkken/kit#1152).
//
// **The empty case answers the opposite way, and deliberately.** `scope_for` reads an empty list as
// a caller that failed to read the diff, so it measures. Here the list comes from walking the
// trigger's own path set, so empty is the positive fact "the review changed nothing the scenarios
// can see" — measuring again would spend five real Claude sessions to re-read a tree that has not
// moved. The two are separate functions rather than one flag for exactly that reason: the ambiguity
// `scope_for` resolves does not exist here, and a flag would invite resolving it by judgement.
function scope_for_measured_changes(changed: ReadonlyArray<string>): EvalScope {
	return changed.length > 0 ? REQUIRED_SCOPE : SKIPPED_SCOPE
}

const eval_trigger = {
	deciding_paths,
	documented_form,
	is_directory_entry,
	is_measured,
	MEASURED_GLOBS,
	MEASURED_PATHS,
	REQUIRED_SCOPE,
	scope_for,
	scope_for_measured_changes,
	SKIPPED_SCOPE,
}

export type { EvalScope }
export { eval_trigger }
