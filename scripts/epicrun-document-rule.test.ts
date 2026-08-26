import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_repo_file, WORKFLOW_PROMPT } from './ai-document-fixture'
import { NEEDS_DECISION_LABEL } from './git/issue-labels'

// joshuafolkken/kit#861: `epicrun` is the keyword that lets a run finish without a person watching
// it, and the two rules that make that safe are the ones most easily lost in a reword — parking a
// child instead of stopping the session, and deciding waiting from the classification rather than
// from labels. A document that keeps the keyword but drops either one describes a run that either
// never finishes or stops in the moment it must wait.

const SKILL = '.claude/skills/workflow-commands/epicrun.md'
const QUEUE_SKILL = '.claude/skills/workflow-commands/queue.md'

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

// joshuafolkken/kit#913: a child is run as `fullrun #<N>`, and `fullrun` requires `josh latest`
// before implementing — so following the loop literally runs the dependency update once per child.
// Each run rewrites `pnpm-lock.yaml`, which puts unrelated dependency bumps into every child's PR
// and parks children for CI failures they did not cause. `queue`, the same serial batch, already
// hoists it. These markers pin the hoist, and the one step that deliberately did NOT move with it.
const LATEST_HOIST_SKILL_MARKERS: ReadonlyArray<string> = [
	// Session, not run: sessions are per repository, so "once per run" would leave a second
	// repository's children merging against stale dependencies with no `pnpm audit`.
	'`josh latest` runs once per session, not once per child',
	'**Session, not run**',
	'**`git switch main && git pull` stays per child.**',
	'A resumed `epicrun` is a new session',
	// The hoist does not make the first child's diff clean, and a reader who assumes it does will
	// look for a defect in the child when the bumps show up in its PR.
	'The lock file the update rewrites lands with the first child.',
	// Running it before the first `epic:next` strands a rewritten lock file on the default branch
	// whenever the first answer is not a child number — routine on a resumed run.
	'**Waiting until a child is in hand is what keeps the tree clean.**',
	// `josh latest` on a dirty tree is the case `queue` step 1 stashes for; without the same step
	// here, an unattended run either violates the stash prohibition or has no sanctioned path. The
	// sentence is pinned rather than the bare command, which `git stash pop` would satisfy alone.
	'The stash is the same sanctioned one `queue` step 1 uses',
	// The loop is where the per-child reading came from, so the exception has to be stated there
	// too — a reader following step 2 never reaches the section above it.
	'**except that `josh latest` is not run**',
]

const LATEST_HOIST_CANONICAL_MARKERS: ReadonlyArray<string> = [
	'`josh latest` はセッションごとに 1 回だけ — 子ごとには走らせない',
	'**「ラン」ではなく「セッション」である。**',
	'**子の番号を受け取るまで待つことが、作業ツリーを汚さない条件である。**',
	'**書き換えられた lock ファイルは最初の子と一緒に入る。**',
	'**`git switch main && git pull` は子ごとに残す。**',
	'中断から再開した `epicrun` は、新しいセッションとして扱う',
	// The sanctioned stash has to be readable from the canonical prompt too, since it is the
	// document that authorizes the exception to the staging prohibition.
	'`queue` の手順 1 と同じ、明文化された退避である',
]

describe('epicrun hoists josh latest out of the child loop', () => {
	it('states the rule and its exception in the skill', () => {
		const content = read_unwrapped(SKILL)

		for (const marker of LATEST_HOIST_SKILL_MARKERS) expect(content).toContain(marker)
	})

	it('states the rule in the canonical reference', () => {
		const content = read_unwrapped(WORKFLOW_PROMPT)

		for (const marker of LATEST_HOIST_CANONICAL_MARKERS) expect(content).toContain(marker)
	})

	// The point of the change is that the two entry points to one serial batch stop disagreeing, so
	// both documents have to name the other. A hoist recorded on one side alone is how they drifted.
	// Each reference has to be unique to the new section: a bare `queue` already appears throughout
	// the canonical prompt, so pinning that would stay green after the whole section was deleted.
	it.each([
		[SKILL, 'This is the same rule `queue.md` step 1 already states'],
		[WORKFLOW_PROMPT, 'これは `queue` が既に定めている規則と同一である'],
	])('makes the agreement with queue traceable from %s', (document_name, reference) => {
		expect(read_unwrapped(document_name)).toContain(reference)
	})

	// `queue` is the side that was already correct; if its own hoist is reworded away, `epicrun`
	// points at a rule that no longer exists.
	it('keeps the queue rule the skill defers to', () => {
		expect(read_unwrapped(QUEUE_SKILL)).toContain(
			'`josh latest` runs only once, before the first issue',
		)
	})
})
