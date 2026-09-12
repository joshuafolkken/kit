import { describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import {
	BODY_READ_API_COMMAND,
	BODY_READ_COMMAND,
	COMMENTED_READ_COMMAND,
	FILING_API_COMMAND,
	FILING_COMMAND,
} from './delivered-rules-fixture'

// The two command classifiers, judged from the command alone. Split off delivered-rules.test.ts in
// joshuafolkken/kit#1884: they read neither the transcript nor the working directory, so they need
// none of that suite's payload machinery, and separating them keeps the delivery suite under the
// 300-line limit that the cwd-isolation fix would otherwise breach.

// Two reads of the same endpoints that create nothing and open no Issue body: each is a non-trigger
// for both rows, and is asserted as one in each row's own block.
const ISSUES_LISTING_COMMAND = 'gh api repos/joshuafolkken/kit/issues --jq length'
const ISSUE_LIST_COMMAND = 'gh issue list --state open --limit 100'
// A test title shared by the two rows' blocks, so a row cannot pass under a title the other does not
// use.
const LEAVES_ALONE = 'leaves %j alone'

// The trigger, judged from the command alone. Both spellings a run reaches for file an Issue; the two
// below them read the same endpoint without creating anything.
describe('is_issue_filing', () => {
	it.each([
		'gh issue create --title "x" --body "y"',
		'gh issue create --repo joshuafolkken/kit -t x',
		FILING_API_COMMAND,
		'gh api repos/{owner}/{repo}/issues -f \'labels[]=epic\' -f title="x"',
	])('reads %j as a filing', (command) => {
		expect(delivered_rules.is_issue_filing(command)).toBe(true)
	})

	// **A comment endpoint is the case that decides whether this hook is worth having.** Comments are
	// far more frequent than filings, and a guard that refused them would fire on the wrong turns —
	// which `CLAUDE.md` treats as worse than no hook at all.
	it.each([
		'gh api repos/joshuafolkken/kit/issues/1524/comments --field body=@/tmp/body.md',
		COMMENTED_READ_COMMAND,
		ISSUES_LISTING_COMMAND,
		ISSUE_LIST_COMMAND,
		'gh pr create --title "x"',
	])(LEAVES_ALONE, (command) => {
		expect(delivered_rules.is_issue_filing(command)).toBe(false)
	})
})

// The second row's trigger, judged from the command alone. **The read that already carries the
// comments is the case that decides whether this row is worth having**: firing on it would refuse
// the very call the rule asks for, and the run would have no move left that satisfies the guard.
describe('is_body_only_issue_read', () => {
	it.each([
		BODY_READ_COMMAND,
		'gh issue view 1319 --repo joshuafolkken/kit',
		'gh issue view https://github.com/joshuafolkken/kit/issues/1319',
		'gh issue view 1319 --json title,body',
		BODY_READ_API_COMMAND,
		'gh api repos/{owner}/{repo}/issues/1319 --jq .body',
		'gh api -X GET repos/joshuafolkken/kit/issues/1319',
		// A `-c` belonging to another command, and a trailing pipe, used to silence the rule for the
		// whole line. **`gh issue view <N> -c` is refused too, and that is the deliberate side of the
		// trade**: `-c` is `wc`'s and `grep`'s far more often than `gh`'s, and a run that used the
		// short flag pays one round trip while every compound line stays guarded.
		'gh issue view 1319 --json body --jq .body | wc -c',
		'gh issue view 1319 && grep -c foo x.ts',
		'gh issue view 1319 -c',
		// Batching puts the read second as often as first, so a segment is judged wherever it sits.
		'pnpm josh gate && gh issue view 1319',
		// Another command's `--json comments` says nothing about whether *this* Issue was read whole.
		'gh pr view 42 --json comments && gh issue view 1319',
	])('reads %j as a body-only read', (command) => {
		expect(delivered_rules.is_body_only_issue_read(command)).toBe(true)
	})

	it.each([
		COMMENTED_READ_COMMAND,
		'gh issue view 1319 --json title,body,comments',
		`gh issue view 1319 && ${COMMENTED_READ_COMMAND}`,
		'gh api repos/joshuafolkken/kit/issues/1319/comments',
		ISSUES_LISTING_COMMAND,
		ISSUE_LIST_COMMAND,
		FILING_COMMAND,
		'gh pr view 1543',
		// **The writes `kickoff` runs against the very same path.** Refusing one would spend the
		// once-per-run delivery on a write and leave the genuine body read unguarded.
		'gh api -X PATCH repos/joshuafolkken/kit/issues/1319 -f title="x"',
		'gh api --method PATCH repos/joshuafolkken/kit/issues/1319 --input /tmp/body.json',
		'gh api repos/joshuafolkken/kit/issues/1319 -f body="plan"',
		// A read quoted inside a write is not a read.
		'gh issue comment 1319 -b "reissue it as gh issue view 1319"',
		// The body and the comments fetched on one line — the shape batching asks for.
		'gh issue view 1319 && gh api repos/joshuafolkken/kit/issues/1319/comments',
	])(LEAVES_ALONE, (command) => {
		expect(delivered_rules.is_body_only_issue_read(command)).toBe(false)
	})
})
