import { read_repo_file } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'

const BACKGROUND = read_repo_file('.claude/skills/workflow-commands/background-commands.md')

// joshuafolkken/kit#5442: approval writes changed the tree under a running related test suite.
describe('background metrics guidance', () => {
	it('keeps read-only metrics available beside other tree readers', () => {
		expect(BACKGROUND).toContain('read-only `metrics`')
	})

	it('routes approval writes through ship before verification starts', () => {
		expect(BACKGROUND).toContain('`metrics --accept` writes must finish before verification starts')
		expect(BACKGROUND).toContain('existing `josh ship` pre-detach sequence')
	})

	it('leaves carried comment rounds to flush even without a child marker', () => {
		const ledger = read_repo_file('.claude/skills/workflow-commands/observation-ledger.md')

		expect(ledger).toContain('a lane, including one without a child marker, leaves that to')
	})
})
