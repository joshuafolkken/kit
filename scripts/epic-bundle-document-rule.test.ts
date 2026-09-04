import { describe, expect, it } from 'vitest'
import {
	AI_DOCS,
	read_repo_file,
	read_rule_surface,
	read_unwrapped,
	WORKFLOW_PROMPT,
} from './ai-document-fixture'

// joshuafolkken/kit#873: the value of this rule is entirely in its limits. Without the
// strong-signal threshold it bundles unrelated issues; without the "already in an epic" branch it
// creates a second epic for an issue that has one; and without the decision record its Tier A
// placement choice (joshuafolkken/kit#1339) becomes a choice nobody can audit. A document that keeps
// the rule and loses any of the three is worse than not having it.

// The procedure moved into the `epic-commands` skill, so these are checked across the rule surface.
const SURFACE_MARKERS: ReadonlyArray<string> = [
	'`josh epic:bundle <N>`',
	'A similar title never counts on its own',
	'Add to **that** epic',
	// joshuafolkken/kit#1339: placing an issue is reversible in one `epic --add`, so this branch
	// chooses and records rather than stopping. The record is the half a reword drops first, and
	// without it the autonomy has no audit trail at all.
	'**Choose the one you recommend, add to it, and record why**',
	'Placing an issue is not merging epics',
	'The decision record is what pays for the autonomy',
	'No strong signal',
	'nobody declared is not invented',
	'It recommends; it writes nothing',
	// joshuafolkken/kit#947: the open-only search could answer correctly for about three minutes after
	// a follow-up issue was filed. Past it the command asserted there was no relation rather than that
	// it had stopped being able to see one, so the widened scope is part of the rule, not a detail.
	'The search is not limited to the open backlog',
	'counts only when an open epic already tracks it',
	'never folded into "no strong signal"',
	// joshuafolkken/kit#957: reported as a gap, one non-existent number puts a warning above the
	// verdict — and joshuafolkken/kit#950's rule then stops an unattended run over a reference that
	// never existed. The distinction is the rule, so it is pinned like the ones around it.
	'A number that does not exist is not a gap',
	'told apart by HTTP status',
]

const CANONICAL_MARKERS: ReadonlyArray<string> = [
	'それだけでは束ねる根拠にしない',
	'所属先を選ぶことは epic の統合ではない',
	'記録が自律の対価である',
	'順序を記録しないと、束ねた事実だけが残って束ねた理由が消える',
	'誰も宣言していない順序をここで捏造しない',
	'同じ解析を 2 回書かない',
	'索引やキャッシュは用意しない',
	'**候補探索は open backlog に限らない。**',
	'**closed の参照先は、open な EPIC が既に追跡している場合にのみ候補にする。**',
	'**読み取りの失敗も、上限で読まなかった参照も、欠落として報告し「強い信号なし」に畳み込まない**',
	'**番号が pull request だった場合は候補にしない。**',
	'**実在しない番号は欠落として報告しない。**',
	'**その判別は `gh` のエラー文言ではなく HTTP ステータスコードで行う。**',
]

// The four rows of the decision table; losing one leaves a branch nobody handles.
const DECISION_MARKERS: ReadonlyArray<string> = [
	// The branch a real run reached first: an issue an epic already tracks has nothing to bundle.
	'新規 Issue 自身が既に epic の子',
	'関連候補が**既に epic の子**',
	'複数の異なる epic',
	'新規 epic を作って束ねる',
	'強い信号を持つ候補が無い',
]

describe('bundling documentation', () => {
	it.each(AI_DOCS)('is reachable from %s', (document_name) => {
		const surface = read_rule_surface(document_name).replaceAll(/\s+/gu, ' ')

		for (const marker of SURFACE_MARKERS) expect(surface).toContain(marker)
	})

	it.each(AI_DOCS)('routes %s to the skill rather than inlining it', (document_name) => {
		expect(read_repo_file(document_name)).toContain('epic-commands')
	})

	it('has a canonical section in the workflow prompt', () => {
		const content = read_unwrapped(WORKFLOW_PROMPT)

		for (const marker of CANONICAL_MARKERS) expect(content).toContain(marker)
	})

	it('keeps every branch of the decision table', () => {
		const content = read_unwrapped(WORKFLOW_PROMPT)

		for (const marker of DECISION_MARKERS) expect(content).toContain(marker)
	})

	// The command recommends; it does not write. A document that implied otherwise would have it
	// bundling without the judgement the rule reserves for the reader.
	it('says the command writes nothing', () => {
		expect(read_unwrapped(WORKFLOW_PROMPT)).toContain('このコマンドは何も書き込まない')
	})
})

// joshuafolkken/kit#1339 moved the spread row from "stop and ask" to "choose and record", and the old
// wording survived in five files the change first missed — the command's own reason string among them,
// printed directly under the new headline. **Positive markers cannot catch that**: they assert the new
// text is somewhere, not that the old text is nowhere, and `read_rule_surface` covers only `CLAUDE.md`
// and the skills, so `docs/` and the canonical prompts are outside it entirely. These are the negative
// half, and they name the files by path for that reason.
const STOP_WORDING: ReadonlyArray<string> = [
	'ask` stops',
	'parks the child inside an `epicrun`',
	'**Stop and ask**',
	'merging epics is not a call to make without asking',
	'`ask` は停止',
]

const READERS_OF_THE_RULE: ReadonlyArray<string> = [
	'docs/josh-commands.md',
	'prompts/review.md',
	'prompts/collaboration-workflow/epic-bundle.md',
	'prompts/collaboration-workflow/plan-comment.md',
	'.claude/skills/epic-commands/SKILL.md',
	'.claude/skills/workflow-commands/fullrun.md',
	'.claude/skills/workflow-commands/chain-rule.md',
	'.claude/skills/diag/SKILL.md',
	'scripts/epic/epic-bundle.ts',
	'scripts/epic/epic-bundle-cli.ts',
]

describe('the spread row no longer tells a run to stop', () => {
	it.each(READERS_OF_THE_RULE)('%s carries none of the old wording', (path) => {
		const content = read_repo_file(path)

		for (const wording of STOP_WORDING) expect(content).not.toContain(wording)
	})
})
