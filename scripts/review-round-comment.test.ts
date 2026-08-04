import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_repo_file, WORKFLOW_PROMPT } from './ai-document-fixture'

const REVIEW_PROMPT = 'prompts/review.md'
const ROUND_HEADING = '`## Code review — round N`'
const RETIRED_SINGLE_COMMENT = 'one authoritative comment per review cycle'
const POSTING_TIMING =
	"immediately after that round's review returns and **before** its findings are fixed"

// Posting only the settled round collapsed the whole review loop into one timestamp — the last
// one — and threw away the findings that drove each fix commit. The rule that replaces it lives
// in five files, and landing it in only some of them leaves the AI with contradicting
// instructions, so each marker is asserted per document.
const PER_ROUND_MARKERS: ReadonlyArray<string> = [
	'Post every review round as its own PR comment',
	// The timing is the point: a comment written after the fixes cannot show what drove them.
	POSTING_TIMING,
	ROUND_HEADING,
	// Without this a round is free to shrink to "same as last time plus one finding".
	'never a delta against the previous round',
	// Both are acceptance criteria in #760: without the first, no comment declares itself the
	// authoritative one; without the second, a re-review silently restarts the numbering.
	'the final round states that the loop settled with zero high/medium findings',
	'numbered from 1 and continuing across a re-review after later commits',
	// A round number recalled from memory is wrong the moment a session resumes.
	'Determine `N` by counting the `## Code review — round` comments already on the PR',
]

// The prose section states the rule, but the decision table and the turn-end self-check are what
// an agent is told to map mechanically under chain-rule pressure — and the High/Medium branch is
// exactly when the rule fires. A rule present only in the prose is a rule that gets skipped.
const OPERATIONAL_MARKERS: ReadonlyArray<string> = [
	`**Post this round's full review markdown as a ${ROUND_HEADING} PR comment first**`,
	"post this round's review comment first",
	"Post this round's review markdown as a PR comment, then immediately run",
]

// The retired wording, asserted absent: a leftover copy would read as an instruction to suppress
// the very rounds the new rule requires.
const RETIRED_MARKERS: ReadonlyArray<string> = [
	RETIRED_SINGLE_COMMENT,
	'intermediate high/medium rounds are not posted',
	'post the final review markdown as a PR comment',
]

describe('per-round review comments — AI docs', () => {
	it.each(AI_DOCS)('%s requires one PR comment per review round', (ai_document) => {
		const raw = read_repo_file(ai_document)

		for (const marker of PER_ROUND_MARKERS) expect(raw).toContain(marker)
	})

	it.each(AI_DOCS)('%s no longer suppresses the intermediate rounds', (ai_document) => {
		const raw = read_repo_file(ai_document)

		for (const marker of RETIRED_MARKERS) expect(raw).not.toContain(marker)
	})

	// Posting a round that still carries high/medium findings is only safe because the blocker
	// scan keys on authorship, so the two rules have to travel together.
	it.each(AI_DOCS)('%s keeps the blocker-scan exemption alongside the rule', (ai_document) => {
		const raw = read_repo_file(ai_document)

		expect(raw).toContain('never treats them as blockers')
	})

	it.each(AI_DOCS)('%s posts each round from the halfrun review loop too', (ai_document) => {
		const raw = read_repo_file(ai_document)

		expect(raw).toContain(
			"posting each round's review markdown as its own PR comment as that round completes",
		)
	})

	it.each(AI_DOCS)('%s carries the posting step in the operational path', (ai_document) => {
		const raw = read_repo_file(ai_document)

		for (const marker of OPERATIONAL_MARKERS) expect(raw).toContain(marker)
	})
})

describe('per-round review comments — prompts', () => {
	it('states the rule in the review checklist', () => {
		const raw = read_repo_file(REVIEW_PROMPT)

		expect(raw).toContain('posts **every round** as its own PR comment')
		expect(raw).toContain(ROUND_HEADING)
		// The single source of truth for the checklist gets the strongest assertion, not the
		// weakest: the timing clause is the load-bearing half of the rule.
		expect(raw).toContain(POSTING_TIMING)
		expect(raw).toContain('never from memory')
		expect(raw).not.toContain(RETIRED_SINGLE_COMMENT)
	})

	it('states the rule in the canonical Japanese workflow prompt', () => {
		const raw = read_repo_file(WORKFLOW_PROMPT)

		expect(raw).toContain(
			'レビューは 1 ラウンド終わるたびに、その全文を独立した PR コメントとして投稿する',
		)
		expect(raw).toContain(ROUND_HEADING)
		expect(raw).toContain('件数を数えて 1 を足して決める')
		for (const marker of OPERATIONAL_MARKERS) expect(raw).toContain(marker)
		expect(raw).not.toContain('High/Medium の途中ラウンドは投稿しない')
	})
})
