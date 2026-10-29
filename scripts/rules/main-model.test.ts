import { describe, expect, it } from 'vitest'
import { main_model_reader } from './main-model'

// joshuafolkken/kit#5351: the main line's model, read from the newest transcript entry that names one.

const FABLE = 'claude-fable-5-1'
const OPUS = 'claude-opus-5-5'
const ASTRA = 'gpt-6.1-astra'

function assistant(model: string): string {
	return JSON.stringify({ type: 'assistant', message: { model, content: [] } })
}

function turn_context(model: string): string {
	return JSON.stringify({ type: 'turn_context', payload: { model } })
}

function tail_of(...lines: Array<string>): string {
	return `{"partial":\n${lines.join('\n')}\n`
}

function model_of(lines: Array<string>, payload_model?: string): string | undefined {
	return main_model_reader.main_model(tail_of(...lines), payload_model)
}

describe('main_model_reader.main_model — the main line model', () => {
	it('reads the newest assistant entry', () => {
		expect(model_of([assistant(OPUS), assistant(FABLE)])).toBe(FABLE)
	})

	it('skips a synthetic entry for the one before it', () => {
		expect(model_of([assistant(FABLE), assistant('<synthetic>')])).toBe(FABLE)
	})

	it("reads a Codex rollout's turn context", () => {
		expect(model_of([turn_context(ASTRA)])).toBe(ASTRA)
	})

	it('lets the payload model win over the transcript', () => {
		expect(model_of([assistant(FABLE)], ASTRA)).toBe(ASTRA)
	})

	it('names nothing when no entry does', () => {
		const user = JSON.stringify({ type: 'user', message: { content: 'hi' } })

		expect(model_of([user])).toBeUndefined()
	})
})
