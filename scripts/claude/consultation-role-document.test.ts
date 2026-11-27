import { read_unwrapped } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'

const PRINCIPLES = 'prompts/collaboration-workflow/principles.md'
const WORKFLOW = '.claude/skills/workflow-commands'
const PRODUCER = '.claude/agents/producer.md'

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

// joshuafolkken/kit#8943: no-filing work defers tests, the gate and the review to the finish.
describe('no-filing finish', () => {
	it.each([
		'テスト・`pnpm josh gate`・コミット前レビューは仕上げに回す',
		'依頼に「テストと gate も」→ その場で実行する',
		'締めで「テストと gate は未実行」と毎回明記する',
		'後回しにした分をすべて実行する',
		'「テスト未作成・gate 未実行」と実装済みの変更ファイルを書く',
		'後回しのテストやその成果物（golden 等）が赤・実行不能 → 仕上げの項目として報告し、その場で直さない',
		'brief の定型部分 → `pnpm josh producer:brief <name>` の出力を使い',
	])('defines the deferral in consult-vs-execute: %s', (requirement) => {
		expect(read_unwrapped(PRINCIPLES)).toContain(requirement)
	})

	// 2026-11-28: the main line opened a `wip/` branch per request, four in one session.
	it.each([
		'起票せずにの依頼は何件でも 1 本の `wip/<name>` に積む',
		'分けるのは利用者が指示したときだけで、主セッションの判断では分けない',
	])('keeps a no-filing session on one work branch: %s', (requirement) => {
		expect(read_unwrapped(PRINCIPLES)).toContain(requirement)
	})

	// 2026-11-28: the main line wrote its own wish to run the tests into a producer brief.
	it.each([
		"unless the brief quotes the user's own request for them now",
		'`pnpm josh producer:brief --tests-now-quote`',
		"the main line's own wish is not one",
	])('lets only the user’s quoted request lift the deferral for the producer: %s', (phrase) => {
		expect(read_unwrapped(PRODUCER)).toContain(phrase)
	})

	it.each([
		PRODUCER,
		'.claude/skills/board-theme/SKILL.md',
		'prompts/collaboration-workflow/report-format.md',
	])('%s defers to the shared no-filing finish', (document) => {
		expect(read_unwrapped(document)).toContain('"consult-vs-execute"')
	})
})
