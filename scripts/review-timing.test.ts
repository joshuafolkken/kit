import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_repo_file, read_rule_surface, WORKFLOW_PROMPT } from './ai-document-fixture'

// kit#854 moved the workflow procedures into `.claude/skills/workflow-commands/`, so a rule the
// documents now route to lives on the surface — document plus skills — rather than in the document
// alone. Reading the surface is what keeps these suites asserting the rule instead of its address.
const REVIEW_PROMPT = 'prompts/review.md'
const GATE_REVIEW =
	'`/review` skill on `git diff main`, iterating until no high/medium findings remain'

// The review used to be delegated to a fresh-context subagent (#752) and run after the PR existed,
// with its output posted as a PR comment (#758). Both were reverted in #762: the round-trip cost —
// a re-read per round plus a commit, a push, and a full CI re-run per finding — outweighed the
// author-bias protection. The rule that replaces them lives in five files, and landing it in only
// some of them leaves the AI with contradicting instructions, so each marker is asserted per file.
const INLINE_MARKERS: ReadonlyArray<string> = [GATE_REVIEW]

// The retired model, asserted absent. A surviving copy would send an agent back to the post-PR
// review — the exact arrangement #762 removed — while the rest of the file describes the new one.
const RETIRED_MARKERS: ReadonlyArray<string> = [
	'code-reviewer',
	// Bare 'fresh-context' rather than 'fresh-context subagent': the halfrun intro named "the
	// fresh-context review", which the longer marker did not match, so the withdrawn model survived
	// in prose after the section describing the subagent was deleted (#765).
	'fresh-context',
	'the completed PR diff',
	'post the final review markdown as a PR comment',
	// review.md's auto-continue section carried the retired model in its own wording — it said
	// halfrun "runs the same pipeline through PR creation" and keyed fullrun mode off an existing
	// PR. Both survived the first pass of this change because none of the markers above matched.
	'stop with the PR OPEN',
	'through PR creation',
	// `git diff main...HEAD` is deliberately NOT listed: the pre-commit self-review scope and
	// followup's managed-config check both use it legitimately, so it does not distinguish the
	// retired model from the current one.
]

// The #758 halfrun contract, asserted absent in the AI docs. Each phrase claims halfrun reaches a
// step it no longer runs. They are listed separately from RETIRED_MARKERS, which tracks where the
// review runs, so a future change to either model does not have to reason about the other.
const HALFRUN_RETIRED_MARKERS: ReadonlyArray<string> = [
	'Implement + PR',
	'including commit, push, PR creation',
	'while the PR is still OPEN',
	'stop before merge',
]

describe('review timing — AI docs', () => {
	it.each(AI_DOCS)('%s runs the workflow review inside the pre-commit gate', (ai_document) => {
		const raw = read_rule_surface(ai_document)

		for (const marker of INLINE_MARKERS) expect(raw).toContain(marker)
	})

	it.each(AI_DOCS)('%s no longer describes the post-PR subagent review', (ai_document) => {
		const raw = read_rule_surface(ai_document)

		for (const marker of RETIRED_MARKERS) expect(raw).not.toContain(marker)
	})

	// halfrun stopping before the commit is the whole point of the mode: the user inspects the
	// working tree, not an open PR. Leaving it authorized to commit would silently restore #758.
	it.each(AI_DOCS)('%s keeps halfrun short of commit, push and merge', (ai_document) => {
		const raw = read_rule_surface(ai_document)

		expect(raw).toContain('**Invoking `halfrun` is _not_ authorization to commit, push, or merge**')
		expect(raw).not.toContain('Invoking `halfrun` authorizes commit, push, and PR creation')
	})

	// The heading and intro are what an agent reads first when deciding what the keyword
	// authorizes, and #762 reverted the operative bullets without them — leaving each file
	// contradicting itself two lines apart (#765). An agent that trusts the heading commits and
	// opens a PR before the user has verified anything, which is the failure halfrun prevents.
	it.each(AI_DOCS)('%s heads the halfrun section with the pre-commit stop', (ai_document) => {
		const raw = read_rule_surface(ai_document)

		// Asserted without the heading level: kit#854 moved the section into
		// `.claude/skills/workflow-commands/halfrun.md`, where the same title is the file's own `#`
		// heading. What the agent reads first is the wording, not the depth it sits at.
		expect(raw).toContain(
			'`halfrun` — Implement + verify, stop before commit (for manual verification)',
		)
		expect(raw).toContain('**stops before commit**')
		expect(raw).toContain("`halfrun`'s built-in stop before commit is a confirmation pause")
	})

	it.each(AI_DOCS)('%s never describes halfrun as creating a PR', (ai_document) => {
		const raw = read_rule_surface(ai_document)

		for (const marker of HALFRUN_RETIRED_MARKERS) expect(raw).not.toContain(marker)
	})

	// The staging ban enumerates the flows whose commit step may touch the index. halfrun no
	// longer has one, so listing it there would license staging in a flow that never commits.
	it.each(AI_DOCS)('%s drops halfrun from the staging authorization list', (ai_document) => {
		const raw = read_repo_file(ai_document)

		expect(raw).toContain('(`pnpm josh git`, or a `fullrun` / `queue` invocation)')
	})
})

describe('review timing — prompts', () => {
	it('states the inline pre-commit timing in the review checklist', () => {
		const raw = read_repo_file(REVIEW_PROMPT)

		expect(raw).toContain('The implementing session runs it inline, before committing')
		expect(raw).toContain('before `pnpm josh bump minor` and the commit')
		// The auto-continue section states the same timing a second time, in the context the
		// review skill actually runs in; the two halves of the file must not disagree.
		expect(raw).toContain('neither a commit nor a PR exists yet')
		for (const marker of RETIRED_MARKERS) expect(raw).not.toContain(marker)
	})

	it('states the inline pre-commit timing in the canonical Japanese workflow prompt', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain('### レビュー工程は実装セッションがコミット前に実行する')
		expect(raw).toContain('指摘を潰し切ってから最初のコミットを作る')
		expect(raw).toContain('`halfrun` はコミットしないので含まれない')
	})

	// Recording why the previous model was dropped is what stops it from being reintroduced as an
	// improvement later; the accepted trade-off has to travel with it.
	it('records why the post-PR subagent model was withdrawn', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain('kit#752')
		expect(raw).toContain('kit#758')
		expect(raw).toContain(
			'レビュアーが実装者と同一コンテキストである点は、この方式が受け入れているトレードオフである',
		)
	})
})
