import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_repo_file, WORKFLOW_PROMPT } from './ai-document-fixture'

// joshuafolkken/kit#870: the audit only helps if it runs without being asked, and the two rules that
// make it usable — only errors fail, and fixing what it finds is Tier A — are the ones a reword
// loses first. A document that keeps the command but drops either one describes a check nobody runs
// or a gate that fails on legitimate design notes.

const EPICRUN_SKILL = '.claude/skills/workflow-commands/epicrun.md'

function read_unwrapped(relative_path: string): string {
	return read_repo_file(relative_path).replaceAll(/\s+/gu, ' ')
}

const AI_DOC_MARKERS: ReadonlyArray<string> = [
	'`josh epic:audit <E>`',
	'runs without being asked',
	'Only errors fail it',
	'Fixing what it finds is Tier A',
	// The ripple check is the half no machine performs, so it has to be written down.
	'confirm some child owns updating it',
	'reuses `epic:next`',
]

const CANONICAL_MARKERS: ReadonlyArray<string> = [
	'その判定を利用する。検出を作り直さない。',
	'警告は exit code を左右せず、エラーだけが exit 1 になる',
	'判断は読み手に委ね、機械は見落としを防ぐ側に徹する',
	'確認を挟む価値がないので、人に尋ねず修正して根拠を Issue に記録する',
	'更新の担当がいずれかの子 Issue に割り当てられていることを確認する',
]

const AUTOMATIC_RUN_MARKERS: ReadonlyArray<string> = [
	'`josh epic:plan` の相 1',
	'`epicrun` の開始時',
	'子 Issue を追加した直後、依存を変更した直後',
]

describe('epic:audit documentation', () => {
	it.each(AI_DOCS)('is defined in %s', (document_name) => {
		const content = read_unwrapped(document_name)

		for (const marker of AI_DOC_MARKERS) expect(content).toContain(marker)
	})

	it('has a canonical section in the workflow prompt', () => {
		const content = read_unwrapped(WORKFLOW_PROMPT)

		for (const marker of CANONICAL_MARKERS) expect(content).toContain(marker)
	})

	// Naming the three places is what makes "runs without being asked" actionable rather than a wish.
	it('names every place it runs on its own', () => {
		const content = read_unwrapped(WORKFLOW_PROMPT)

		for (const marker of AUTOMATIC_RUN_MARKERS) expect(content).toContain(marker)
	})

	it('is wired into the unattended run before its first child', () => {
		const content = read_unwrapped(EPICRUN_SKILL)

		expect(content).toContain('pnpm josh epic:audit <E>')
		expect(content).toContain('before step 1')
	})
})
