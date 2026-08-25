import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_repo_file, read_rule_surface, WORKFLOW_PROMPT } from './ai-document-fixture'

// An upstream Issue states the defect; the consumer Issue it came from holds the evidence — which
// project, which version pair, what the output looked like. Both directions have to be required,
// because a one-way link leaves a consumer unable to tell what its stashed work is waiting for.
const BACKLINK_MARKERS: ReadonlyArray<string> = [
	'Both ends carry a backlink, under a fixed heading.',
	'`## Origin` section naming the consumer Issue',
	'records every Issue filed from it under `## Upstream issues`',
]

// A bare `#N` resolves inside the upstream repository, so it silently points at a different Issue.
const FORMAT_MARKERS: ReadonlyArray<string> = [
	'Always repo-qualify the reference (`owner/repo#N` or the full URL)',
	'a bare `#N` resolves inside the upstream repo and silently points at a different Issue',
]

// `has_external_task_list_entry` keys on the checkbox, so a backreference written as a task-list
// row disables epic auto-close permanently. The prohibition has to travel with the format.
const TASK_LIST_MARKERS: ReadonlyArray<string> = [
	'never as a task-list row',
	'a checkbox row referencing another repository disables epic auto-close by design',
	'correct for a real cross-repo child and a trap for a backreference',
]

describe('issue backlink — two-way requirement in the AI docs', () => {
	it.each(AI_DOCS)('%s requires a backlink in both directions', (ai_document) => {
		const raw = read_repo_file(ai_document)

		for (const marker of BACKLINK_MARKERS) expect(raw).toContain(marker)
	})

	it.each(AI_DOCS)('%s pins the repo-qualified link format', (ai_document) => {
		const raw = read_repo_file(ai_document)

		for (const marker of FORMAT_MARKERS) expect(raw).toContain(marker)
	})

	it.each(AI_DOCS)('%s states the task-list constraint with the format', (ai_document) => {
		const raw = read_repo_file(ai_document)

		for (const marker of TASK_LIST_MARKERS) expect(raw).toContain(marker)
	})

	it.each(AI_DOCS)('%s carries the requirement into the split path', (ai_document) => {
		const raw = read_rule_surface(ai_document)

		expect(raw).toContain(
			'**When the split is filed into a repository other than the one this session is running in**',
		)
		expect(raw).toContain('never as a checkbox row, which would disable its auto-close')
	})
})

describe('issue backlink — canonical definition in the workflow prompt', () => {
	it('defines the backlink under its own section', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain('### 起票元へのバックリンク（`## Origin` / `## Upstream issues`）')
		expect(raw).toContain('**双方向とも必須**')
	})

	it('fixes both headings and their placement', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain('**見出しは固定する**')
		// Match the row prefixes only: Prettier re-pads table cells whenever an adjacent row
		// changes width, so asserting a full padded row makes the suite fail on reformatting alone.
		expect(raw).toContain('| 上流 Issue → 起票元')
		expect(raw).toContain('| 起票元 Issue → 上流')
		expect(raw).toMatch(/`## Upstream issues` +\| そこから起票した上流 Issue を全件列挙する/u)
	})

	it('bans the bare reference and the checkbox row', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain('**裸の `#N` を使ってはならない**')
		expect(raw).toContain(
			'**チェックボックス行（`- [ ] owner/repo#N`）で書いてはならない。散文か素の箇条書き（`- owner/repo#N`）にする。**',
		)
		expect(raw).toContain('判定はチェックボックスの有無だけを見るので、素の箇条書きは安全である')
	})
})

describe('issue backlink — reach into the template and the two filing paths', () => {
	// The template is what makes the backlink a filled-in field rather than something each author
	// remembers to append, so the section has to exist in the template itself.
	it('accommodates the backlink in the Step 1 body template', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain(
			'## Origin\n\n<別リポジトリのセッションから起票した場合のみ。起票元 Issue を `owner/repo#N` 形式で書く。自リポジトリ発の Issue では節ごと省略する>',
		)
	})

	it('requires the backlink from the interrupt rule and the epic section', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain(
			'**本文に `## Origin` 節を置いて起票元 Issue を `owner/repo#N` 形式で書く**',
		)
		expect(raw).toContain('**分割そのものが別リポジトリのセッション発である場合**')
		expect(raw).toContain('**チェックボックス行で書くと直前の項目に該当して自動クローズが止まる**')
	})
})
