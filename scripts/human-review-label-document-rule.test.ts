import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
	AI_DOCS,
	read_repo_file,
	read_unwrapped,
	read_unwrapped_rule_surface,
	WORKFLOW_PROMPT,
} from './ai-document-fixture'
import { package_file } from './skill-fixture'

const SCRIPTS_ROOT = 'scripts'
const LABEL_MODULE = 'scripts/git/issue-labels.ts'
const LABEL_LITERAL = "'needs-human-review'"

// joshuafolkken/kit#1125: the label's whole value is in four prohibitions and one distinction, and a
// document that keeps the label and loses any of them is worse than not having it. Lose "commit
// nothing" and the artifact ships; lose "stop the run" and the next child starts on a dirty tree;
// lose "do not stash" and the work a person is meant to look at is hidden; lose "only a person
// applies it" and an unattended run clears its own mark. Lose the `needs-decision` distinction and
// somebody parks the issue instead, which means it is never implemented at all.

const SURFACE_MARKERS: ReadonlyArray<string> = [
	'`needs-human-review`',
	// The degradation itself, and the three things it withholds.
	'degraded to a `halfrun`-shaped stop',
	'Nothing is committed, pushed, opened as a pull request or merged',
	'The working tree is left uncommitted, and nothing is stashed',
	// Inside an `epicrun` this is the one stop that does not become a park.
	'stop the whole run',
	'The remaining children are not started',
	'the one thing that is *not* park-and-continue',
	// The `auto-ok`-strength prohibition. A mark a run can clear for itself is not a mark.
	'Never apply or remove it',
	// The distinction that keeps it from being applied as a park — and the two sets that encode it.
	'It is not `needs-decision`',
	'goes on holding its repository',
	'the resume command',
	// joshuafolkken/kit#1132: the stop must not rest on an agent matching the label string by eye.
	'Read the answer from `pnpm josh issue:state <N>`, never by matching the label string yourself',
	// With no pull request there is no CI E2E job and `followup --merge` is never reached, so the gate
	// closes only if the run executes the suite itself — `halfrun`'s situation exactly.
	'Run `pnpm josh test:e2e` yourself before stopping',
	// The delegated child comes back OPEN without `needs-decision`, which the failure branch would
	// otherwise claim: it strips `in-progress`, releasing the repository the stopped child must keep.
	// Decided from the command's own line rather than by eye — joshuafolkken/kit#1132.
	'**Open, and `human_review: yes`**',
	'Read that line, not the `labels:` one',
	// The check has to happen before implementation; the post-return confirmation is too late.
	'Ask once, before implementing',
	'Leave `in-progress` **on**',
]

const CANONICAL_MARKERS: ReadonlyArray<string> = [
	'成果物を人が見るまで出荷させない',
	'コミット・push・PR 作成・マージのいずれも行わない',
	'作業ツリーは未コミットのまま残す',
	'run 全体を停止する',
	'止まることは失敗ではなく仕様である',
	'AI は付与も削除もしてはならない',
	// The comparison table's decisive row: a parked child releases the checkout, this one must not.
	'リポジトリを保持するか',
	// Why the batch-preserving option was rejected — the reason is the requirement, not a preference.
	'「人が選ぶ」を満たさない',
	// The E2E gate has no pull request to close it here.
	'E2E は自分で `pnpm josh test:e2e` を回して閉じる',
	'判定はコマンドの出力から読む（文字列を目で合わせない）',
]

describe('the human-review label rule reaches the rule surface', () => {
	it.each(SURFACE_MARKERS)('states %s', (marker) => {
		expect(read_unwrapped_rule_surface(AI_DOCS[0] ?? '')).toContain(marker)
	})
})

describe('the canonical reference carries the rule in full', () => {
	it.each(CANONICAL_MARKERS)('states %s', (marker) => {
		expect(read_unwrapped(WORKFLOW_PROMPT)).toContain(marker)
	})
})

// Every production TypeScript file under `scripts/`, so the assertion below covers the tree rather
// than a list somebody has to remember to extend. Test files are excluded deliberately: asserting the
// exact spelling is what `issue-labels.test.ts` is for, and this suite has to name it too.
function script_files(): ReadonlyArray<string> {
	return readdirSync(package_file(SCRIPTS_ROOT), { encoding: 'utf8', recursive: true })
		.filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
		.map((entry) => `${SCRIPTS_ROOT}/${entry}`)
}

describe('the label is single-sourced rather than typed into prose', () => {
	// The name is the contract with GitHub. A document may spell it, but the code must read it from
	// one constant — a second literal is the copy that drifts without anything failing.
	it('defines the name once, in the label module', () => {
		expect(read_repo_file(LABEL_MODULE)).toContain(
			`const NEEDS_HUMAN_REVIEW_LABEL = ${LABEL_LITERAL}`,
		)
	})

	// Named paths would have guarded two files and claimed to guard every one, so the whole script
	// tree is walked. The label module is the one place the literal may appear.
	it('is not typed as a literal anywhere else in the scripts', () => {
		const offenders = script_files()
			.filter((path) => path !== LABEL_MODULE)
			.filter((path) => read_repo_file(path).includes(LABEL_LITERAL))

		expect(offenders).toEqual([])
	})
})
