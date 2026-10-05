import { read_unwrapped } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#3170: two workflow documents told an agent to do the opposite of the current
// single sources — review in the main line, write overrides where pnpm ignores them, run a retired
// update command, put a body in shell double quotes, and judge first-party by a list of names. Each
// pair below pins the corrected wording present and the wrong wording absent.

const PLAN_COMMENT = 'prompts/collaboration-workflow/plan-comment.md'
const UPSTREAM = 'prompts/collaboration-workflow/upstream-interrupt.md'
const CLAUDE = 'CLAUDE.md'
const CLAUDE_HEADING = 'Cross-package problems → file the upstream Issue, then stop'

interface Correction {
	readonly document_path: string
	readonly present: string
	readonly absent: string
}

const CORRECTIONS: ReadonlyArray<Correction> = [
	{
		document_path: PLAN_COMMENT,
		present: 'The review runs in a subagent, never a main-line skill load',
		absent: '実装者と同一コンテキスト',
	},
	{
		document_path: PLAN_COMMENT,
		present: '`pnpm-workspace.yaml` の `overrides`',
		absent: 'package.json の overrides に',
	},
	{ document_path: PLAN_COMMENT, present: 'pnpm josh latest:scope', absent: 'pnpm latest' },
	{ document_path: PLAN_COMMENT, present: '--field body=@<path>', absent: '-f body="' },
	{ document_path: UPSTREAM, present: 'pnpm josh repo:party', absent: 'kit / app-kit / game-kit' },
	{ document_path: UPSTREAM, present: CLAUDE_HEADING, absent: 'then always stop' },
]

describe('workflow documents agree with their single sources', () => {
	it.each(CORRECTIONS)('$document_path states $present', ({ document_path, present }) => {
		expect(read_unwrapped(document_path)).toContain(present)
	})

	it.each(CORRECTIONS)('$document_path no longer states $absent', ({ document_path, absent }) => {
		expect(read_unwrapped(document_path)).not.toContain(absent)
	})

	// The citation is only correct while the heading it quotes still exists.
	it('quotes a heading CLAUDE.md still carries', () => {
		expect(read_unwrapped(CLAUDE)).toContain(CLAUDE_HEADING)
	})
})
