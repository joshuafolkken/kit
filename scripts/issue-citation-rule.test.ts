import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#1758: session-facing output that names an Issue by a bare number forces the
// reader to open GitHub to learn what it is about. The rule requires two things on every such
// mention — a markdown link on the number and a short Japanese summary title. The trigger and the
// copyable format stay resident in CLAUDE.md (its trigger, writing an Issue number into the session's
// own prose, fires on turns where no workflow skill has been loaded), while the scope, the exclusion
// and the English-pinned reconciliation live in the topic file it cites — the residency budget keeps
// the always-loaded document small, so the body moves out and only a trigger-plus-pointer stays.
const TOPIC = 'prompts/collaboration-workflow/issue-citation.md'

describe.each(AI_DOCS)('%s — the Issue-citation rule is resident', (document_path) => {
	const content = read_unwrapped(document_path)

	it.each([
		// The copyable format itself is in CLAUDE.md, link on the number.
		'[#<N>](https://github.com/',
		// The mandatory summary tail is pinned too, so the second half of the format cannot be dropped
		// while the marker stays green.
		'— <短い要約>',
		// Both halves are mandatory.
		'Both are required',
		// The Japanese title is a summary, not a full translation.
		'a summary not a full translation',
		// It routes to the topic file that carries the rest of the rule.
		TOPIC,
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

describe(`${TOPIC} — carries the scope, the exclusion and the English-pinned reconciliation`, () => {
	const content = read_unwrapped(TOPIC)

	it.each([
		// The session-facing scope the rule applies to.
		'会話の説明、計画の提示、進捗報告、完了報告',
		// The Japanese title is a summary, not a full translation.
		'全訳ではなく要約でよい',
		// Mentions made before the work is done are in scope, not only after-the-fact reports.
		'対応前の言及も対象である',
		// Out of scope: GitHub artifact prose, where GitHub already links and shows the title.
		'GitHub 上の artifact prose',
		// It does not conflict with the three English-pinned outputs.
		'英語固定の 3 つとは衝突しない',
		// Why the trigger and format are resident in CLAUDE.md.
		'ワークフローのスキルを読んでいないターンでも起こる',
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})
