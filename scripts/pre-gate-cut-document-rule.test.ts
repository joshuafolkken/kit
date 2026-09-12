import { read_repo_file } from '#scripts/ai-document-fixture'
import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1839: the pre-gate cut lets a lane child end its process before the gate and a
// fresh one resume from it. These pin the two halves a rewrite would lose first — the command is
// registered where the run reaches it, and the single-source procedure states the boundary, the
// verdicts and why it does not contradict the chain rule.

const SKILL = '.claude/skills/workflow-commands'
const CUT = `${SKILL}/pre-gate-cut.md`
const FULLRUN = `${SKILL}/fullrun.md`
const CHAIN = `${SKILL}/chain-rule.md`
const EPICRUN = `${SKILL}/epicrun.md`
const DOCS = 'docs/josh-commands.md'

const CUT_COMMAND = 'run:cut'
const CUT_ALIAS = 'rct'
const CUT_SCRIPT = 'scripts/run/run-cut-cli.ts'
const RESUME_CHECK = 'pnpm josh run:cut --resume <N>'
const POINTER = 'pre-gate-cut.md'

const CUT_MARKERS: ReadonlyArray<string> = [
	'# The pre-gate cut — a lane child ends its turn before the gate',
	// The measurement, so a later change has to argue with the figure.
	'176K of 204K output tokens',
	// The two commands, as the run types them.
	'pnpm josh run:cut <N>',
	RESUME_CHECK,
	// Why nothing is persisted but the metadata.
	'The working tree is not in the record, because it never left the disk',
	// The chain-rule reconciliation.
	'a sanctioned boundary',
	'This file is the single source of the rule.',
]

describe('run:cut is registered', () => {
	it('runs the script it is documented as running', () => {
		expect(COMMAND_MAP[CUT_COMMAND]?.script).toBe(CUT_SCRIPT)
	})

	it('has the short alias the documents print', () => {
		expect(ALIASES[CUT_ALIAS]).toBe(CUT_COMMAND)
	})
})

describe(`${CUT} states the pre-gate cut rule`, () => {
	it.each(CUT_MARKERS)('states: %j', (marker) => {
		expect(read_repo_file(CUT)).toContain(marker)
	})
})

describe('the entry documents route to the single source', () => {
	it('fullrun names the resume check and the single source', () => {
		const content = read_repo_file(FULLRUN)

		expect(content).toContain(RESUME_CHECK)
		expect(content).toContain(POINTER)
	})

	it('the chain rule marks the cut as a sanctioned boundary distinct from the push', () => {
		const content = read_repo_file(CHAIN)

		expect(content).toContain('before the gate, never at the push')
		expect(content).toContain(POINTER)
	})

	it('epicrun names the cut in its lanes section', () => {
		expect(read_repo_file(EPICRUN)).toContain('A lane child may cut its own turn before the gate')
	})

	it('josh-commands documents the command', () => {
		expect(read_repo_file(DOCS)).toContain('### `josh run:cut`')
	})
})
