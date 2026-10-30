import { read_unwrapped } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'

const PRINCIPLES = 'prompts/collaboration-workflow/principles.md'
const WORKFLOW = '.claude/skills/workflow-commands'

describe('consultation main-session responsibilities', () => {
	it.each([
		'相談の主セッションは相談・起票・運用を担当する',
		'主セッション自身で実装を開始しない',
		'「起票して」は起票を実行',
		'「対応してください」は合意した起票・Issue 更新・レーン操作',
		'既存の実装レーンへ引き渡す',
		'主セッションが実装する根拠には読み替えない',
		'`kickoff` は起票・計画で停止',
		'実装レーン内の Tier A 判断は再確認せず進める',
	])('defines the role boundary: %s', (requirement) => {
		expect(read_unwrapped(PRINCIPLES)).toContain(requirement)
	})

	it.each(['CLAUDE.md', `${WORKFLOW}/SKILL.md`, 'docs/how-to/run-issues.md'])(
		'%s routes to the shared role boundary',
		(document) => {
			expect(read_unwrapped(document)).toContain('consult-vs-execute')
		},
	)

	it('keeps legacy implementation handoff from authorizing consultation edits', () => {
		const text = read_unwrapped('prompts/collaboration-workflow/operating-rules.md')

		expect(text).not.toContain('会話で作った実装')
		expect(text).toContain('担当範囲は `principles.md` → "consult-vs-execute"')
	})

	it('preserves the kickoff stop and its read-only working tree', () => {
		const text = read_unwrapped(`${WORKFLOW}/kickoff.md`)

		expect(text).toContain('**stop** (do not implement)')
		expect(text).toContain('it touches GitHub, never the tree')
	})
})
