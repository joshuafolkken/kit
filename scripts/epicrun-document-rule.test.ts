import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_repo_file, WORKFLOW_PROMPT } from './ai-document-fixture'
import { NEEDS_DECISION_LABEL } from './git/issue-labels'

// joshuafolkken/kit#861: `epicrun` is the keyword that lets a run finish without a person watching
// it, and the two rules that make that safe are the ones most easily lost in a reword — parking a
// child instead of stopping the session, and deciding waiting from the classification rather than
// from labels. A document that keeps the keyword but drops either one describes a run that either
// never finishes or stops in the moment it must wait.

const SKILL = '.claude/skills/workflow-commands/epicrun.md'

// Prose is re-wrapped by the formatter, so a marker that happens to span a line break would fail on
// a reflow that changed nothing. Matching against collapsed whitespace pins the words, not the
// column they landed in.
function read_unwrapped(relative_path: string): string {
	return read_repo_file(relative_path).replaceAll(/\s+/gu, ' ')
}

// What each AI document has to say for itself. The rule surface concatenates every distributed
// skill, so a marker checked there passes on the skill's copy alone — which would not detect the
// paragraph being dropped from one document. These are read from the document itself.
const AI_DOC_MARKERS: ReadonlyArray<string> = [
	'`epicrun` parks instead of stopping',
	'never by which labels are present',
	'epicrun.md',
]

// The parts of the definition that are load-bearing, checked in the canonical reference.
const CANONICAL_MARKERS: ReadonlyArray<string> = [
	'repo あたり同時 1 件、repo 間は並行',
	// Without this the next epic inherits "concurrency needs no coordination" and ships a race.
	'同一リポジトリ内の並行を認めた時点で失われる',
	'park はセッション停止の置き換えであって、停止を生んだルールの置き換えではない',
	'park の解除は Tier A',
	'待つべき場面で終了する',
	'停止するのはその子 Issue だけ',
]

// Every timeout has a number, because "wait for a while" is how an unattended run hangs overnight.
const TIMEOUT_MARKERS: ReadonlyArray<string> = ['60 秒', '90 分', '10 分', '8 時間']

// The guards, likewise — matched with their row text, since a bare `30` appears all over the
// document and would keep this green after the whole table was deleted.
const GUARD_MARKERS: ReadonlyArray<string> = [
	'1 ラン内の子の件数 | 30',
	'1 ラン内の自動起票件数 | 10',
	'連続失敗 | 3 回',
]

const SKILL_MARKERS: ReadonlyArray<string> = [
	'park and continue',
	'one child per repository, repositories in parallel',
	'Stopping conditions',
	// The per-repo scoping is the entire reason no locking is implemented.
	'has to introduce real mutual exclusion',
]

describe('epicrun definition', () => {
	it.each(AI_DOCS)('defines the keyword in %s itself, not only in the skill', (document_name) => {
		const content = read_unwrapped(document_name)

		for (const marker of AI_DOC_MARKERS) expect(content).toContain(marker)
	})

	it.each(AI_DOCS)('lists the keyword in the shorthand table of %s', (document_name) => {
		expect(read_unwrapped(document_name)).toContain('| `epicrun #E`')
	})

	it('has a canonical section in the workflow prompt', () => {
		const content = read_unwrapped(WORKFLOW_PROMPT)

		for (const marker of CANONICAL_MARKERS) expect(content).toContain(marker)
	})

	it('pins a number on every wait, so an unattended run cannot hang', () => {
		const content = read_unwrapped(WORKFLOW_PROMPT)

		for (const marker of TIMEOUT_MARKERS) expect(content).toContain(marker)
	})

	it('pins a number on every guard', () => {
		const content = read_unwrapped(WORKFLOW_PROMPT)

		for (const marker of GUARD_MARKERS) expect(content).toContain(marker)
	})

	it('carries the operational procedure in the skill', () => {
		const content = read_unwrapped(SKILL)

		for (const marker of SKILL_MARKERS) expect(content).toContain(marker)
	})

	// The upstream-interrupt rule is where a reader looks when a defect appears mid-run, and it has
	// to say that the stop is now scoped to one child rather than the session.
	it('records the narrowed stop in the upstream-interrupt rule', () => {
		expect(read_unwrapped(WORKFLOW_PROMPT)).toContain(
			'`epicrun` の中では、停止の範囲がセッション全体ではなくその子 Issue に限定される',
		)
	})

	it('names the label the park uses', () => {
		expect(read_repo_file(SKILL)).toContain(NEEDS_DECISION_LABEL)
	})
})
