import { time_shell } from './time-shell'
import type { ToolCall } from './time-tool-call'

// Which calls are a search, the one answer the investigation guard and the batching guard both read.
// A search carries no file text but costs a turn, so it is what a run issues one per turn while it
// locates the next edit.

const SEARCH_COMMANDS: ReadonlyArray<string> = ['fd', 'find', 'grep', 'rg']
const SEARCH_LABELS: ReadonlySet<string> = new Set(
	SEARCH_COMMANDS.map((command) => time_shell.bash_label(command)),
)

// A search chain also prints the lines a search found, so `sed` (read-only) joins it: `grep` → `sed`
// was measured the second-largest single-call pair in lane children.
const CHAIN_COMMANDS: ReadonlyArray<string> = [...SEARCH_COMMANDS, 'sed']
const CHAIN_LABELS: ReadonlySet<string> = new Set(
	CHAIN_COMMANDS.map((command) => time_shell.bash_label(command)),
)

type SearchFacts = Pick<ToolCall, 'label' | 'is_bundleable' | 'may_write' | 'is_writing'>

// `may_write` over-calls, as the investigation guard's refusal test must.
function is_read_only_search(call: SearchFacts): boolean {
	return SEARCH_LABELS.has(call.label) && call.is_bundleable && !call.may_write
}

// `may_write` holds for every `sed`, so the chain asks `is_writing` — certain, and false for `sed -n`.
function is_search_chain_call(call: SearchFacts): boolean {
	return CHAIN_LABELS.has(call.label) && call.is_bundleable && !call.is_writing
}

const time_search_call = {
	is_read_only_search,
	is_search_chain_call,
}

export type { SearchFacts }
export { time_search_call }
