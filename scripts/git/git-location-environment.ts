// The `GIT_*` variables that decide **which** repository, work tree, index or object store a `git`
// command acts on — and every one of them beats `cwd` outright.
//
// git exports them to every hook it runs, so a child process spawned from inside `pre-commit` or
// `pre-push` inherits a pointer at the repository the hook is firing in. A helper that passes
// `{ cwd: fixture_directory }` and nothing else therefore writes into the **real** checkout, with no
// error anywhere: joshuafolkken/kit#1515 found it in `propagate-git`'s probes, and
// joshuafolkken/kit#1530 found the same shape in `lane-change-base.test.ts`, where it committed a
// test fixture's own commits onto a lane's live branch during the pre-push gate.
//
// The list is single-sourced here because it now has three consumers that must not drift apart: the
// probes that clear it, the fixture that clears it, and the unit-suite guard that refuses a write
// while any of it is set (`scripts/test-repository-guard.ts`).
//
// **Only the variables that redirect where git writes are listed.** `GIT_PREFIX`, `GIT_EDITOR` and
// the `GIT_CONFIG_*` family are exported to hooks too and are deliberately absent: clearing them
// buys nothing, and the guard refuses on the presence of any name on this list, so a name that does
// not redirect a write would only manufacture false positives.
const GIT_LOCATION_VARIABLES: ReadonlyArray<string> = [
	'GIT_ALTERNATE_OBJECT_DIRECTORIES',
	'GIT_COMMON_DIR',
	'GIT_DIR',
	'GIT_INDEX_FILE',
	'GIT_NAMESPACE',
	'GIT_OBJECT_DIRECTORY',
	'GIT_WORK_TREE',
]

// The `env` overlay that makes `cwd` mean what it says. Spread into an execa call alongside
// `extendEnv: true`, each `undefined` removes that name from the child's environment rather than
// setting it to the string `"undefined"`.
function location_free_environment(): Record<string, undefined> {
	return Object.fromEntries(GIT_LOCATION_VARIABLES.map((name) => [name, undefined]))
}

// `Reflect.deleteProperty` rather than `delete`: assigning `undefined` to a `process.env` key stores
// the string `"undefined"`, which git reads as a request rather than as an absence.
function forget(name: string): void {
	Reflect.deleteProperty(process.env, name)
}

function restore_one(name: string, value: string | undefined): void {
	if (value === undefined) forget(name)
	else process.env[name] = value
}

// The same clearing applied to **this** process, answering with the restore. A child's environment
// is not the whole exposure: a helper that spawns `git` with no `env` of its own inherits
// `process.env`, so a test file driving such a helper has to clear the variables where they are.
function clear_git_location_variables(): () => void {
	const previous = GIT_LOCATION_VARIABLES.map((name) => [name, process.env[name]] as const)

	for (const [name] of previous) forget(name)

	return (): void => {
		for (const [name, value] of previous) restore_one(name, value)
	}
}

const git_location_environment = { clear_git_location_variables, location_free_environment }

export { GIT_LOCATION_VARIABLES, git_location_environment }
