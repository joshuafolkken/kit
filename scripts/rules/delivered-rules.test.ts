import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { hook_decision } from '#scripts/josh/hook-decision'
import { time_batch_guard } from '#scripts/time/time-batch-guard'
import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { rule_delivery, SWITCH_ENV_KEY } from './rule-guard'

// joshuafolkken/kit#1524: a rule that left residency has to *fire*, or the relocation deleted it. The
// whole point of the Issue is that prose which is never read is indistinguishable from an absent
// rule — so this suite asserts the delivery on the call that binds it, and the silence on every call
// that does not.
const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'rule-guard-'))
const WIP_CAP = 'wip-cap'
const ISSUE_COMMENTS = 'issue-comments'
const NOW_MS = 1_700_000_000_000
// Later than any turn the transcript fixture can carry, so the batching guard's recorded refusal
// covers the whole open sequence whatever wall clock the fixture used — the state where it has
// already spoken and will not speak again.
const BATCH_REFUSED_AT_MS = 9_000_000_000_000
// Far enough past that record to be a different call: the stand-aside treats a *fresh* stamp as the
// batching guard speaking about the call in hand.
const A_LATER_CALL_MS = BATCH_REFUSED_AT_MS + 60_000
// The shortest body-only Issue read, and the `gh api` spelling of the same. Reused wherever a case
// needs the second row's trigger to match.
const BODY_READ_COMMAND = 'gh issue view 1319'
const BODY_READ_API_COMMAND = 'gh api repos/joshuafolkken/kit/issues/1319'
// The read the second row's refusal asks for. It has to pass both rows, or obeying would wedge the
// run — so it serves as a non-trigger fixture for each of them.
const COMMENTED_READ_COMMAND = 'gh issue view 1319 --comments'
// Two reads of the same endpoints that create nothing and open no Issue body: each is a non-trigger
// for **both** rows, and is asserted as one in each row's own block.
const ISSUES_LISTING_COMMAND = 'gh api repos/joshuafolkken/kit/issues --jq length'
const ISSUE_LIST_COMMAND = 'gh issue list --state open --limit 100'
// Test titles shared by the two rows' blocks, so a row cannot pass under a title the other does not
// use.
const LEAVES_ALONE = 'leaves %j alone'
const CARRIES_MARKER = 'carries %j'
const PIPED_VERIFICATION = 'piped-verification'
// The shape joshuafolkken/kit#1556 was filed on: a gate whose failure the pipeline reports as a
// success. Reused wherever a case needs the third row's trigger to match.
const PIPED_GATE_COMMAND = 'pnpm josh gate 2>&1 | tail -40'
const ONCE_PER_RUN = 'delivers once per run rather than once per call'
// The shortest command that really files an Issue, reused wherever a case needs the trigger to match
// so that no case can pass on a spelling the others do not use.
const FILING_COMMAND = 'gh issue create --title "x"'
// The `gh api` spelling of the same filing, used both as a trigger case and as a collision case.
const FILING_API_COMMAND = 'gh api repos/joshuafolkken/kit/issues -f title="x" -f body="y"'
const SHELL_BODY = 'shell-body'
// A comment body carrying the character the shell runs. It is a single-quoted TypeScript literal, so
// the backtick is inert here and dangerous only in the command it describes. The endpoint is a
// comment rather than a filing, so exactly one row claims it.
const EVALUATED_BODY_COMMAND =
	'gh api repos/joshuafolkken/kit/issues/1198/comments -f body="see `pnpm josh ms`"'
const WRITTEN_TRANSCRIPTS = new Set<string>()
const { open_turn_lines, target_turn_lines } = time_transcript_fixture

// The trigger reads the call, never the history, so an empty transcript is the honest fixture for
// every case but the collision one: it proves the decision came from the command rather than from
// anything behind it.
function transcript_for(name: string, text = ''): string {
	const target = path.join(WORK_DIRECTORY, `${name}.jsonl`)

	writeFileSync(target, text)
	WRITTEN_TRANSCRIPTS.add(target)

	return target
}

// Three consecutive single-call turns with the third still open — the one shape `batch:guard`
// refuses, and therefore the one shape this guard has to stay quiet on.
function unbatched_text(): string {
	return [
		...target_turn_lines(0, ['a.ts']),
		...target_turn_lines(1, ['b.ts']),
		...open_turn_lines(2, ['c.ts']),
	].join('\n')
}

// **Only one refusal can leave a `PreToolUse` hook**, so a call two rows both claim would deliver
// whichever comes first and silently drop the other. The enumeration stays safe only while no two
// triggers match the same command — asserted over every row against every other row's fixtures, so a
// third row is checked without anyone remembering to add a case.
function rules_claiming(command: string): number {
	return delivered_rules.DELIVERED_RULES.filter((rule) =>
		rule.is_trigger({ name: 'Bash', input: { command } }),
	).length
}

function payload_for(transcript: string, command: string, tool_name = 'Bash'): string {
	return JSON.stringify({
		hook_event_name: 'PreToolUse',
		transcript_path: transcript,
		tool_name,
		tool_input: { command },
	})
}

// `history` is the transcript behind the call. It is empty for every case but the collision ones,
// which is the honest fixture: the trigger reads the call and never the history.
function payload_of(name: string, command: string, tool_name = 'Bash', history = ''): string {
	return payload_for(transcript_for(name, history), command, tool_name)
}

// The batching guard's own record, written the way that guard writes it — so a case can put a run
// into the state where `batch:guard` has already spoken and will not speak again.
const BATCH_STAMP = hook_decision.create_refusal_stamp(time_batch_guard.STAMP_PREFIX)

// Assigned rather than deleted, for the reason `batch-guard.test.ts` gives: an empty value is not one
// the disabled list recognizes, so the guard reads as on exactly as it does on a fresh machine.
beforeEach(() => {
	process.env[SWITCH_ENV_KEY] = ''
})

// **Every id, not just the first.** A stamp left behind silences the next case exactly as it
// silences the next call, so the cleanup is driven off the enumeration rather than off a literal —
// a row added without a matching line here would leak its records into the following run.
afterAll(() => {
	for (const transcript of WRITTEN_TRANSCRIPTS) {
		for (const rule of delivered_rules.DELIVERED_RULES) {
			rmSync(delivered_rules.delivery_path(rule.id, transcript), { force: true })
		}

		rmSync(BATCH_STAMP.path(transcript), { force: true })
	}

	rmSync(WORK_DIRECTORY, { recursive: true, force: true })
})

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

describe('rule_delivery — the comments at the call that reads the body', () => {
	it.each([
		['view', BODY_READ_COMMAND],
		['api', BODY_READ_API_COMMAND],
	])('delivers the rule on the %s spelling', (name, command) => {
		const reason = rule_delivery(payload_of(`body-${name}`, command), NOW_MS)

		expect(reason).toBe(delivered_rules.ISSUE_COMMENTS_REASON)
	})

	// Each half, because dropping any one changes what a run does: without the reissue command the
	// comments are required rather than present, and without the conflict rule the deciding goes back
	// to judgement at the moment nothing else is open to read — joshuafolkken/kit#1518's failure.
	it.each([
		'read them before implementing, not only the body',
		'gh issue view <N> --comments',
		'gh api repos/{owner}/{repo}/issues/<N>/comments',
		'the later text is the agreement in force',
		'a comment supersedes the body it contradicts',
		'reassigns to another Issue is out of scope',
		'`confirmation` Telegram',
		'`.claude/skills/workflow-commands/SKILL.md`',
	])(CARRIES_MARKER, (marker) => {
		expect(delivered_rules.ISSUE_COMMENTS_REASON).toContain(marker)
	})

	it(ONCE_PER_RUN, () => {
		const payload = payload_of('body-repeat', BODY_READ_COMMAND)

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.ISSUE_COMMENTS_REASON)
		expect(rule_delivery(payload, NOW_MS + 1)).toBeUndefined()
	})

	// The read the refusal asks for must itself pass, or obeying the rule would wedge the run.
	it('says nothing about the read it asked the run to make', () => {
		const payload = payload_of('body-obeyed', COMMENTED_READ_COMMAND)

		expect(rule_delivery(payload, NOW_MS)).toBeUndefined()
	})
})

describe('rule_delivery — the WIP cap at the call that files', () => {
	it('delivers the rule on the call that creates an Issue', () => {
		const reason = rule_delivery(payload_of('filing', FILING_COMMAND), NOW_MS)

		expect(reason).toBe(delivered_rules.WIP_CAP_REASON)
	})

	// Each half of the rule, because dropping any one of them changes what an agent does: without the
	// count there is nothing to compare, without the refusal the cap is advisory, and without the three
	// tests the interrupt exemption is decided by judgement — the failure joshuafolkken/kit#1518 named.
	it.each([
		"count the target repository's open Issues",
		'With more than 30 open, close one first',
		'nothing honestly closable means do not file',
		'one the run is blocked by',
		'a verification answers wrongly',
		'a documented workflow cannot complete',
		'data is lost or written outside the repository',
		'`prompts/collaboration-workflow/wip-cap.md`',
	])(CARRIES_MARKER, (marker) => {
		expect(delivered_rules.WIP_CAP_REASON).toContain(marker)
	})

	// A delivery that repeated would wedge the very call it asked for, so the reason has to say that
	// reissuing is the expected next move.
	it('tells the reader the call may be reissued', () => {
		expect(delivered_rules.WIP_CAP_REASON).toContain('Reissue this call once you have counted')
	})

	it(ONCE_PER_RUN, () => {
		const payload = payload_of('repeat', FILING_COMMAND)

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.WIP_CAP_REASON)
		expect(rule_delivery(payload, NOW_MS + 1)).toBeUndefined()
	})
})

describe('rule_delivery — the masked verification at the call that pipes it', () => {
	it('delivers the rule on the call that pipes a check', () => {
		const reason = rule_delivery(payload_of('piped', PIPED_GATE_COMMAND), NOW_MS)

		expect(reason).toBe(delivered_rules.PIPED_VERIFICATION_REASON)
	})

	it(ONCE_PER_RUN, () => {
		const payload = payload_of('piped-repeat', PIPED_GATE_COMMAND)

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.PIPED_VERIFICATION_REASON)
		expect(rule_delivery(payload, NOW_MS + 1)).toBeUndefined()
	})

	// The invariant `is_first_delivery` depends on, re-checked for this row as the enumeration's own
	// comment requires: a trigger the batching guard also considers would put the silent collision back.
	it('is not a call the batching guard may also refuse', () => {
		const call = { name: 'Bash', input: { command: PIPED_GATE_COMMAND } }

		expect(time_batch_guard.is_guarded_call(call)).toBe(false)
	})
})

// What happens on a turn where the trigger does not fire: nothing at all reaches stdout, which is the
// same answer the other two guards give. A hook that spoke on these calls would cost every run.
describe('rule_delivery — silent where nothing binds', () => {
	it.each([
		['a comment', 'gh api repos/joshuafolkken/kit/issues/1524/comments --field body=@/tmp/b.md'],
		['an ordinary command', 'pnpm josh gate'],
		['a listing', 'gh issue list --state open'],
	])('says nothing on %s', (label, command) => {
		expect(rule_delivery(payload_of(`quiet-${label}`, command), NOW_MS)).toBeUndefined()
	})

	// **Never wired to a write, and never answering about one** (joshuafolkken/kit#1390): Claude Code
	// denies one call of a turn and runs the rest, so a refused `Edit` leaves its siblings applied.
	it('says nothing about a write tool even when its input looks like a filing', () => {
		const payload = payload_of('write', FILING_COMMAND, 'Edit')

		expect(rule_delivery(payload, NOW_MS)).toBeUndefined()
	})

	it('says nothing when the switch is off', () => {
		process.env[SWITCH_ENV_KEY] = 'off'

		expect(rule_delivery(payload_of('off', 'gh issue create -t x'), NOW_MS)).toBeUndefined()
	})

	it('says nothing when the payload is not a payload', () => {
		expect(rule_delivery('not json', NOW_MS)).toBeUndefined()
	})

	it('says nothing when the payload names no command at all', () => {
		expect(rule_delivery(payload_of('empty', ''), NOW_MS)).toBeUndefined()
	})
})

// **The collision that would delete a rule silently, and the invariant that prevents it.**
// `pnpm josh batch:guard` is wired to `Bash` too, and the shared shell records its stamp *before*
// returning a reason — so a call both hooks refused would lose one of the two reasons with both
// records already written, and the losing rule could never fire again in that run. It cannot happen
// for `wip-cap` because the batching guard does not treat a filing call as a candidate at all. **It
// does treat an Issue read as one**, so `issue-comments` is the row that makes the stand-aside in
// `is_first_delivery` load-bearing rather than inert — the table below pins both halves, and **any
// row added to the enumeration has to be re-checked against it**.
describe('rule_delivery — the two Bash guards never answer about the same call', () => {
	it.each([
		[FILING_COMMAND, false],
		[FILING_API_COMMAND, false],
		[BODY_READ_COMMAND, true],
		[BODY_READ_API_COMMAND, true],
	])('%j as a call the batching guard may also refuse: %s', (command, is_candidate) => {
		expect(time_batch_guard.is_guarded_call({ name: 'Bash', input: { command } })).toBe(
			is_candidate,
		)
	})

	// **The stand-aside, exercised end to end.** On the one history `batch:guard` refuses, the body
	// read is left to that guard: nothing is delivered and — because the shared shell stamps only
	// after `should_block` answers true — nothing is recorded, so the rule still fires on the reissue.
	// A row that delivered here would spend its once-per-run budget on a call that never ran.
	// **The recovery is asserted on the same transcript, not a fresh one.** A reissue happens inside
	// the same run with the same tail behind it, so a case that stood aside on one transcript and then
	// delivered on an empty one would prove nothing about the run that stood aside — and would stay
	// green while the rule was lost for good.
	it('stands aside while the batching guard may speak, and delivers once it has', () => {
		const transcript = transcript_for('body-collision', unbatched_text())
		const call = payload_for(transcript, BODY_READ_COMMAND)

		expect(rule_delivery(call, NOW_MS)).toBeUndefined()

		BATCH_STAMP.record(BATCH_STAMP.path(transcript), BATCH_REFUSED_AT_MS)

		expect(rule_delivery(call, A_LATER_CALL_MS)).toBe(delivered_rules.ISSUE_COMMENTS_REASON)
	})

	// **The order of the two hooks is not defined, and the answer must not depend on it.** Both are
	// separate processes started for the same event, and the shared shell stamps before it returns a
	// reason — so a run where `batch:guard` happened to write first would otherwise see a record, read
	// it as "already spoken", and deliver on the same call the other hook is refusing. Both records
	// would then be spent for one surfaced reason, and this rule could never fire again in that run.
	it('stands aside when the batching guard has just recorded a refusal about this call', () => {
		const transcript = transcript_for('body-race', unbatched_text())
		const call = payload_for(transcript, BODY_READ_COMMAND)

		BATCH_STAMP.record(BATCH_STAMP.path(transcript), BATCH_REFUSED_AT_MS)

		expect(rule_delivery(call, BATCH_REFUSED_AT_MS)).toBeUndefined()
	})

	// **The stand-aside cannot be exercised end to end through this rule, and that is the invariant
	// above restated.** A run whose history is the shape the batching guard refuses still gets the
	// delivery here, because the second half of that guard's own test — is this call one it may refuse
	// at all — is false for every filing call. So the assertion is the delivery *happening* on that
	// history: a fixture that stood aside would mean the invariant had broken.
	it('still delivers on a history the batching guard would otherwise refuse', () => {
		const payload = payload_of('collision', FILING_COMMAND, 'Bash', unbatched_text())

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.WIP_CAP_REASON)
	})
})

// The enumeration is the mechanism: one row per relocated rule, and the next rule to leave residency
// costs a row rather than a second delivery path. The reading of the call itself is
// `shell-body-trigger.test.ts`; what is pinned here is the row wired to it.
describe('rule_delivery — the shell-body rule at the call that would execute text', () => {
	it('delivers the rule on a comment whose body carries a backtick', () => {
		const reason = rule_delivery(payload_of('evaluated', EVALUATED_BODY_COMMAND), NOW_MS)

		expect(reason).toBe(delivered_rules.SHELL_BODY_REASON)
	})

	// What the reason *says* is pinned by `scripts/shell-body-rule.test.ts`, which the marker-test
	// table in `shell-body.md` makes the owner of the delivery text. Restating those markers here
	// would be the clone `CLAUDE.md` prohibits. This block owns firing and silence.
	it(ONCE_PER_RUN, () => {
		const payload = payload_of('shell-body-repeat', EVALUATED_BODY_COMMAND)

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.SHELL_BODY_REASON)
		expect(rule_delivery(payload, NOW_MS + 1)).toBeUndefined()
	})

	// **Never wired to a write** (joshuafolkken/kit#1390), the same omission every row depends on.
	it('says nothing about a write tool even when its input looks like an inline body', () => {
		const payload = payload_of('body-write', EVALUATED_BODY_COMMAND, 'Edit')

		expect(rule_delivery(payload, NOW_MS)).toBeUndefined()
	})
})

describe('DELIVERED_RULES — the enumeration', () => {
	it('keys every rule uniquely, so one delivery never spends another rule budget', () => {
		const ids = delivered_rules.DELIVERED_RULES.map((rule) => rule.id)

		expect(new Set(ids).size).toBe(ids.length)
	})

	it.each([WIP_CAP, ISSUE_COMMENTS, SHELL_BODY, PIPED_VERIFICATION])('names %j', (id) => {
		expect(delivered_rules.DELIVERED_RULES.map((rule) => rule.id)).toContain(id)
	})

	it.each([
		FILING_COMMAND,
		FILING_API_COMMAND,
		BODY_READ_COMMAND,
		BODY_READ_API_COMMAND,
		EVALUATED_BODY_COMMAND,
		PIPED_GATE_COMMAND,
	])('is claimed by exactly one rule: %j', (command) => {
		expect(rules_claiming(command)).toBe(1)
	})

	// **The one overlap the enumeration allows, and the order that makes it safe**
	// (joshuafolkken/kit#1198). A filing whose body happens to carry a backtick is claimed by both
	// `wip-cap` and `shell-body`; `wip-cap` is listed first because it decides whether the Issue
	// should exist at all. Nothing is lost by losing the race — the stamps are keyed per `id`, so the
	// reissued call is delivered the second rule, which is asserted here rather than assumed.
	it('delivers the second rule on the reissue when a filing also carries an evaluated body', () => {
		const command = 'gh api repos/o/r/issues -f title="x" -f body="see `pnpm josh ms`"'
		const payload = payload_of('overlap', command)

		expect(rules_claiming(command)).toBe(2)
		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.WIP_CAP_REASON)
		expect(rule_delivery(payload, NOW_MS + 1)).toBe(delivered_rules.SHELL_BODY_REASON)
	})

	it('is on by default', () => {
		expect(delivered_rules.is_enabled()).toBe(true)
	})
})
