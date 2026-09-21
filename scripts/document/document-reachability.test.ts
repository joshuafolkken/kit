import { describe, expect, it } from 'vitest'
import { agent_read_documents } from './ai-document-fixture'
import { document_reachability } from './document-reachability'
import { entry_read_set } from './entry-read-set'

const { classify, covered_documents, documents_labelled, unreached_documents, RESIDENT_BASE } =
	document_reachability

function sorted(paths: ReadonlyArray<string>): Array<string> {
	return [...paths].toSorted((left, right) => left.localeCompare(right))
}

describe('document reachability — where each agent-read document sits on the execution path', () => {
	// The classification and the two budgets partition the corpus with nothing left over: every
	// agent-read document is covered (an entry reads it) or unreached (none does), never both.
	it('partitions the corpus into covered and unreached with nothing dropped', () => {
		const unreached = unreached_documents(agent_read_documents())
		const partition = sorted([...covered_documents(), ...unreached])

		expect(partition).toEqual(sorted(agent_read_documents()))
	})

	it('never puts a document in both covered and unreached', () => {
		const unreached = new Set(unreached_documents(agent_read_documents()))

		expect(covered_documents().filter((one) => unreached.has(one))).toEqual([])
	})

	// The misclassification joshuafolkken/kit#2257 singled out: a bare reachability walk drops the
	// always-resident rule document to off-path, which is wrong. It must be resident, and covered.
	it('classifies the resident rule document as resident, not off-path', () => {
		const labels = classify(agent_read_documents())
		for (const base of RESIDENT_BASE) expect(labels.get(base)).toBe('resident')

		expect(covered_documents()).toEqual(expect.arrayContaining([...RESIDENT_BASE]))
	})

	// Point-of-use is not re-listed here — it is the distinction `entry_read_set` already draws, so a
	// document named in a trigger table but read only when its command runs stays point-of-use.
	it('labels exactly the point-of-use documents point-of-use', () => {
		const point_of_use = documents_labelled('point-of-use', agent_read_documents()).map((one) =>
			one.split('/').at(-1),
		)

		expect(sorted(point_of_use.filter((one): one is string => one !== undefined))).toEqual(
			sorted([...entry_read_set.POINT_OF_USE_FILES]),
		)
	})

	// Every covered document is one the budget can hold through an entry total, and every unreached one
	// is a real corpus document — so the per-document budget derived from this set names nothing stale.
	it('draws both sides from the agent-read corpus', () => {
		const corpus = new Set(agent_read_documents())

		expect(covered_documents().every((one) => corpus.has(one))).toBe(true)
		expect(unreached_documents(agent_read_documents()).every((one) => corpus.has(one))).toBe(true)
	})
})
