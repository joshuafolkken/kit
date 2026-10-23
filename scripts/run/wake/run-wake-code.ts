import { git_command } from '#scripts/git/git-command'
import { error_text } from '#scripts/lib/error-message'
import { import_graph } from '#scripts/lint/import-graph'

// Whether the supervisor still runs the code on disk (joshuafolkken/kit#4509). A supervisor keeps the
// code it started with for its whole life, while the lanes' ships run each new main — so a change to
// what the supervisor serves them, the broker's request format above all, stops every lane that asks.
//
// **The code is the entry's import closure, not the tree**: a merge that touched only files the
// supervisor never imports changes nothing it runs, and restarting on it would only cost a broker gap.
// The closure is hashed as the lint cache hashes it (`import-graph.ts`).
//
// **The closure is re-hashed only once the commit has moved**: hashing it reads every file it reaches,
// and on most passes nothing has merged since the last one.

interface CodeSource {
	// The commit the checkout sits on; `undefined` where it cannot be read.
	head: () => Promise<string | undefined>
	// The hash of the entry's import closure; `undefined` where it cannot be computed.
	closure: () => Promise<string | undefined>
}

interface CodeState {
	head: string | undefined
	loaded: string | undefined
	// A suspicion taken while the closure could not be hashed, kept for the next pass.
	is_suspect: boolean
}

// **A hash that cannot be computed is never stale**: a supervisor that cannot tell keeps running, as
// it did before this check existed, rather than restarting on every pass. **A suspected supervisor whose
// start left no baseline is stale** (joshuafolkken/kit#4714): the broker refused a request, and without
// a baseline nothing else could ever tell it differs, so the successor reads one afresh.
function is_changed(
	loaded: string | undefined,
	current: string | undefined,
	is_suspected: boolean,
): boolean {
	if (current === undefined) return false
	if (loaded === undefined) return is_suspected

	return loaded !== current
}

// **A move and a suspicion are consumed only once they were hashed**, so a closure that could not be
// read at them is read again at the next pass (joshuafolkken/kit#4714).
function consume(
	state: CodeState,
	read: { head: string | undefined; is_suspect: boolean },
	current: string | undefined,
): void {
	if (current === undefined) {
		state.is_suspect = read.is_suspect

		return
	}

	state.head = read.head
	state.is_suspect = false
}

// **A suspicion re-hashes an unmoved commit** (joshuafolkken/kit#4714).
async function is_stale(
	state: CodeState,
	source: CodeSource,
	is_suspected: () => boolean,
): Promise<boolean> {
	const head = await source.head()
	const is_suspect = is_suspected() || state.is_suspect
	if (!is_suspect && head === state.head) return false

	const current = await source.closure()

	consume(state, { head, is_suspect }, current)

	return is_changed(state.loaded, current, is_suspect)
}

// The baseline is read when the watch starts — at the supervisor's start, as close to the moment its
// modules were loaded as a reading can be. `is_suspected` answers, and clears, whether something has
// seen this code differ from main's since it was last asked (`lane-session-broker.ts`).
async function watch(
	source: CodeSource,
	is_suspected: () => boolean = () => false,
): Promise<() => Promise<boolean>> {
	const state: CodeState = {
		head: await source.head(),
		loaded: await source.closure(),
		is_suspect: false,
	}

	return async () => await is_stale(state, source, is_suspected)
}

async function read_head(): Promise<string | undefined> {
	try {
		return await git_command.head_commit()
	} catch (error) {
		error_text.trace_swallowed('run_wake_code.read_head', error)

		return undefined
	}
}

// A fresh graph each time: one graph caches the content it read, so it would answer the old hash.
async function read_closure(root: string, entry: string): Promise<string | undefined> {
	try {
		const graph = await import_graph.create(root)

		return graph?.closure_hash(entry)
	} catch (error) {
		error_text.trace_swallowed('run_wake_code.read_closure', error)

		return undefined
	}
}

function source_of(root: string, entry: string): CodeSource {
	return { head: read_head, closure: async () => await read_closure(root, entry) }
}

const run_wake_code = { source_of, watch }

export type { CodeSource }
export { run_wake_code }
