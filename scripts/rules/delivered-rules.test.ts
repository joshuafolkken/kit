import { mkdirSync, realpathSync, rmSync } from 'node:fs'
import path from 'node:path'
import { hook_decision } from '#scripts/josh/hook-decision'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_paths } from '#scripts/lane/lane-paths'
import { time_batch_guard } from '#scripts/time-runtime/time-batch-guard'
import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import {
	BODY_JQ_COMMAND,
	BODY_READ_API_COMMAND,
	BODY_READ_COMMAND,
	COMMENTED_READ_COMMAND,
	FILING_API_COMMAND,
	FILING_COMMAND,
	scouted_tail,
	STATE_CHECK_COMMAND,
} from './delivered-rules-fixture'
import { delivered_rules_harness } from './delivered-rules-harness'
import { rule_delivery, SWITCH_ENV_KEY } from './rule-guard'

// joshuafolkken/kit#1524: a rule that left residency has to *fire*, or the relocation deleted it. The
// whole point of the Issue is that prose which is never read is indistinguishable from an absent
// rule — so this suite asserts the delivery on the call that binds it, and the silence on every call
// that does not.
const harness = delivered_rules_harness.create_harness()
const { payload_for, payload_of, transcript_for } = harness
const WORK_DIRECTORY = harness.work
// The directory vitest was launched from, restored before WORK_DIRECTORY is removed. The suite pins its
// working directory to the non-lane WORK_DIRECTORY per test to stay hermetic wherever it was launched: rule_delivery
// and rules_claiming invoke each rule's real trigger, and the pre-gate-cut trigger reads the live
// process.cwd() to decide whether a checkout is a lane, so a run started inside a lane worktree would
// otherwise see the gate cases fire that rule and the silence assertions break (joshuafolkken/kit#1884).
const ENTRY_DIRECTORY = process.cwd()
// A lane checkout under WORK_DIRECTORY, for the one block that runs as a dispatched lane child
// (joshuafolkken/kit#2138). Every other block stays in the non-lane WORK_DIRECTORY.
const LANE_ROOT = path.join(WORK_DIRECTORY, '.kit-lanes')
const LANE_ISSUE = '2138'
const LANE_DIRECTORY = path.join(LANE_ROOT, LANE_ISSUE)
const WIP_CAP = 'wip-cap'
const ISSUE_COMMENTS = 'issue-comments'
const ISSUE_SCOUT = 'issue-scout'
const FILING_CAP_ID = 'filing-cap'
// A filing is claimed by five filing rows — the WIP cap, the scout gate, the per-run cap, the fold
// gate (joshuafolkken/kit#2119, joshuafolkken/kit#2213) and the `issue:lint` oracle-consulted row
// (joshuafolkken/kit#2324); a filing whose body also carries a backtick adds `shell-body`.
const FILING_RULE_COUNT = 5
const FILING_WITH_BODY_RULE_COUNT = 6
const NOW_MS = 1_700_000_000_000
// Later than any turn the transcript fixture can carry, so the batching guard's recorded refusal
// covers the whole open sequence whatever wall clock the fixture used — the state where it has
// already spoken and will not speak again.
const BATCH_REFUSED_AT_MS = 9_000_000_000_000
// Far enough past that record to be a different call: the stand-aside treats a *fresh* stamp as the
// batching guard speaking about the call in hand.
const A_LATER_CALL_MS = BATCH_REFUSED_AT_MS + 60_000
// A test title shared by the delivery blocks' reason-marker assertions, so a row cannot pass under a
// title another does not use.
const CARRIES_MARKER = 'carries %j'
const PIPED_VERIFICATION = 'piped-verification'
// The shape joshuafolkken/kit#1556 was filed on: a gate whose failure the pipeline reports as a
// success. Reused wherever a case needs the third row's trigger to match.
const PIPED_GATE_COMMAND = 'pnpm josh gate 2>&1 | tail -40'
const ONCE_PER_RUN = 'delivers once per run rather than once per call'
const RUN_TAIL = 'run-tail'
// The commit-push-PR step as a run issues it, reused wherever a case needs the sixth row's trigger to
// match so that no case can pass on a spelling the others do not use.
const FOREGROUND_PUSH_COMMAND = 'pnpm josh git -y "Stop a run tail idling #1510"'
const SHELL_BODY = 'shell-body'
// A comment body carrying the character the shell runs. It is a single-quoted TypeScript literal, so
// the backtick is inert here and dangerous only in the command it describes. The endpoint is a
// comment rather than a filing, so exactly one row claims it.
const EVALUATED_BODY_COMMAND =
	'gh api repos/joshuafolkken/kit/issues/1198/comments -f body="see `pnpm josh ms`"'
const { BRANCH, josh_call_line, open_turn_lines, target_turn_lines } = time_transcript_fixture

// Three consecutive single-call turns with the third still open — the one shape `batch:guard`
// refuses, and therefore the one shape this guard has to stay quiet on.
function unbatched_text(): string {
	return [
		...target_turn_lines(0, ['a.ts']),
		...target_turn_lines(1, ['b.ts']),
		...open_turn_lines(2, ['c.ts']),
	].join('\n')
}

// A transcript tail whose one Bash call opened an Issue with `pnpm josh issue:read`, which prints its
// body and every comment — so the run has read the comments before any later body read of that Issue
// (joshuafolkken/kit#1905).
function comment_read_tail(issue: number): string {
	const command = `pnpm josh issue:read ${String(issue)}`

	return time_transcript_fixture.josh_call_line(1, time_transcript_fixture.BRANCH, command)
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

// The batching guard's own record, written the way that guard writes it — so a case can put a run
// into the state where `batch:guard` has already spoken and will not speak again.
const BATCH_STAMP = hook_decision.create_refusal_stamp(time_batch_guard.STAMP_PREFIX)

// Assigned rather than deleted, for the reason `batch-guard.test.ts` gives: an empty value is not one
// the disabled list recognizes, so the guard reads as on exactly as it does on a fresh machine.
beforeEach(() => {
	process.env[SWITCH_ENV_KEY] = ''
	// The lane-child block sets `JOSH_LANE_CHILD`; clearing it here, beside the cwd reset, keeps it from
	// leaking into any case that runs after — the same reset-before-every-case discipline as the cwd.
	Reflect.deleteProperty(process.env, lane_child_marker.KEY)
	process.chdir(WORK_DIRECTORY)
})

// **Every id, not just the first.** A stamp left behind silences the next case exactly as it
// silences the next call, so the cleanup is driven off the enumeration rather than off a literal —
// a row added without a matching line here would leak its records into the following run.
afterAll(() => {
	process.chdir(ENTRY_DIRECTORY)

	for (const transcript of harness.written) rmSync(BATCH_STAMP.path(transcript), { force: true })

	harness.cleanup()
})

describe('cwd isolation', () => {
	// **The suite pins its own working directory** (joshuafolkken/kit#1884). Removing the beforeEach
	// chdir leaves cwd at wherever vitest was launched, so this fails everywhere; launched from a lane
	// worktree it would additionally read as a lane and fire the pre-gate-cut refusal on every gate
	// case below.
	it('runs the silence assertions from the non-lane work directory', () => {
		// realpathSync so the assertion holds on macOS, where process.cwd() resolves the /tmp symlink
		// to /private/tmp while WORK_DIRECTORY keeps the tmpdir() spelling.
		expect(process.cwd()).toBe(realpathSync(WORK_DIRECTORY))
		expect(lane_paths.lane_issue_of(process.cwd())).toBeUndefined()
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

// The two stand-downs added in joshuafolkken/kit#1905: a state-only projection is not a body read,
// and a body read the run has already earned by reading the comments is not refused a second time.
describe('rule_delivery — the comments rule stands down when it should', () => {
	// **A `--jq`/`--json` projection that never names the body is a state check, not the body read this
	// rule guards** (joshuafolkken/kit#1905) — while one that still names the body stays a body read.
	it('says nothing about a read that projects the body away', () => {
		const payload = payload_of('state-check', STATE_CHECK_COMMAND)

		expect(rule_delivery(payload, NOW_MS)).toBeUndefined()
	})

	it('still delivers on a `--jq` read that names the body', () => {
		const payload = payload_of('body-jq', BODY_JQ_COMMAND)

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.ISSUE_COMMENTS_REASON)
	})

	// **A body read the run has already earned is not refused** (joshuafolkken/kit#1905): the tail
	// carries an `issue:read` of the same Issue, so its comments are already in hand.
	it('says nothing when the run already read that Issue comments', () => {
		const payload = payload_of('already-read', BODY_READ_COMMAND, 'Bash', comment_read_tail(1319))

		expect(rule_delivery(payload, NOW_MS)).toBeUndefined()
	})

	// A comment read of a *different* Issue leaves this body read refused.
	it('still delivers when the earlier comment read was another Issue', () => {
		const payload = payload_of('other-read', BODY_READ_COMMAND, 'Bash', comment_read_tail(1900))

		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.ISSUE_COMMENTS_REASON)
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

	// The tail carries a scout and an `issue:lint`, so the second call is claimed by neither
	// `issue-scout` nor the `issue:lint` oracle-consulted row — this block is about the WIP cap alone
	// (joshuafolkken/kit#2119, joshuafolkken/kit#2324).
	it(ONCE_PER_RUN, () => {
		const lint_call = josh_call_line(1, BRANCH, 'pnpm josh issue:lint x.md')
		const payload = payload_of('repeat', FILING_COMMAND, 'Bash', `${scouted_tail()}\n${lint_call}`)

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

	// What the reason *says* is pinned by `scripts/rules/shell-body-rule.test.ts`, which the marker-test
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

	it.each([
		WIP_CAP,
		ISSUE_SCOUT,
		FILING_CAP_ID,
		ISSUE_COMMENTS,
		SHELL_BODY,
		PIPED_VERIFICATION,
		RUN_TAIL,
	])('names %j', (id) => {
		expect(delivered_rules.DELIVERED_RULES.map((rule) => rule.id)).toContain(id)
	})

	it('is on by default', () => {
		expect(delivered_rules.is_enabled()).toBe(true)
	})
})

describe('DELIVERED_RULES — trigger overlap', () => {
	it.each([
		BODY_READ_COMMAND,
		BODY_READ_API_COMMAND,
		EVALUATED_BODY_COMMAND,
		PIPED_GATE_COMMAND,
		FOREGROUND_PUSH_COMMAND,
	])('is claimed by exactly one rule: %j', (command) => {
		expect(rules_claiming(command)).toBe(1)
	})

	// **A filing is the deliberate overlap: five rows claim it** (joshuafolkken/kit#2119,
	// joshuafolkken/kit#2213, joshuafolkken/kit#2324) — the WIP cap, the scout gate, the per-run cap, the
	// fold gate and the `issue:lint` oracle-consulted row — resolved by the reissue chain rather than by
	// a single winner, so the claim count is asserted rather than the exactly-one invariant above.
	it.each([FILING_COMMAND, FILING_API_COMMAND])(
		'is claimed by the five filing rules: %j',
		(command) => {
			expect(rules_claiming(command)).toBe(FILING_RULE_COUNT)
		},
	)

	// **The overlap order, asserted rather than assumed** (joshuafolkken/kit#1198,
	// joshuafolkken/kit#2119, joshuafolkken/kit#2324). A filing whose body carries a backtick is claimed
	// by six rows; with the run already scouted the scout gate and the cap stand down, and the fold gate
	// stands down on a first filing, so `wip-cap` is delivered first and `shell-body` on the reissue —
	// the `issue:lint` oracle row is last and would deliver only on a further reissue. The stamps are
	// keyed per `id`, so nothing is lost by losing the race.
	it('delivers the second rule on the reissue when a filing also carries an evaluated body', () => {
		const command = 'gh api repos/o/r/issues -f title="x" -f body="see `pnpm josh ms`"'
		const payload = payload_of('overlap', command, 'Bash', scouted_tail())

		expect(rules_claiming(command)).toBe(FILING_WITH_BODY_RULE_COUNT)
		expect(rule_delivery(payload, NOW_MS)).toBe(delivered_rules.WIP_CAP_REASON)
		expect(rule_delivery(payload, NOW_MS + 1)).toBe(delivered_rules.SHELL_BODY_REASON)
	})
})

describe('rule_delivery — a dispatched lane child keeps the rule guard', () => {
	// joshuafolkken/kit#2138: the rule guard fires in a lane child — it carries the lane-only rules a
	// child depends on and the safety rules it must still obey — so this block sets the mark and stays in
	// a lane checkout, unlike every other block here, which runs from the non-lane WORK_DIRECTORY.
	// The outer `beforeEach` chdirs back to the non-lane WORK_DIRECTORY and clears the mark before every
	// case, so this block needs no teardown of its own; `afterAll` restores the entry directory.
	beforeEach(() => {
		mkdirSync(LANE_DIRECTORY, { recursive: true })
		process.chdir(LANE_DIRECTORY)
		process.env[lane_child_marker.KEY] = LANE_ISSUE
	})

	// The rule guard fires in a child (the enumeration's `rule: true`, pinned in
	// `lane-guard-policy.test.ts`) — a safety rule still delivers here.
	it('still delivers a rule in a lane child', () => {
		expect(rule_delivery(payload_of('lane-shell-body', EVALUATED_BODY_COMMAND), NOW_MS)).toBe(
			delivered_rules.SHELL_BODY_REASON,
		)
	})

	// **The batching stand-aside is disabled in a lane child.** The batching guard is suppressed there
	// (joshuafolkken/kit#2138), so on the very history it would otherwise refuse, a lone rule trigger is
	// delivered at once rather than stood aside for a refusal that can no longer come — the non-lane
	// version of this transcript stands aside first (see "stands aside while the batching guard may
	// speak").
	it('delivers a body read without standing aside on a batched history', () => {
		const transcript = transcript_for('lane-body-collision', unbatched_text())
		const call = payload_for(transcript, BODY_READ_COMMAND)

		expect(rule_delivery(call, NOW_MS)).toBe(delivered_rules.ISSUE_COMMENTS_REASON)
	})
})
