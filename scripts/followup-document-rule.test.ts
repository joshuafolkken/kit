import { read_index, read_unwrapped } from '#scripts/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// The end of a run — what `pnpm josh followup` waits for, what stops it, how auto-merge is
// authorized and how the completion notification is sent — was written three times: once in English
// in the skill a run actually reads, once as the whole of `completion-notify.md`, and once more as
// two sections of `operating-rules.md`. Three copies of the rules that decide whether a pull request
// merges is the clone `CLAUDE.md` prohibits.
//
// joshuafolkken/kit#1187 single-sources them into the skill (the joshuafolkken/kit#1174 pattern,
// rolled out under joshuafolkken/kit#1176). The topic came in two halves and they took different
// routes. `completion-notify.md` is wholly this topic, so it shrank in place. `operating-rules.md`
// holds eight other rules and is cited for three of them, so joshuafolkken/kit#1186's rule applies:
// a multi-topic file never carries the declaration, because detection and the no-citation rule are
// both per file. What this Issue adds to that precedent is where the extracted section lands — the
// topic it belongs to already had a topic file, and that file was becoming a pointer in the same
// change, so no new file was created. A second pointer for one topic would put two body-less files
// in the index and re-create the duplication the rollout removes, on the pointer side.

const SKILL = '.claude/skills/workflow-commands/followup.md'
const POINTER = 'prompts/collaboration-workflow/completion-notify.md'
// The file the two sections were cut from. It keeps its other rules, and keeps being cited for them.
const OPERATING_RULES = 'prompts/collaboration-workflow/operating-rules.md'
const CLAUDE_DOC = 'CLAUDE.md'
const DEPENDENCY_SKILL = '.claude/skills/dependency-update/SKILL.md'
// The declaration `pointer-citation-document-rule.test.ts` detects a pointer by. Asserted absent
// from `operating-rules.md`: placing it there is exactly the failure the extraction route avoids.
const POINTER_MARKER = 'この規則の単一ソースは'
// Asserted twice each on purpose: present in the single source, absent from the pointer.
const BASIC_EXAMPLE = 'Example 1 — the basic form'
const CI_TIMEOUT_ENV = 'JOSH_CI_TIMEOUT_SECONDS'

// The rule itself, in the single source. Each marker is a part a reword most easily loses, and each
// one is load-bearing at the moment a run decides whether to merge.
const RULE_MARKERS: ReadonlyArray<string> = [
	// Auto-merge is the default and the keyword is the authorization. Lost, a `fullrun` stops to ask.
	'Invoking `fullrun` is itself the explicit authorization to merge',
	'**Always run `pnpm josh ms` after a successful merge.**',
	// What actually stops a merge. `--merge` reads as the switch that starts one, and a document that
	// leaves that unsaid turns "no merge was authorized" into a merged pull request: the workflow
	// resolves merging as `values['no-merge'] !== true`, so omitting every flag merges.
	'**Merging is the default**, and `--merge` is a deprecated no-op',
	'`--no-merge` is the only thing that stops it',
	// The ✅ is sent before the merge is attempted, so it is not proof the merge happened.
	'**It fires before the merge, not after it**',
	// The gate green CI does not open.
	'**Green CI is not authorization to merge while AI review findings are open.**',
	'`Actionable comments posted: N` with N > 0',
	// A read that failed is not a clean scan (joshuafolkken/kit#973).
	'**A comment listing that could not be read is treated exactly like a standing blocker.**',
	// The completion notification has exactly one route, and one way of being run.
	'Never send `completion` Telegram notifications manually',
	'**Always run `pnpm josh followup` in the foreground**',
	'Shell backgrounding never works',
	CI_TIMEOUT_ENV,
	// The temporary arrangement and its revert condition. Without the revert issue the skip reads as
	// the design rather than as something to undo.
	'while CodeRabbit reviews are slow, CodeRabbit is non-blocking end to end',
	'Revert together with kit#752',
]

// What the canonical documents alone used to carry. `SKILL.md` → "Trimming is moving, never
// deleting.": each had to exist in the single source before the canonical text was cut, so they are
// pinned by name rather than left to be noticed missing later.
const FOLDED_IN_MARKERS: ReadonlyArray<string> = [
	// Step 5's position. Without it `followup` reads as a stage of `pnpm josh git`.
	'a **separate script run after `pnpm josh git`**',
	// Which checks are waited on — and that a non-required failure is still reported, which is the
	// one part of the topic that legitimately stayed in `operating-rules.md`.
	'Waits for the CI status checks — the required ones only.',
	'A non-required check that failed is still reported',
	// Where the completion report lands, and the two shapes it takes.
	'edits the Issue body when the body is empty, and adds a comment when it already has content',
	// Silence is failure, not a quiet success.
	'A CI failure or an exception is re-thrown as-is with **no** Telegram sent',
	// The one notification sent by hand, and the trap of sending it per retry.
	'**by hand, exactly once**',
	'--task-type failure',
	// The options table.
	'the workflow puts no completion report on the pull request',
	'Not a bare list of `Added … / Changed …`',
	'--coderabbit-ignore-reason',
	'--ai-review-ignore-reason',
	'or give it positionally as `"<title> #<number>"`',
	// The four worked examples, which is where the `--notify-message` shape is actually read from.
	BASIC_EXAMPLE,
	'Example 4 — no merge (after a `kickoff`, or when the merge is done by hand)',
]

describe(`${SKILL} — the single source states the rule`, () => {
	const content = read_unwrapped(SKILL)

	it.each(RULE_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

describe(`${SKILL} — carries what only the canonical documents had`, () => {
	const content = read_unwrapped(SKILL)

	it.each(FOLDED_IN_MARKERS)('folded in %j', (marker) => {
		expect(content).toContain(marker)
	})

	// The example labelled "no merge" has to carry the flag that makes it one. Without it the block
	// is a working merge command sitting under a heading that says it is not — and the scenario it
	// names, a `kickoff` where no merge was ever authorized, is where that costs the most.
	it('gives the no-merge example the flag that stops the merge', () => {
		expect(content).toContain('Example 4 — no merge')
		expect(content).toContain('#<issue-number>" \\ --no-merge \\')
	})

	// The reason the manual CLI is prohibited rather than merely discouraged. Dropped, the rule reads
	// as a style preference and the next run types the command that loses the PR link.
	it('says why the completion notification is never typed by hand', () => {
		expect(content).toContain('does not auto-populate `--pr-url`')
	})

	// The citation that used to point back at the section in `operating-rules.md` now points at the
	// section that stayed there, so the file is still named for a rule it still holds.
	it('cites the operating rules for the section that stayed there', () => {
		expect(content).toContain('CI チェック失敗時の対応')
		expect(content).not.toContain('operating-rules.md` → "Auto-merge')
	})
})

// The pointer half. The generic size and citation rules are asserted for every converted topic by
// `pointer-citation-document-rule.test.ts`; what is specific here is that the body did not stay
// behind, and that the route this conversion took is recorded.
describe('the canonical topic file is a pointer to the skill single source', () => {
	const pointer = read_unwrapped(POINTER)

	it.each([SKILL, 'クローン禁止・単一ソース化'])(
		'names the skill as the single source: %j',
		(marker) => {
			expect(pointer).toContain(marker)
		},
	)

	// The addition to joshuafolkken/kit#1186's precedent. The next conversion of a shared file reads
	// it here rather than only in the Issue comment.
	it('records why no second topic file was created for the extracted sections', () => {
		expect(pointer).toContain(
			'その話題の指し先が既にあるなら、切り出し先として新しい話題ファイルは要らない',
		)
	})

	// One marker per part of the body the canonical used to carry. The generic size check compares
	// this pointer against the whole skill, so a single section creeping back would stay under it.
	it.each([
		'rate limited by coderabbit.ai',
		'Actionable comments posted',
		CI_TIMEOUT_ENV,
		BASIC_EXAMPLE,
		'--notify-message "Implemented',
	])('does not duplicate the rule body: %j', (marker) => {
		expect(pointer).not.toContain(marker)
	})

	// A back-reference from the single source itself costs no second hop, and it is what tells a
	// reader who landed on the skill that the topic file holds no body.
	it('is named as a pointer by the skill that now holds the body', () => {
		expect(read_unwrapped(SKILL)).toContain(`\`${POINTER}\` is a pointer to it`)
	})

	// The index is the only route to a pointer, so a topic file it does not list is unreachable.
	it('is listed in the index', () => {
		expect(read_index()).toContain('(./collaboration-workflow/completion-notify.md)')
	})
})

// The file the two sections came out of. It holds eight other rules and is cited for three of them,
// so the test that it lost this topic has to be paired with the test that it lost nothing else —
// and with the test that it did not become a pointer, which is what would break those citations.
describe(`${OPERATING_RULES} — keeps its other rules and routes this topic away`, () => {
	const content = read_unwrapped(OPERATING_RULES)

	it.each([
		'### CI チェック失敗時の対応',
		'### 指示されていない行動は取らない',
		'### git index を勝手に変更しない（自律 staging の禁止）',
		'### 確認待ちで停止するときの Telegram 通知（`confirmation`）',
		'### overrides の保護',
		// The one sentence of the auto-merge section that did **not** move. It is about the deny list
		// being an implementation rather than the rule, which belongs to the deny topic this file
		// keeps — `scripts/claude-settings.test.ts` pins it against the canonical prompt for that
		// reason. It moved section, not file.
		'**ただし deny は実装であって規則ではない**',
	])('still carries %j', (marker) => {
		expect(content).toContain(marker)
	})

	it.each([
		'### Auto-merge（default for `fullrun`）',
		'### `completion` 通知は `pnpm josh followup` 経由のみ',
		'CodeRabbit のレート制限はマージを止めない',
		'マージ完了後の `pnpm josh ms` は必須',
		'`pnpm josh notify --task-type completion ...` を手動で実行してはならない',
	])('no longer carries %j', (marker) => {
		expect(content).not.toContain(marker)
	})

	it('points at the skill that now holds the rule', () => {
		expect(content).toContain(SKILL)
	})

	// The whole reason the sections were extracted rather than the file declared. A declaration here
	// would turn the three citations asserted below into violations of the no-citation rule.
	it('is not itself a pointer', () => {
		expect(content).not.toContain(POINTER_MARKER)
	})
})

// joshuafolkken/kit#1178: a citation names the file the body is in. The citations of
// `operating-rules.md` that are about *other* rules keep pointing at it, and only the auto-merge and
// completion-notification ones moved — the distinction the extraction route exists to preserve.
describe('the citations that were not about this topic stay put', () => {
	it.each([CLAUDE_DOC, DEPENDENCY_SKILL])('%s still cites the operating rules', (path) => {
		expect(read_unwrapped(path)).toContain(OPERATING_RULES)
	})

	// Read unwrapped like every assertion here: a negative one read raw passes vacuously the moment
	// the formatter reflows the phrase across a line break.
	it(`${CLAUDE_DOC} keeps naming the sections that stayed`, () => {
		const content = read_unwrapped(CLAUDE_DOC)

		expect(content).toContain('指示されていない行動は取らない')
		expect(content).toContain('git index を勝手に変更しない（自律 staging の禁止）')
	})
})
