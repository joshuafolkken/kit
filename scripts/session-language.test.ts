import { describe, expect, it } from 'vitest'
import {
	AI_DOCS,
	ENV_EXAMPLE,
	read_repo_file,
	read_rule_surface,
	WORKFLOW_PROMPT,
} from './ai-document-fixture'

// The clause is pasted into every workflow definition, so it is declared once here — a marker
// that drifts from the documents by one backtick would pass silently as a substring search.
const SESSION_LANGUAGE_CLAUSE = 'the session language (`JOSH_SESSION_LANG`, default `ja`)'
const CANONICAL_SECTION = '出力の言語（`JOSH_SESSION_LANG`）'

// The resolution rule lives in five files (three AI docs, the workflow prompt, the env sample).
// A rule that lands in only some of them leaves the AI reading two different language policies,
// so every marker is asserted per file rather than once against a concatenation.
const RESOLUTION_MARKERS: ReadonlyArray<string> = [
	'- **Output language follows `JOSH_SESSION_LANG` (personal, optional).**',
	'Issue bodies, Issue/PR comments (plan comments and completion comments alike), and Telegram notification bodies',
	'while artifact prose defaults to **`ja`**',
]

// Without the exceptions the rule reads as "translate everything", and the title-normalization
// step wired into every workflow would start producing non-English Issue titles.
const EXCEPTION_MARKERS: ReadonlyArray<string> = [
	'**Issue and PR titles** — the title-normalization step in `kickoff` / `fullrun` / `halfrun` / `queue` is unchanged',
	'**code comments, test titles, and commit messages**',
	'**fixed strings emitted by the scripts**',
	// A completion comment is artifact prose whose structure is labelled — leaving the labels
	// English would ship a half-translated body, which reads worse than either language alone.
	// joshuafolkken/kit#1275 moved the label mapping itself to the pointer, so what is pinned
	// resident is the instruction that those three labels are translated, not the table doing it.
	"a completion report's `Cause` / `Fix` / `Result`, is written in the session language",
]

// Every workflow definition carries its own language clause, and the AI reads those while running
// kickoff / fullrun / halfrun rather than the policy bullet at the top of the document.
const WORKFLOW_CLAUSE_MARKERS: ReadonlyArray<string> = [
	`Plan comments are written in ${SESSION_LANGUAGE_CLAUSE}.`,
	`Issue plan comments are written in ${SESSION_LANGUAGE_CLAUSE}.`,
	`compose an implementation summary in ${SESSION_LANGUAGE_CLAUSE}`,
	`Post the plan in ${SESSION_LANGUAGE_CLAUSE}`,
	`Post the agreed plan in ${SESSION_LANGUAGE_CLAUSE}`,
]

// The old pin survives as a contradiction if any single occurrence is missed, and the AI has no
// way to tell which of the two rules is current — so absence is asserted, not just presence.
const REMOVED_PIN_MARKERS: ReadonlyArray<string> = [
	'stay in English regardless of `JOSH_SESSION_LANG`',
	'artifact languages (Issue / PR / Telegram = English) are unchanged',
	'the artifact language stays English',
	'Artifact languages are unaffected',
	'Plan comments MUST be in English',
	'Issue plan comments MUST be written in English',
	'Post the agreed plan in English',
	'Post the plan in English',
	'compose an implementation summary in English',
]

const WORKFLOW_MARKERS: ReadonlyArray<string> = [
	`### ${CANONICAL_SECTION}`,
	'**未設定の場合は `ja` を既定とする。**',
	'**設定に関わらず英語で固定するもの**（3 つ）:',
	'1. **Issue／PR タイトル**: Step 1 のタイトル正規化ルールは変更しない。',
]

const WORKFLOW_REMOVED_MARKERS: ReadonlyArray<string> = [
	'### セッション対話の言語（`JOSH_SESSION_LANG`）',
	'成果物は常に英語',
	'Issue / PR / Telegram の言語は英語のまま変更なし',
	'自動投稿される Issue コメント文面は英語で記載する',
]

function expect_present(relative_path: string, markers: ReadonlyArray<string>): void {
	const raw = read_repo_file(relative_path)

	for (const marker of markers) expect(raw).toContain(marker)
}

// Reads the surface, not the document: the workflow definitions that carried the retired English
// pins moved into the skills, so a pin re-introduced in `fullrun.md` has to fail here.
function expect_absent(relative_path: string, markers: ReadonlyArray<string>): void {
	const raw = read_rule_surface(relative_path)

	for (const marker of markers) expect(raw).not.toContain(marker)
}

// kit#854 moved the workflow definitions into `.claude/skills/workflow-commands/`, taking their
// language clauses with them. The clause still has to be on every definition, so the assertion reads
// the document plus the skills it routes to rather than the document alone.
function expect_present_on_surface(document_path: string, markers: ReadonlyArray<string>): void {
	const raw = read_rule_surface(document_path)

	for (const marker of markers) expect(raw).toContain(marker)
}

describe('output language — resolution rule in the AI docs', () => {
	it.each(AI_DOCS)('%s resolves artifact prose through JOSH_SESSION_LANG', (ai_document) => {
		expect_present(ai_document, RESOLUTION_MARKERS)
	})

	it.each(AI_DOCS)('%s keeps titles and code conventions in English', (ai_document) => {
		expect_present(ai_document, EXCEPTION_MARKERS)
	})

	it.each(AI_DOCS)('%s routes every plan comment through the session language', (ai_document) => {
		expect_present_on_surface(ai_document, WORKFLOW_CLAUSE_MARKERS)
	})

	it.each(AI_DOCS)('%s no longer pins artifacts to English', (ai_document) => {
		expect_absent(ai_document, REMOVED_PIN_MARKERS)
	})

	it.each(AI_DOCS)('%s documents the new scope in the environment table', (ai_document) => {
		expect_present(ai_document, [
			'When unset, dialogue matches the conversation and artifact prose defaults to `ja`.',
		])
	})

	it.each(AI_DOCS)('%s points at the renamed canonical section', (ai_document) => {
		expect_present(ai_document, [`"${CANONICAL_SECTION}"`])
	})
})

describe('output language — canonical reference in the workflow prompt', () => {
	it('declares the resolution rule and its fixed Japanese fallback', () => {
		expect_present(WORKFLOW_PROMPT, WORKFLOW_MARKERS)
	})

	it('drops every trace of the always-English pin', () => {
		expect_absent(WORKFLOW_PROMPT, WORKFLOW_REMOVED_MARKERS)
	})
})

describe('output language — the env sample developers copy', () => {
	it('describes the artifact scope and the Japanese default', () => {
		expect_present(ENV_EXAMPLE, ['artifact prose defaults to `ja`', 'Issue / PR titles,'])
	})

	it('no longer claims artifact output stays English', () => {
		expect_absent(ENV_EXAMPLE, ['Issue / PR / Telegram output stays English'])
	})
})
