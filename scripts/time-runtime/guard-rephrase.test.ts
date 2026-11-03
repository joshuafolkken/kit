import { guard_friction_fixture } from '#tools/retrospective/guard-friction-fixture'
import { describe, expect, it } from 'vitest'
import { guard_rephrase } from './guard-rephrase'

const { node, session, refusal_line, bash_call_line, allowed_line, investigator_call_line } =
	guard_friction_fixture
const BATCHING = '⛔ batching: issue these together'
const INVESTIGATION = '⛔ investigation: delegate the reading'

function rephrased(lines: ReadonlyArray<string>): Array<string> {
	return guard_rephrase.rephrased_guards(session(node('lane'), lines).lines)
}

describe('guard_rephrase.rephrased_guards', () => {
	it('counts a refusal the next call of its tool turned into an allowed one', () => {
		const lines = [
			bash_call_line(1, 'a'),
			refusal_line(2, 'a', BATCHING),
			bash_call_line(3, 'b'),
			allowed_line(4, 'b'),
		]

		expect(rephrased(lines)).toEqual(['batching'])
	})

	it('never counts an allowed call issued beside the refused one in the same turn', () => {
		const lines = [
			bash_call_line(1, 'a'),
			bash_call_line(1, 'b'),
			refusal_line(2, 'a', BATCHING),
			allowed_line(2, 'b'),
		]

		expect(rephrased(lines)).toEqual([])
	})
})

describe('guard_rephrase.rephrased_guards on a retry', () => {
	it('waits through a refused retry and credits the guard that refused last', () => {
		const lines = [
			bash_call_line(1, 'a'),
			refusal_line(2, 'a', BATCHING),
			bash_call_line(3, 'b'),
			refusal_line(4, 'b', INVESTIGATION),
			bash_call_line(5, 'c'),
			allowed_line(6, 'c'),
		]

		expect(rephrased(lines)).toEqual(['investigation'])
	})

	it('never counts an allowed call of another tool as the rephrasing', () => {
		const lines = [
			bash_call_line(1, 'a'),
			refusal_line(2, 'a', BATCHING),
			investigator_call_line(3, 'b'),
			allowed_line(4, 'b'),
		]

		expect(rephrased(lines)).toEqual([])
	})

	it('counts nothing for a refusal the session never retried', () => {
		expect(rephrased([bash_call_line(1, 'a'), refusal_line(2, 'a', BATCHING)])).toEqual([])
	})
})
