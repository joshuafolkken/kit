import type { Block, TranscriptLine } from './time-transcript-line'

// Guard refusals rephrased into an allowed call — the false-positive proxy of a guard's predicate,
// read by guard-friction's `GuardRow.rephrased` and by `josh rule:value` (`rule-rephrase.ts`).
//
// **A refusal is rephrased when the next call of the same tool, issued after the refusal came back,
// is allowed.** A call issued beside the refused one in the same parallel turn is not its rephrasing,
// so only a tool_use read after the refusal's result is a candidate; a candidate refused again waits
// for the next call in turn. The guard is the raw label the block carries — each caller maps a renamed
// guard to its current name.

interface RephraseState {
	names: Map<string, string>
	pending: Map<string, string>
	candidates: Map<string, string>
	rephrased: Array<string>
}

function on_use(state: RephraseState, block: Block): void {
	const guard = state.pending.get(block.name)

	state.names.set(block.id, block.name)
	if (guard === undefined) return
	state.candidates.set(block.id, guard)
	state.pending.delete(block.name)
}

function on_allowed(state: RephraseState, id: string): void {
	const guard = state.candidates.get(id)

	if (guard !== undefined) state.rephrased.push(guard)
}

function on_result(state: RephraseState, block: Block): void {
	const name = state.names.get(block.result_id) ?? ''

	if (block.refusal_guard === '') {
		on_allowed(state, block.result_id)
	} else {
		state.pending.set(name, block.refusal_guard)
	}
}

function on_block(state: RephraseState, block: Block): void {
	if (block.type === 'tool_use') on_use(state, block)
	else if (block.result_id !== '') on_result(state, block)
}

// The guard of every refusal in the session that the next call of its tool rephrased, in order.
function rephrased_guards(lines: ReadonlyArray<TranscriptLine>): Array<string> {
	const state: RephraseState = {
		names: new Map(),
		pending: new Map(),
		candidates: new Map(),
		rephrased: [],
	}
	const blocks = lines.flatMap((line) => line.blocks)

	for (const block of blocks) on_block(state, block)

	return state.rephrased
}

const guard_rephrase = { rephrased_guards }

export { guard_rephrase }
