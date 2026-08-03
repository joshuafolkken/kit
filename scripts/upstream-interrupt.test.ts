import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_repo_file, WORKFLOW_PROMPT } from './ai-document-fixture'

// A "does this block?" evaluation resolves toward "not blocking" exactly when a workaround is
// most tempting, so the rule has to read as unconditional in every copy that distributes it.
const UNCONDITIONAL_MARKERS: ReadonlyArray<string> = [
	'The procedure is unconditional',
	'no "does this block the current task?" evaluation',
	'Every upstream defect goes through it, blocking or not',
	'the trigger is **discovery**',
]

// Filing is the action the rule already prescribes, so asking for it buys nothing; the stop
// happens afterwards so the user chooses waiting-vs-deferring with the Issue in front of them.
const FILING_MARKERS: ReadonlyArray<string> = [
	'filing is Tier A: never ask for confirmation, neither to file nor to choose the target repository',
	'send a `confirmation` Telegram naming the upstream Issue and what is blocked',
	'the user decides waiting-vs-deferring with it in hand',
]

// #712 shipped a filtered `tsc` reading as a passed completion gate. Disclosure was honest and
// the gate was still weakened, so the gate-level accommodation needs naming next to the code one.
const GATE_MARKERS: ReadonlyArray<string> = [
	'Weakening a verification gate is a workaround too',
	'`lint` / `tsc` / `cspell` / unit / E2E output to accommodate an upstream defect',
	'reporting the filtered result honestly does not make it compliant',
]

const SELF_CORRECTION_MARKERS: ReadonlyArray<string> = [
	'Tier A also covers self-correction.',
	'Fixing a factual error in an artifact you yourself published',
	'Closing a gap in your own work that you identified in the same session',
	'This half carries no workaround risk',
]

const BOUNDARY_MARKERS: ReadonlyArray<string> = [
	'Boundary against "Distinguish consultation from execution":',
	'never acting on a goal statement',
	'Boundary against Tier C (restated):',
	'stay Tier C **even when you caused the problem**',
]

describe('upstream interrupt — unconditional rule in the AI docs', () => {
	it.each(AI_DOCS)('%s removes the blocking evaluation from the procedure', (ai_document) => {
		const raw = read_repo_file(ai_document)

		for (const marker of UNCONDITIONAL_MARKERS) expect(raw).toContain(marker)
	})

	it.each(AI_DOCS)('%s files without asking and stops afterwards', (ai_document) => {
		const raw = read_repo_file(ai_document)

		for (const marker of FILING_MARKERS) expect(raw).toContain(marker)
	})

	it.each(AI_DOCS)('%s counts a weakened verification gate as a workaround', (ai_document) => {
		const raw = read_repo_file(ai_document)

		for (const marker of GATE_MARKERS) expect(raw).toContain(marker)
	})

	it.each(AI_DOCS)('%s drops the wording that only recommended the interrupt', (ai_document) => {
		const raw = read_repo_file(ai_document)

		expect(raw).not.toContain('The recommended default when in doubt is the root-cause interrupt')
		expect(raw).not.toContain(
			"Cross-package problems → interrupt with a new Issue, don't patch locally.",
		)
	})
})

describe('upstream interrupt — self-correction tier in the AI docs', () => {
	it.each(AI_DOCS)('%s names self-correction as Tier A', (ai_document) => {
		const raw = read_repo_file(ai_document)

		for (const marker of SELF_CORRECTION_MARKERS) expect(raw).toContain(marker)
	})

	it.each(AI_DOCS)('%s draws both boundaries around self-correction', (ai_document) => {
		const raw = read_repo_file(ai_document)

		for (const marker of BOUNDARY_MARKERS) expect(raw).toContain(marker)
	})

	it.each(AI_DOCS)('%s keeps the audit trail when the confirmation is removed', (ai_document) => {
		const raw = read_repo_file(ai_document)

		expect(raw).toContain('Log it per "Logging auto-decisions" below')
	})
})

describe('upstream interrupt — canonical section in the workflow prompt', () => {
	it('states the unconditional rule and the discovery trigger', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain('### 無条件ルール: 起票は確認なし、停止は必ず')
		expect(raw).toContain('**トリガーは「発見」であって「ブロックし始めたとき」ではない**')
		expect(raw).toContain('**停止は無条件**')
	})

	// The old caveat framed the interrupt as the default "when in doubt", which reads as a
	// judgement call and reopens the escape hatch the unconditional rule closes.
	it('leaves no wording that presents the interrupt as a judgement call', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain('**即席回避と根本対応は「迷って選ぶもの」ではない**')
		expect(raw).not.toContain(
			'どちらを取るか迷う場合は、**根本対応（割り込み Issue）を既定とする**',
		)
	})

	it('files without a confirmation and stops with a Telegram notification', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain('**対象パッケージのリポジトリに新しい Issue を作成する（確認なし）**')
		expect(raw).toContain('**`confirmation` Telegram を送って停止する**')
	})

	it('bans accommodating an upstream defect by adjusting a verification gate', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain('### 検証ゲートを緩めることも「回避策」である')
		expect(raw).toContain('`lint` / `tsc` / `cspell` / unit / E2E の出力を絞り込む')
		expect(raw).toContain('**調整したくなった時点が、このルールの発火点**')
	})

	it('points the AI docs at the renamed cross-document bullet', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain(
			'CLAUDE.md / AGENTS.md / GEMINI.md「Cross-package problems → file the upstream Issue, then always stop」',
		)
	})
})

describe('upstream interrupt — self-correction tier in the workflow prompt', () => {
	it('adds self-correction to the decision-autonomy policy', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain('**Tier A に含まれる「自己修正」**')
		expect(raw).toContain('**この半分に回避策のリスクはない**')
	})

	it('separates self-correction from consultation and from Tier C', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain('**「相談と実行を区別する」との境界**')
		expect(raw).toContain('**Tier C との境界（再掲）**')
		expect(raw).toContain('**その問題を招いたのが自分自身であっても** Tier C のまま')
	})
})
