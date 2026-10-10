import { investigation_reads } from '#scripts/delegation/investigation-reads'
import { hook_decision, type GuardRun, type TranscriptGuardSpec } from '#scripts/josh/hook-decision'
import { lane_guard_policy } from '#scripts/lane/lane-guard-policy'
import { time_batch_guard, type GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { bash_triggers } from './bash-triggers'
import { direct_filing } from './direct-filing'
import { early_heartbeat } from './early-heartbeat'
import { file_body } from './file-body'
import { filing_cap } from './filing-cap'
import { git_force } from './git-force'
import { implementation_cut } from './implementation-cut'
import { issue_comments } from './issue-comments'
import { josh_git_bare } from './josh-git-bare'
import { lane_background } from './lane-background'
import { lane_carry_conflict } from './lane-carry-conflict'
import { lane_interactive_ask } from './lane-interactive-ask'
import { lane_park } from './lane-park'
import { lane_split_park } from './lane-split-park'
import { lane_switch_main } from './lane-switch-main'
import { oracle_consulted } from './oracle-consulted'
import { permission_guards } from './permission-guards'
import { piped_verification } from './piped-verification'
import { poll_loop } from './poll-loop'
import { pre_gate_cut } from './pre-gate-cut'
import { raw_field_body } from './raw-field-body'
import { rule_body_guard } from './rule-body-guard'
import { run_tail_rule } from './run-tail-rule'
import { shell_body_trigger } from './shell-body-trigger'
import { test_declared_commit } from './test-declared-commit'
import { third_party_write } from './third-party-write'
import { worktree_guard } from './worktree-guard'

// The rules delivered by a `PreToolUse` refusal at the moment they bind, rather than carried resident
// in `CLAUDE.md` — a nameable trigger is cheaper and stronger delivered than carried. Every entry is a
// `hook_decision.create_transcript_guard` spec; each reason is a trigger plus a pointer to its topic
// file (`prompts/collaboration-workflow/residency.md`).

// The escape hatch, on by default like the other two guards.
const SWITCH_ENV_KEY = 'JOSH_RULE_GUARD'

// A compliance test sees the call, its turn and its run: batching needs the turn, the pre-gate cut
// needs the run; every other row reads the call alone.
type CallTest = (
	call: GuardedCall,
	turn: ReadonlyArray<GuardedCall>,
	run: ReadonlyArray<GuardedCall>,
) => boolean

// `id` keys the rule's own refusal record, so one rule firing never spends another's budget.
interface DeliveredRule {
	id: string
	is_trigger: (call: GuardedCall) => boolean
	// The only text that reaches the model: the instruction and the pointer.
	reason: string
	// A stand-down when an earlier act on the tail already satisfied the rule; checked first, so a
	// satisfied call spends no record.
	already_satisfied?: (tail: string, call: GuardedCall) => boolean
	// For a rule that binds on every occurrence instead of once per run. `at_ms` is this row's own last
	// refusal, so an immediate reissue can be let through.
	decide?: (call: GuardedCall, run: GuardRun, can_record: boolean, at_ms: number) => boolean
	// What keeping the rule looks like, for `rule-value.ts`; absent reads as unmeasured, not as a score.
	keeps?: CallTest
	// The occasion the rule governs, for a row whose trigger is the violation itself (else `is_trigger`
	// would only count runs that broke it).
	reaches?: CallTest
	// The note a hook attaches where it rewrites a violating call instead of refusing it, so
	// `rule-value.ts` counts the rewrite as this row's delivery.
	rewrite_note?: string
	// Openings the reason had before it was reworded, so `rule-value.ts` still credits a refusal
	// delivered with the old text while those transcripts remain in its window.
	former_reasons?: ReadonlyArray<string>
}

// Scored but possibly delivered by its own binary (batching, investigation) — joining `DELIVERED_RULES`
// would refuse one violation twice — so `is_trigger` is optional here.
type MeasuredRule = Omit<DeliveredRule, 'is_trigger'> & {
	is_trigger?: DeliveredRule['is_trigger']
}

const STAMP_PREFIX = 'josh-rule-guard-'

const { is_issue_filing, on_bash_command } = bash_triggers

const { SHELL_BODY_REASON, carries_a_body, is_shell_evaluated_body, keeps_body_safe } =
	shell_body_trigger

// Order matters only where triggers overlap (see `delivery`); the notes below name each overlap.
const DELIVERED_RULES: ReadonlyArray<DeliveredRule> = [
	// First: a third-party write is stopped before the first-party filing rows count anything.
	third_party_write.ROW,
	// The direct call only; `filing-cap` below triggers on `issue:file`. The WIP cap and the fold
	// question are `issue:file`'s own steps, so no row gates them.
	direct_filing.ROW,
	filing_cap.ROW,
	issue_comments.ROW,
	{
		id: 'shell-body',
		is_trigger: on_bash_command(is_shell_evaluated_body),
		reason: SHELL_BODY_REASON,
		keeps: on_bash_command(keeps_body_safe),
		reaches: on_bash_command(carries_a_body),
	},
	raw_field_body.ROW,
	{
		id: 'piped-verification',
		is_trigger: on_bash_command(piped_verification.is_masked_verification),
		reason: piped_verification.PIPED_VERIFICATION_REASON,
		keeps: on_bash_command(piped_verification.keeps_verdict_intact),
		reaches: on_bash_command(piped_verification.runs_verification),
		// A `| tail` / `| grep` masking is rewritten under `pipefail` by `pretool-guard.ts`, never refused.
		rewrite_note: piped_verification.PIPEFAIL_NOTE,
	},
	{
		id: 'early-heartbeat',
		is_trigger: on_bash_command(early_heartbeat.is_wait_timer),
		reason: early_heartbeat.EARLY_HEARTBEAT_REASON,
		decide: early_heartbeat.decide,
		keeps: on_bash_command(early_heartbeat.is_progress_watch),
		reaches: on_bash_command(early_heartbeat.waits_for_progress),
	},
	// Before `run-tail`: whether to commit at all is decided before how to push.
	test_declared_commit.ROW,
	// Before `run-tail`, so a lane child goes straight to `ship --detach` instead of through both.
	lane_background.ROW,
	// Reads `run_in_background` beside the command; `decide`, since a push recurs.
	{
		id: 'run-tail',
		is_trigger: run_tail_rule.is_foreground_push_step,
		reason: run_tail_rule.RUN_TAIL_REASON,
		decide: run_tail_rule.decide,
		keeps: run_tail_rule.is_backgrounded_push_step,
		reaches: run_tail_rule.is_push_step_call,
	},
	// Reads the lane name and the cut record. Once per run, not `decide`: taking the cut ends the
	// process, and the verdicts that leave a run at the gate all need the reissue through. `reaches`
	// tells the cutting run from the resumed one by the run's calls. Overlaps `piped-verification`
	// safely: that row speaks first and this one delivers on the reissue.
	{
		id: 'pre-gate-cut',
		is_trigger: on_bash_command(pre_gate_cut.is_uncut_gate),
		reason: pre_gate_cut.PRE_GATE_CUT_REASON,
		keeps: on_bash_command(pre_gate_cut.takes_the_cut),
		reaches: pre_gate_cut.reaches_the_pre_gate_boundary,
	},
	// A split child's park is refused before `lane-park` sees it.
	lane_split_park.ROW,
	lane_park.ROW,
	lane_interactive_ask.ROW,
	lane_carry_conflict.ROW,
	lane_switch_main.ROW,
	// Disjoint from `run-tail` by the `-y` flag.
	josh_git_bare.ROW,
	// The Bash-string gaps the deny glob cannot express, read by argv; `delivered-rules-bash.test.ts`
	// pins that no two rows claim one command.
	git_force.ROW,
	worktree_guard.ROW,
	file_body.ROW,
	...permission_guards.ROWS,
	poll_loop.ROW,
	// Before `rule-body`, its one overlap: the cut is the right first act, and `rule-body` delivers on
	// the reissue in the fresh process.
	implementation_cut.ROW,
	rule_body_guard.ROW,
	...oracle_consulted.ROWS,
]

const ALONE_IN_TURN = 1

// Kept: a call the guard could refuse went out beside siblings.
function batches_the_turn(call: GuardedCall, turn: ReadonlyArray<GuardedCall>): boolean {
	return time_batch_guard.is_guarded_call(call) && turn.length > ALONE_IN_TURN
}

// No `is_trigger`: a refusal depends on the turns behind a call, so the recorded refusal is the trigger.
const BATCHING_RULE: MeasuredRule = {
	id: 'batching',
	reason: time_batch_guard.REASON,
	keeps: batches_the_turn,
	reaches: time_batch_guard.is_guarded_call,
}

// No `is_trigger`, as for batching. No `keeps`: any dispatch would read as compliance, so it is left
// unmeasured — `pnpm josh time`'s `Investigation reads:` block is the compliance reading.
const INVESTIGATION_RULE: MeasuredRule = {
	id: 'investigation',
	reason: investigation_reads.REASON,
	reaches: investigation_reads.is_refusable_call,
}

const MEASURED_RULES: ReadonlyArray<MeasuredRule> = [
	...DELIVERED_RULES,
	BATCHING_RULE,
	INVESTIGATION_RULE,
]

// Once per run, so a run that obeyed is never wedged. A call the batching guard may refuse is stepped
// aside from: only one hook's reason surfaces per call, and a stamp written for a lost reason would
// silence the rule for the run. The rule delivers on the reissue instead.
const BATCH_STAMP = hook_decision.create_refusal_stamp(time_batch_guard.STAMP_PREFIX)

// The two hooks race on one event and the stamp is written before the reason, so a record this young
// is the batching guard speaking about the call in hand.
const BATCH_REFUSAL_WINDOW_MS = 10_000

// Asked with its real record, not `NEVER_MS`: that guard never refuses one sequence twice.
function will_batch_guard_refuse(tail: string, call: GuardedCall, run: GuardRun): boolean {
	// In a lane child the batching guard only notices, so there is nothing to stand aside for.
	if (lane_guard_policy.mode_here('batching') !== 'refuse') return false

	const refused_at_ms = BATCH_STAMP.last_ms(BATCH_STAMP.path(run.transcript))

	if (run.now_ms - refused_at_ms < BATCH_REFUSAL_WINDOW_MS) return true

	return time_batch_guard.should_block(tail, call, refused_at_ms)
}

function is_first_delivery(
	tail: string,
	call: GuardedCall,
	delivered_at_ms: number,
	run: GuardRun,
): boolean {
	return delivered_at_ms === hook_decision.NEVER_MS && !will_batch_guard_refuse(tail, call, run)
}

// `decide` and `already_satisfied` each replace `is_first_delivery`. A recurring row is always asked;
// the stand-aside reaches it as `can_record`, since what must not happen is recording a refused act.
// An `already_satisfied` row refuses every call until the satisfying act is on the tail.
function delivery_decision(rule: DeliveredRule): TranscriptGuardSpec['should_block'] {
	const { decide, already_satisfied } = rule

	if (decide === undefined && already_satisfied === undefined) return is_first_delivery

	return function should_block(
		tail: string,
		call: GuardedCall,
		delivered_at_ms: number,
		run: GuardRun,
	): boolean {
		if (already_satisfied?.(tail, call) === true) return false
		if (decide === undefined) return true

		return decide(call, run, !will_batch_guard_refuse(tail, call, run), delivered_at_ms)
	}
}

function guard_of(rule: DeliveredRule): ReturnType<typeof hook_decision.create_transcript_guard> {
	return hook_decision.create_transcript_guard({
		prefix: `${STAMP_PREFIX}${rule.id}-`,
		switch_key: SWITCH_ENV_KEY,
		is_candidate: rule.is_trigger,
		should_block: delivery_decision(rule),
		reason: rule.reason,
	})
}

const GUARDS = new Map(DELIVERED_RULES.map((rule) => [rule.id, guard_of(rule)]))

// Exposed for the suite, whose records land in the shared temp directory and must be cleared.
function delivery_path(rule_id: string, transcript_path: string): string {
	return GUARDS.get(rule_id)?.refusal_path(transcript_path) ?? ''
}

// The first entry whose delivery fires wins. An overlap is admissible only when the losing rule is
// still right one reissue later; stamps are keyed per id, so it is delivered then.
function delivery(raw_payload: string, now_ms: number = Date.now()): string | undefined {
	for (const guard of GUARDS.values()) {
		const reason = guard.refusal(raw_payload, now_ms)

		if (reason !== undefined) return reason
	}

	return undefined
}

function is_enabled(): boolean {
	return hook_decision.is_switch_enabled(SWITCH_ENV_KEY)
}

const delivered_rules = {
	DELIVERED_RULES,
	EARLY_HEARTBEAT_REASON: early_heartbeat.EARLY_HEARTBEAT_REASON,
	FILE_BODY_REASON: file_body.FILE_BODY_REASON,
	DIRECT_FILING_REASON: direct_filing.DIRECT_FILING_REASON,
	FILING_CAP_REASON: filing_cap.FILING_CAP_REASON,
	GIT_FORCE_REASON: git_force.GIT_FORCE_REASON,
	ISSUE_COMMENTS_REASON: issue_comments.ISSUE_COMMENTS_REASON,
	LANE_INTERACTIVE_ASK_REASON: lane_interactive_ask.LANE_INTERACTIVE_ASK_REASON,
	LANE_PARK_REASON: lane_park.LANE_PARK_REASON,
	MEASURED_RULES,
	PIPED_VERIFICATION_REASON: piped_verification.PIPED_VERIFICATION_REASON,
	POLL_LOOP_REASON: poll_loop.POLL_LOOP_REASON,
	PRE_GATE_CUT_REASON: pre_gate_cut.PRE_GATE_CUT_REASON,
	RAW_FIELD_BODY_REASON: raw_field_body.RAW_FIELD_BODY_REASON,
	RUN_TAIL_REASON: run_tail_rule.RUN_TAIL_REASON,
	SHELL_BODY_REASON,
	SWITCH_ENV_KEY,
	THIRD_PARTY_WRITE_REASON: third_party_write.THIRD_PARTY_WRITE_REASON,
	WORKTREE_MUTATION_REASON: worktree_guard.WORKTREE_MUTATION_REASON,
	delivery,
	delivery_path,
	is_body_only_issue_read: issue_comments.is_body_only_issue_read,
	is_enabled,
	is_issue_filing,
}

export type { DeliveredRule, MeasuredRule }
export { delivered_rules }
