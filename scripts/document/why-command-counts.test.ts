import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import { read_document } from './ai-document-fixture'

// `docs/why.md` quotes the size of the `josh` surface for scale. The figures are derived from the
// command registry here, so a command added or removed fails this test until the page is updated.
const WHY = 'docs/why.md'
const AGENT_AUDIENCE = 'automation'

function command_total(): number {
	return Object.keys(COMMAND_MAP).length
}

function agent_command_count(): number {
	return Object.values(COMMAND_MAP).filter((entry) => entry.reference[1] === AGENT_AUDIENCE).length
}

describe(WHY, () => {
	it('quotes the command total and the agent-run count from the registry', () => {
		const expected = `there are ${String(command_total())} \`josh\` commands, and **${String(agent_command_count())} of them are meant to be run by the agent`

		expect(read_document(WHY)).toContain(expected)
	})

	it('has a single H1 heading', () => {
		const headings = read_document(WHY)
			.split('\n')
			.filter((line) => line.startsWith('# '))

		expect(headings).toStrictEqual(['# Why kit exists'])
	})
})
