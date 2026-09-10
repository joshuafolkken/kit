import { read_repo_file } from '#scripts/ai-document-fixture'
import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1715. Two halves have to stay written down, and each one is a thing that goes
// silently wrong when it is not.
//
// The **measurement** half: a `backlogrun` parent's turns are readable by contributor, and the block
// that reads them is named where a person looking for it would look — the `diag` skill, which is what
// tells an agent which figures to take before ranking anything.
//
// The **cut** half: the largest contributor that measurement named was `issue bookkeeping`, dominated
// by one issue read at a time, and `josh issue:read` is what collapses it. A command nobody is told
// to type cuts nothing, so what is asserted is that the two documents an agent actually reads — §2g
// for a child, `backlogrun.md`'s decision pass for the parent — name it.

const DOCS = 'docs/josh-commands.md'
const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const BACKLOGRUN = '.claude/skills/workflow-commands/backlogrun.md'
const DIAG = '.claude/skills/diag/SKILL.md'
const COMMAND = 'issue:read'
const ALIAS = 'ird'
const SCRIPT_PATH = 'scripts/issue/issue-read-cli.ts'
const BLOCK_HEADING = 'Turns by contributor:'
// The figure the cut was chosen on. Quoted rather than paraphrased, so a later change to the
// enumeration has to argue with the measurement rather than quietly replace it.
const EVIDENCE = '110 of 414 turns'

const CONTRIBUTOR_ROWS: ReadonlyArray<string> = [
	'progress polling',
	'child confirmation',
	'loop asks',
	'issue bookkeeping',
	'investigation',
]

describe('josh issue:read is a registered command', () => {
	it('is in the command map, with its alias', () => {
		expect(COMMAND_MAP[COMMAND]?.script).toBe(SCRIPT_PATH)
		expect(ALIASES[ALIAS]).toBe(COMMAND)
	})
})

describe('the contributor block is documented where a reader looks for it', () => {
	it('names the block and every contributor row in the command reference', () => {
		const text = read_repo_file(DOCS)

		expect(text).toContain(BLOCK_HEADING)
		for (const row of CONTRIBUTOR_ROWS) expect(text).toContain(row)
	})

	// A block nobody is told to read is a block nobody reads: `diag` is what decides which figures a
	// ranking rests on, so the parent case has to be named there rather than only in the reference.
	it('tells diag to read it first for a parent, with the evidence', () => {
		const text = read_repo_file(DIAG)

		expect(text).toContain(BLOCK_HEADING)
		expect(text).toContain('26.6%')
	})

	// The block is a breakdown, never a verdict — `Bundling:` is what says whether a turn was
	// avoidable, and reading a large row as a finding is how the two come to disagree.
	it('says a large contributor is a reason to look rather than a finding', () => {
		expect(read_repo_file(DIAG)).toContain('a reason to look, never a finding')
	})
})

describe('the cut is named where the reads are made', () => {
	it('§2g types the batched read, and keeps the gh form for a cross-repository issue', () => {
		const text = read_repo_file(SKILL)

		expect(text).toContain(`pnpm josh ${COMMAND}`)
		expect(text).toContain('cross-repository')
		expect(text).toContain(EVIDENCE)
	})

	// The parent's own reading is the decision pass, which is where it reads the most issues in a row.
	it("backlogrun's decision pass reads every parked issue in one call", () => {
		const text = read_repo_file(BACKLOGRUN)

		expect(text).toContain(`pnpm josh ${COMMAND}`)
		expect(text).toContain(EVIDENCE)
	})

	// Why the turn is worth more here than inside a child, so a later reader does not "simplify" the
	// batching away as a micro-optimization.
	it('records why a parent turn is worth more than a child turn', () => {
		expect(read_repo_file(BACKLOGRUN)).toContain('n²/2')
	})
})
