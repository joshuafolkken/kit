import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_repo_file, read_rule_surface, WORKFLOW_PROMPT } from './ai-document-fixture'

// joshuafolkken/kit#870: the audit only helps if it runs without being asked, and the two rules that
// make it usable — only errors fail, and fixing what it finds is Tier A — are the ones a reword
// loses first. A document that keeps the command but drops either one describes a check nobody runs
// or a gate that fails on legitimate design notes.

const EPICRUN_SKILL = '.claude/skills/workflow-commands/epicrun.md'

function read_unwrapped(relative_path: string): string {
	return read_repo_file(relative_path).replaceAll(/\s+/gu, ' ')
}

// The procedure moved into the `epic-commands` skill (joshuafolkken/kit#873's resident-ceiling
// guard), so these are checked across each document's rule surface — the document plus every
// distributed skill — which is what the routing is supposed to make reachable.
const SURFACE_MARKERS: ReadonlyArray<string> = [
	'`josh epic:audit <E>`',
	'without being asked',
	'Only errors fail it',
	// The ripple check is the half no machine performs, so it has to be written down.
	'confirm some child owns updating it',
]

// The one part that stays in the always-loaded documents: it binds outside the command, whenever an
// audit finding is in front of you.
const RESIDENT_MARKERS: ReadonlyArray<string> = ['fixing what the audit finds is Tier A']

const CANONICAL_MARKERS: ReadonlyArray<string> = [
	'その判定を利用する。検出を作り直さない。',
	'警告は exit code を左右せず、エラーだけが exit 1 になる',
	'判断は読み手に委ね、機械は見落としを防ぐ側に徹する',
	'確認を挟む価値がないので、人に尋ねず修正して根拠を Issue に記録する',
	'更新の担当がいずれかの子 Issue に割り当てられていることを確認する',
]

const AUTOMATIC_RUN_MARKERS: ReadonlyArray<string> = [
	'`josh epic:plan` の相 0',
	'`epicrun` の開始時',
	'子 Issue を追加した直後、依存を変更した直後',
]

describe('epic:audit documentation', () => {
	it.each(AI_DOCS)('is reachable from %s', (document_name) => {
		const surface = read_rule_surface(document_name).replaceAll(/\s+/gu, ' ')

		for (const marker of SURFACE_MARKERS) expect(surface).toContain(marker)
	})

	it.each(AI_DOCS)('keeps the Tier A response resident in %s', (document_name) => {
		const content = read_unwrapped(document_name)

		for (const marker of RESIDENT_MARKERS) expect(content).toContain(marker)
	})

	it.each(AI_DOCS)('routes %s to the skill rather than inlining it', (document_name) => {
		expect(read_repo_file(document_name)).toContain('.claude/skills/epic-commands/SKILL.md')
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
