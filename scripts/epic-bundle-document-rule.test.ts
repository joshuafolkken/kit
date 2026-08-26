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
// creates a second epic for an issue that has one; without the Tier B stop it merges epics on its
// own. A document that keeps the rule and loses any of the three is worse than not having it.

// The procedure moved into the `epic-commands` skill, so these are checked across the rule surface.
const SURFACE_MARKERS: ReadonlyArray<string> = [
	'`josh epic:bundle <N>`',
	'A similar title never counts on its own',
	'Add to **that** epic',
	'**Stop and ask**',
	'No strong signal',
	'nobody declared is not invented',
	'It recommends; it writes nothing',
]

const CANONICAL_MARKERS: ReadonlyArray<string> = [
	'それだけでは束ねる根拠にしない',
	'epic の統合だけは影響範囲が大きいため Tier B とする',
	'順序を記録しないと、束ねた事実だけが残って束ねた理由が消える',
	'誰も宣言していない順序をここで捏造しない',
	'同じ解析を 2 回書かない',
	'索引やキャッシュは用意しない',
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
