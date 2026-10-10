import { read_unwrapped } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#3648: a plan comment restored a handed-over stash with `git stash apply`, which the
// working-tree guard refuses, and the lane parked to ask how to apply it. The stash rule now names the
// one restore route, the plan-comment rule keeps the refused forms out of a plan, and the run reads a
// refused form as `stash:pop` on its own authority. Each marker below pins one of those statements.

const OPERATING_RULES = 'prompts/collaboration-workflow/operating-rules.md'
const PLAN_COMMENT = 'prompts/collaboration-workflow/plan-comment.md'
const STASH_POP = '`pnpm josh stash:pop "<メッセージ>"`'

interface Marker {
	readonly document_path: string
	readonly statement: string
}

const MARKERS: ReadonlyArray<Marker> = [
	{ document_path: OPERATING_RULES, statement: '引き渡し用の stash' },
	{
		document_path: OPERATING_RULES,
		statement: `${STASH_POP} で復元する。当てたあと stash は消える`,
	},
	{ document_path: OPERATING_RULES, statement: '計画には復元手順としてこの 1 行だけを書く' },
	{
		document_path: OPERATING_RULES,
		statement: '`git stash apply` / `git stash pop` も「drop しない」という条件も書かない',
	},
	{
		document_path: OPERATING_RULES,
		statement: '`stash:pop` に読み替えて続行し、Issue コメントに残す（Tier A）',
	},
	{ document_path: OPERATING_RULES, statement: '`needs-decision` では止まらない' },
	{ document_path: OPERATING_RULES, statement: '持ち主が計画に理由を書き' },
	{ document_path: PLAN_COMMENT, statement: `復元手順には ${STASH_POP} だけを書く` },
	{
		document_path: PLAN_COMMENT,
		statement: '`git stash apply` / `git stash pop` と「drop しない」という条件は書かない',
	},
	{ document_path: PLAN_COMMENT, statement: '`operating-rules.md` → "no-self-staging"' },
]

describe('the handed-over stash rule', () => {
	it.each(MARKERS)('$document_path states $statement', ({ document_path, statement }) => {
		expect(read_unwrapped(document_path)).toContain(statement)
	})

	// The plan-comment pointer is only correct while the heading it names still exists.
	it('points at a heading operating-rules.md still carries', () => {
		expect(read_unwrapped(OPERATING_RULES)).toContain('### no-self-staging')
	})
})
