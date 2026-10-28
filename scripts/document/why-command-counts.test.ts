import { derived_artifacts } from '#tools/document/derived-artifacts'
import { describe, expect, it } from 'vitest'
import { read_document } from './ai-document-fixture'

// `docs/why.md` quotes the size of the `josh` surface for scale. The figures are derived from the
// command registry, so a command added or removed fails this test until the page is rewritten.
const WHY = 'docs/why.md'

describe(WHY, () => {
	it('quotes the command total and the agent-run count from the registry', () => {
		const message = `the command counts are stale — run \`${derived_artifacts.DERIVE_COMMAND}\``

		expect(read_document(WHY), message).toContain(derived_artifacts.why_counts_sentence())
	})

	it('has a single H1 heading', () => {
		const headings = read_document(WHY)
			.split('\n')
			.filter((line) => line.startsWith('# '))

		expect(headings).toStrictEqual(['# Why kit exists'])
	})
})
