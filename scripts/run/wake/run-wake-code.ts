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
}

// **A hash that cannot be computed is never stale**: a supervisor that cannot tell keeps running, as
// it did before this check existed, rather than restarting on every pass.
function is_changed(loaded: string | undefined, current: string | undefined): boolean {
	if (loaded === undefined || current === undefined) return false

	return loaded !== current
}

async function is_stale(state: CodeState, source: CodeSource): Promise<boolean> {
	const head = await source.head()
	if (head === state.head) return false

	state.head = head

	return is_changed(state.loaded, await source.closure())
}

// The baseline is read when the watch starts — at the supervisor's start, as close to the moment its
// modules were loaded as a reading can be.
async function watch(source: CodeSource): Promise<() => Promise<boolean>> {
	const state: CodeState = { head: await source.head(), loaded: await source.closure() }

	return async () => await is_stale(state, source)
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
