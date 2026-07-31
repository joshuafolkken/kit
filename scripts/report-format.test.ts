import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const AI_DOCS: ReadonlyArray<string> = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']
const WORKFLOW_PROMPT = 'prompts/collaboration-workflow.md'
const CLAUDE_SETTINGS = '.claude/settings.json'

function read_repo_file(relative_path: string): string {
	return readFileSync(fileURLToPath(new URL(`../${relative_path}`, import.meta.url)), 'utf8')
}

// The report format lives in five places (three AI docs, the workflow prompt, the hook).
// Updating only one of them leaves the AI with contradicting instructions, so assert per marker.
const OVERVIEW_MARKERS: ReadonlyArray<string> = [
	'**■ Overview (plain language — always first)**',
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
			'Never put file paths, function or type names, or CLI option names in the overview',
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

describe('report format — canonical reference in the workflow prompt', () => {
	it('defines the canonical section the AI docs point at', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain('## 報告フォーマット（平易な概要 ＋ 技術詳細）')
	})

	it('constrains the overview to plain vocabulary and a pre-send self-check', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain('概要にファイルパス・関数名・型名・CLI オプション名を書かない')
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

	it('keeps artifacts in English while restructuring the completion body', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain('言語ルールは変えない — 成果物は常に英語')
		for (const marker of COMPLETION_MARKERS) expect(raw).toContain(marker)
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

	it('drops the old four-axis instruction that reintroduced the technical summary', () => {
		const raw = read_repo_file(CLAUDE_SETTINGS)

		expect(raw).not.toContain('3-6 line work summary')
	})
})
