import { describe, expect, it } from 'vitest'
import { AI_DOCS, CLAUDE_SETTINGS, read_repo_file, WORKFLOW_PROMPT } from './ai-document-fixture'

// The report format lives in five places (three AI docs, the workflow prompt, the hook).
// Updating only one of them leaves the AI with contradicting instructions, so assert per marker.
const OVERVIEW_MARKERS: ReadonlyArray<string> = [
	// Anchored to the fence so the prose that quotes the heading cannot satisfy the assertion.
	'```md\n   **■ Overview**\n',
	'**Details**',
	'**Changes and tests**',
	'- **Now**: <one sentence',
	'- **Change**: <one sentence',
	'- **Check**: <one sentence',
]

// The template must render as ordinary markdown in the session. A fenced block gets a
// background color and a monospace font, and space-padded alignment collapses.
const FENCED_TEMPLATE_MARKERS: ReadonlyArray<string> = [
	'--- Details ---',
	'Now:    <one sentence',
	'Change: <one sentence',
	'Check:  <one sentence',
]

const COMPLETION_MARKERS: ReadonlyArray<string> = [
	'Cause: ...',
	'Fix: ...',
	'Result: ...',
	'Details:',
]

describe('report format — plain-language overview in the AI docs', () => {
	it.each(AI_DOCS)('%s declares the two-layer work summary template', (ai_document) => {
		const raw = read_repo_file(ai_document)

		for (const marker of OVERVIEW_MARKERS) expect(raw).toContain(marker)
	})

	it.each(AI_DOCS)('%s bans implementation vocabulary from the overview', (ai_document) => {
		const raw = read_repo_file(ai_document)

		expect(raw).toContain(
			'Never put file paths, function or type names, or CLI option flags in the overview',
		)
	})

	it.each(AI_DOCS)(
		'%s requires completion reports to lead with cause, fix and result',
		(ai_document) => {
			const raw = read_repo_file(ai_document)

			expect(raw).toContain('Completion reports use the same two layers.')
			for (const marker of COMPLETION_MARKERS) expect(raw).toContain(marker)
		},
	)

	it.each(AI_DOCS)('%s no longer asks for the old technical-only summary', (ai_document) => {
		const raw = read_repo_file(ai_document)

		expect(raw).not.toContain('3–6 line work summary')
		expect(raw).not.toContain('"Implemented <title>:')
	})

	it.each(AI_DOCS)('%s bans wrapping the summary in a code fence', (ai_document) => {
		const raw = read_repo_file(ai_document)

		expect(raw).toContain('Never wrap the summary in a code fence.')
		expect(raw).toContain('if it is wrapped in a code fence, unwrap it before sending')
	})

	it.each(AI_DOCS)('%s no longer shows the space-aligned template', (ai_document) => {
		const raw = read_repo_file(ai_document)

		for (const marker of FENCED_TEMPLATE_MARKERS) expect(raw).not.toContain(marker)
	})
})

// An annotation inside the label ("plain language — always first") was read as part of the
// label itself and reached the session as `■ 概要（平易な説明）`. Stating the ban as "print the
// heading exactly as written" then read as "keep the English label", so the two rules —
// translate the label, do not annotate it — have to be asserted separately.
const JAPANESE_LABELS: ReadonlyArray<string> = ['**■ 概要**', '**技術詳細**', '**変更とテスト**']

describe('report format — label shape in the AI docs', () => {
	it.each(AI_DOCS)('%s keeps the overview heading free of annotations', (ai_document) => {
		const raw = read_repo_file(ai_document)

		expect(raw).toContain('A label carries no annotation.')
		expect(raw).not.toContain('**■ Overview (plain language — always first)**')
		expect(raw).not.toContain('Print the headings exactly as written')
	})

	it.each(AI_DOCS)('%s writes the labels in the session language', (ai_document) => {
		const raw = read_repo_file(ai_document)

		expect(raw).toContain('Labels are translated, not copied.')
		for (const label of JAPANESE_LABELS) expect(raw).toContain(label)
		expect(raw).toContain('`原因 / 対応 / 結果`')
	})
})

// The prohibition alone produced subject-less prose ("it stays stale", "the suggestion"),
// so it only holds paired with the requirement to name what the reader sees on screen.
describe('report format — concrete subjects in the AI docs', () => {
	it.each(AI_DOCS)('%s requires a concrete subject in every overview line', (ai_document) => {
		const raw = read_repo_file(ai_document)

		expect(raw).toContain('Name the concrete subject')
		expect(raw).toContain('name the affected package, screen, or kind of output')
		expect(raw).toContain('are allowed, and usually required')
	})

	it.each(AI_DOCS)('%s relaxes the overview length to fit a concrete subject', (ai_document) => {
		const raw = read_repo_file(ai_document)

		expect(raw).toContain('80–100 characters in Japanese, 20–25 words in English')
		expect(raw).not.toContain('about 60 characters in Japanese, 15 words in English')
	})
})

describe('report format — canonical reference in the workflow prompt', () => {
	it('defines the canonical section the AI docs point at', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain('## 報告フォーマット（平易な概要 ＋ 技術詳細）')
	})

	it('constrains the overview to plain vocabulary and a pre-send self-check', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain('概要にファイルパス・関数名・型名・CLI のオプションフラグ')
		expect(raw).toContain('送信前セルフチェック')
	})

	it('requires the session summary to be written without a code fence', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain('### 出力はコードフェンスで囲まない（必須）')
		expect(raw).toContain('**出力には含めない**')
	})

	it('no longer shows the space-aligned template', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).not.toContain('--- 技術詳細 ---')
		expect(raw).not.toContain('今こうなっている: <1文')
	})

	it('routes the completion body through the session language while restructuring it', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain('言語は「出力の言語（`JOSH_SESSION_LANG`）」に従う')
		for (const marker of COMPLETION_MARKERS) expect(raw).toContain(marker)
	})
})

describe('report format — label rules in the workflow prompt', () => {
	it('separates label translation from the annotation ban', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain('### ラベルはセッション言語に訳し、注釈は付けない（必須）')
		expect(raw).toContain('```md\n**■ 概要**\n')
		expect(raw).not.toContain('■ これからやること')
	})

	// The mapping is what makes "translate the label" actionable — without it the rule is
	// a sentence the reader has to invent the Japanese wording for.
	it('maps every English label to its Japanese session wording', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain('| `Details`')
		expect(raw).toContain('`技術詳細`')
		expect(raw).toContain('`変更とテスト`')
		expect(raw).toContain('`原因` / `対応` / `結果`')
	})
})

describe('report format — concrete subjects in the workflow prompt', () => {
	it('pairs the prohibition with a concrete-subject requirement and a worked example', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain('### 具体的な主語を必ず書く（禁止と対になる要求）')
		expect(raw).toContain('**悪い例**')
		expect(raw).toContain('**良い例**')
		// The examples must model the unfenced markdown shape, not the retired aligned one.
		expect(raw).toContain('- **今こうなっている**: バージョン確認が')
		expect(raw).toContain('日本語で 80〜100 字、英語で 20〜25 語')
		expect(raw).not.toContain('日本語で 60 字程度')
	})

	// The prohibition bullet is read on its own more often than the section below it,
	// so it has to carry the pointer to the counter-requirement.
	it('points from the prohibition bullet to the concrete-subject requirement', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain('「具体的な主語を必ず書く」と必ずセットで読む')
	})
})

describe('report format — UserPromptSubmit hook', () => {
	it('asks for the plain-language overview before the technical details', () => {
		const raw = read_repo_file(CLAUDE_SETTINGS)

		expect(raw).toContain('two-layer work summary')
		expect(raw).toContain('Now / Change / Check')
		expect(raw).toContain('Cause / Fix / Result')
	})

	it('tells the AI not to wrap the summary in a code fence', () => {
		const raw = read_repo_file(CLAUDE_SETTINGS)

		expect(raw).toContain('never wrapped in a code fence')
	})

	it('tells the AI to name the concrete subject in every overview line', () => {
		const raw = read_repo_file(CLAUDE_SETTINGS)

		expect(raw).toContain('Name the concrete subject in each line')
		expect(raw).toContain('subject-less prose')
	})

	it('drops the old four-axis instruction that reintroduced the technical summary', () => {
		const raw = read_repo_file(CLAUDE_SETTINGS)

		expect(raw).not.toContain('3-6 line work summary')
	})
})
