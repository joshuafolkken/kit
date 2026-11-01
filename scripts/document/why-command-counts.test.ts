import { describe, expect, it } from 'vitest'
import { read_document } from './ai-document-fixture'

// `docs/why.md` carries no command count: every lane that adds a command would rewrite the same line,
// and two such lanes collide on it at ship's sync (#5644). The catalog is where the commands are counted.
const WHY = 'docs/why.md'
const COMMAND_COUNT = /\d `josh` commands|\d of them are meant to be run by the agent/u

describe(WHY, () => {
	it('quotes no command count that adding a command would change', () => {
		expect(read_document(WHY)).not.toMatch(COMMAND_COUNT)
	})

	it('points at the catalog for the command list', () => {
		expect(read_document(WHY)).toContain('(josh-command-catalog.md)')
	})

	it('has a single H1 heading', () => {
		const headings = read_document(WHY)
			.split('\n')
			.filter((line) => line.startsWith('# '))

		expect(headings).toStrictEqual(['# Why kit exists'])
	})
})
