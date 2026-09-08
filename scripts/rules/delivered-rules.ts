import { cost_blocks } from '#scripts/cost/cost-blocks'
import { hook_decision, type GuardRun, type TranscriptGuardSpec } from '#scripts/josh/hook-decision'
import { time_batch_guard, type GuardedCall } from '#scripts/time/time-batch-guard'
import { time_shell } from '#scripts/time/time-shell'
import { early_heartbeat } from './early-heartbeat'
import { piped_verification } from './piped-verification'
import { shell_body_trigger } from './shell-body-trigger'

// The enumeration of rules delivered at the moment they bind, rather than carried resident in
// `CLAUDE.md` on every turn (joshuafolkken/kit#1524).
//
// **It exists because residency ran out and delivery did not.** `CLAUDE.md` sits 6 tokens under the
// ceiling `scripts/workflow-skills.test.ts` enforces, while `prompts/` and `.claude/skills/` hold
// fifteen times as much on demand — so the pressure is on the one channel that costs every turn.
// joshuafolkken/kit#1344 measured three consecutive runs in which resident prose about batching moved
// the number not at all, and joshuafolkken/kit#1460 measured the same for the investigation
// threshold; in both, a `PreToolUse` refusal was what finally moved it. A rule whose trigger can be
// named is therefore cheaper **and** stronger delivered than carried.
//
// **No new machinery.** `hook_decision.create_transcript_guard` is the shell both existing guards
// already share (joshuafolkken/kit#1460) — the payload schema, the deny envelope, the switch, the
// `.env` load and the once-per-run stamp — and every entry below is one of its specs. Building a
// second delivery path would be the clone `CLAUDE.md` prohibits, in the one place where two paths
// would disagree about whether a rule was delivered at all.
//
// **What this file is not.** It holds no rule *text* that exists nowhere else: each entry's reason is
// the trigger plus the instruction that must be obeyed before anything else is read, and names the
// topic file that carries the procedure — the same "trigger plus pointer" shape a resident rule takes
// (`prompts/collaboration-workflow/residency.md`).

// The escape hatch, on by default like the other two guards. A distributed convention nobody enabled
// would leave this Issue where it started.
const SWITCH_ENV_KEY = 'JOSH_RULE_GUARD'

// One rule delivered by trigger. `id` keys its own refusal record, so one rule firing never spends
// another's budget.
interface DeliveredRule {
	id: string
	// Whether this call is the moment the rule binds, judged from the call alone.
	is_trigger: (call: GuardedCall) => boolean
	// What the model is told. The deny reason is the only text that reaches it, so it carries the
	// instruction and the pointer rather than a summary of either.
	reason: string
	// **A rule that has to bind on every occurrence supplies this, and once-per-run stops applying to
	// it** (joshuafolkken/kit#1570). Once per run is right for a rule a run then obeys — read the
	// comments, count the Issues, put the body in a file — because the refusal changes what the run
	// knows. It is wrong for one whose subject is a *recurring* act: refused once and free
	// afterwards, the enforcement is back to the parent's self-restraint, which is the thing that
	// failed. A row with this field is asked it instead, and it is asked on every candidate call —
	// `can_record` is what the batching stand-aside becomes for such a row (see `delivery_decision`).
	decide?: (call: GuardedCall, run: GuardRun, can_record: boolean) => boolean
}

const STAMP_PREFIX = 'josh-rule-guard-'

// `gh issue create`, in any of the spellings a run reaches for.
const ISSUE_CREATE_COMMAND = /\bgh\s+(?:\S+\s+)*?issue\s+create\b/u
// `gh api …/issues` — the path segment has to *end* there, so a comment endpoint
// (`…/issues/1524/comments`) and a listing under it are both left alone.
const ISSUES_ENDPOINT = /repos\/[^\s'"]*\/issues(?=$|["'\s])/u
// A title field is what separates the POST that files from the GET that lists: `gh api …/issues`
// with no field is a listing, and a listing files nothing. **All four spellings**, `-F` included —
// it is `--field`'s short form and reads as a different flag to a pattern that only knows `-f`.
// A body passed with `--input <file>` carries the title inside the file and is not visible here;
// that limit is recorded beside the non-`gh` one in `prompts/collaboration-workflow/rule-delivery.md`.
const TITLE_FIELD = /(?:-f|-F|--field|--raw-field)\s*'?title=/u

function is_issue_filing(command: string): boolean {
	if (ISSUE_CREATE_COMMAND.test(command)) return true

	return ISSUES_ENDPOINT.test(command) && TITLE_FIELD.test(command)
}

// **Only `Bash`, and the omission is deliberate** (joshuafolkken/kit#1390): Claude Code denies one
// call of a turn and runs the rest, so a refused `Edit` would leave its siblings applied and itself
// not. Every rule enumerated here is therefore one whose binding moment is a shell call — so the
// tool-name guard belongs to the enumeration rather than to each row, and a row states only what it
// looks for in the command.
function on_bash_command(is_match: (command: string) => boolean): (call: GuardedCall) => boolean {
	return function is_trigger(call: GuardedCall): boolean {
		if (call.name !== cost_blocks.BASH_TOOL) return false

		return is_match(time_shell.bash_command(call.input))
	}
}

// The whole of the WIP cap, in the shape a refusal can carry: the count, the refusal, the two
// exemptions and the three tests that decide the second one. The three tests are spelled out rather
// than named, because a delivery that said only "an interrupt is exempt" would hand the deciding back
// to judgement at exactly the moment nothing else is open to read (joshuafolkken/kit#1518).
const WIP_CAP_REASON =
	"⛔ backlog WIP cap: count the target repository's open Issues before filing. With more than 30 " +
	'open, close one first; nothing honestly closable means do not file. Two filings are exempt and ' +
	'proceed while stating the overage — one the run is blocked by, and an interrupt, decided by ' +
	'three tests rather than judgement: a verification answers wrongly, a documented workflow cannot ' +
	'complete, or data is lost or written outside the repository. Meeting none of the three, the ' +
	'finding is discretionary and waits. The count command and both procedures are in ' +
	'`prompts/collaboration-workflow/wip-cap.md`. Reissue this call once you have counted — it fires ' +
	'once per run and cannot repeat on the call in hand.'

// **A shell line carries several commands, and the subcommand has to be the one being invoked.**
// Each segment is judged on its own, anchored at its start, so `gh issue comment <N> -b "… gh issue
// view <N> …"` is read as the write it is rather than as the read it quotes. A bare `|` is not a
// separator here: it appears inside a `--jq` filter far more often than between two `gh` calls.
const SEGMENT_SEPARATOR = /&&|\|\||;|\n/u
// Global flags may precede the subcommand (`gh --repo o/r issue view 1`), so they are skipped.
const GH_FLAGS = String.raw`(?:-{1,2}[\w-]+(?:[= ][^\s]+)?\s+)*`
const ISSUE_VIEW_COMMAND = new RegExp(String.raw`^gh\s+${GH_FLAGS}issue\s+view\s`, 'u')
const GH_API_COMMAND = new RegExp(String.raw`^gh\s+${GH_FLAGS}api\s`, 'u')
// `…/issues/<N>` — **one** Issue's body. The number has to end the path, so the listing
// (`…/issues`) and every sub-resource under it (`…/issues/1319/comments`) are left alone.
const ISSUE_BODY_PATH = /repos\/[^\s'"]*\/issues\/\d+(?=$|["'\s])/u
// **A write to that path is not a read of it.** `gh api` sends POST as soon as any field flag
// appears, and `kickoff` PATCHes `…/issues/<N>` to normalize a title and to fill a blank body — so
// without this the delivery would be spent refusing a write, and the genuine body read later in the
// same run would never be guarded.
const API_METHOD = /(?:^|\s)(?:--method|-X)[= ]([A-Za-z]+)/u
const API_FIELD = /(?:^|\s)(?:--raw-field|--field|--input|-F|-f)(?:[= ]|$)/u
// A segment that fetches comments: the flag, a `comments` field in a `--json` projection, or the
// comments endpoint. The short `-c` is deliberately absent — it belongs to `wc`, `grep` and `sort`
// far more often than to `gh`, and reading it as "comments included" silenced the rule on any line
// that ended in a pipe. A run that types it pays one round trip instead.
const FETCHES_COMMENTS = /--comments\b|--json\s[\w,]*\bcomments\b|\/comments\b/u
const ISSUES_PATH = /repos\/[^\s'"]*\/issues\//u

function is_api_read(segment: string): boolean {
	const method = API_METHOD.exec(segment)?.[1]

	if (method !== undefined) return method.toUpperCase() === 'GET'

	return !API_FIELD.test(segment)
}

function is_body_read_segment(segment: string): boolean {
	if (ISSUE_VIEW_COMMAND.test(segment)) return true

	return GH_API_COMMAND.test(segment) && ISSUE_BODY_PATH.test(segment) && is_api_read(segment)
}

// **An Issue's comments, not just any comments.** Batching pushes a run to fetch the body and the
// comments on one line, so the allowance has to reach across segments — but `gh pr view 42 --json
// comments` says nothing about whether *this* Issue was read whole, so the segment doing the
// fetching has to be an Issue read itself.
function fetches_issue_comments(segment: string): boolean {
	if (!FETCHES_COMMENTS.test(segment)) return false

	return (
		ISSUE_VIEW_COMMAND.test(segment) || (GH_API_COMMAND.test(segment) && ISSUES_PATH.test(segment))
	)
}

// **The trigger is the body read, not the start of implementation.** The moment an Issue's body
// reaches a run is the moment the rule binds, and it is one shell call — the test
// `prompts/collaboration-workflow/rule-delivery.md` sets for leaving residency.
function is_body_only_issue_read(command: string): boolean {
	const segments = command.split(SEGMENT_SEPARATOR).map((segment) => segment.trim())

	if (segments.some((segment) => fetches_issue_comments(segment))) return false

	return segments.some((segment) => is_body_read_segment(segment))
}

// **The refusal hands over the command that fixes it**, because reading is not the same as
// obeying: a sentence saying "also read the comments" is prose of exactly the kind
// joshuafolkken/kit#1344 measured as moving nothing, while a refused body read leaves the run
// holding the reissue that makes the comments *present*. The conflict rule ships with it — a
// delivery that said only "read them" would hand back the deciding at the moment nothing else is
// open to read, the mistake joshuafolkken/kit#1518 corrected for the WIP cap.
const ISSUE_COMMENTS_REASON =
	"⛔ an Issue's comments are part of the Issue: read them before implementing, not only the body. " +
	'A decision recorded after the body was written lives only in a comment — a corrected diagnosis ' +
	'(joshuafolkken/kit#1537), a changed default and an added acceptance criterion ' +
	'(joshuafolkken/kit#1520), a scope handed to another Issue (joshuafolkken/kit#1304) — and ' +
	'nothing in the body says it was superseded, so a body-only reader builds the wrong thing and ' +
	'sees no contradiction. Reissue this read with the comments included: ' +
	"`gh api repos/{owner}/{repo}/issues/<N>/comments --jq '.[] | {user: .user.login, created_at, " +
	"body}'` beside the body read, or `gh issue view <N> --comments` where GraphQL is reachable. " +
	'Then the later text is the agreement in force — a comment supersedes the body it contradicts — ' +
	"except for two answers that are not the run's to make: work a comment reassigns to another " +
	'Issue is out of scope and is not implemented, and a comment saying the Issue no longer has a ' +
	'reason to exist stops the run with a `confirmation` Telegram. The procedure is ' +
	'`.claude/skills/workflow-commands/SKILL.md` → "An Issue\'s comments are part of the Issue". It ' +
	'fires once per run and cannot repeat on the call in hand.'

// The reading of the call itself — which spellings carry a body inline, and what the shell does to
// the value — is `shell-body-trigger.ts`, beside its own cases. A row states its trigger and its
// text; a model of zsh quoting is more than a row.
const { is_shell_evaluated_body } = shell_body_trigger

// The instruction in the shape a refusal can carry: what the shell is about to do, the safe
// spellings, and the reissue sentence every delivery needs. The damage is named because it is the
// half that reads as unbelievable — the substituted text is *executed*, not discarded.
const SHELL_BODY_REASON =
	'⛔ shell-evaluated body: this command carries a body inline in double quotes, and that body ' +
	'contains a backtick or a `$`. The shell evaluates both before the command runs, so the text is ' +
	'executed rather than merely mangled — joshuafolkken/kit#1198 recorded a PR comment whose own ' +
	"words ran as git commands and switched a lane's work tree onto main. Write the body to a file " +
	'and pass it by path: `gh api repos/{owner}/{repo}/issues/<N>/comments --field body=@<path>` (a ' +
	'PR comment is an issue comment), `pnpm josh followup --notify-message-file <path>`, `pnpm josh ' +
	"notify --body-file <path>`, and `--body-file <path>` wherever a command offers it. `$'…'` " +
	'quoting is the other safe form and is unchanged. The rule and what the trigger cannot see are in ' +
	'`prompts/collaboration-workflow/shell-body.md`. Reissue this call once the body is in a file — ' +
	'it fires once per run and cannot repeat on the call in hand.'

const DELIVERED_RULES: ReadonlyArray<DeliveredRule> = [
	{ id: 'wip-cap', is_trigger: on_bash_command(is_issue_filing), reason: WIP_CAP_REASON },
	{
		id: 'issue-comments',
		is_trigger: on_bash_command(is_body_only_issue_read),
		reason: ISSUE_COMMENTS_REASON,
	},
	{
		id: 'shell-body',
		is_trigger: on_bash_command(is_shell_evaluated_body),
		reason: SHELL_BODY_REASON,
	},
	{
		id: 'piped-verification',
		is_trigger: on_bash_command(piped_verification.is_masked_verification),
		reason: piped_verification.PIPED_VERIFICATION_REASON,
	},
	{
		id: 'early-heartbeat',
		is_trigger: on_bash_command(early_heartbeat.is_wait_timer),
		reason: early_heartbeat.EARLY_HEARTBEAT_REASON,
		decide: early_heartbeat.decide,
	},
]

// **Once per run, never once per call.** A rule delivered again on the next call would wedge a run
// that had already obeyed it, which is the failure `hook_decision`'s stamp exists to prevent; the
// reason text says so, so a reader knows reissuing is the expected next move.
//
// **The tail read is what keeps two `Bash` guards off the same call.** `pnpm josh batch:guard` is
// wired to `Bash` as well, and the shared shell records the stamp *before* returning a reason. Claude
// Code surfaces one permission decision per call, so a call both hooks refused would lose one of the
// two reasons while both records were already written — and a rule whose record is set can never fire
// again in that run. That is a silent deletion, of exactly the kind this enumeration exists to
// prevent. So a call the batching guard may refuse is **stepped aside from rather than delivered
// on**: nothing is recorded (the shared shell stamps only after `should_block` answers true), the
// batching guard's own reason says to reissue the call, and this rule delivers on the reissue.
//
// **Inert for `wip-cap` and live for `issue-comments`, which is why it was written before either
// needed it.** The batching guard does not treat a filing call as a candidate at all, so the branch
// never fires for `wip-cap`; it *does* treat `gh issue view` as one, so the second row genuinely
// stands aside on a turn the batching guard is about to refuse and delivers on the reissue.
// `delivered-rules.test.ts` pins both halves, and it is what any new row has to be re-checked
// against. Erring toward standing aside costs at most one call's delay, while erring the other way
// costs the rule for the whole run.
// The batching guard's own record for this run, read through the same shell that writes it.
const BATCH_STAMP = hook_decision.create_refusal_stamp(time_batch_guard.STAMP_PREFIX)

// **A record this young is the batching guard speaking about the call in hand.** The two hooks are
// separate processes started for the same `PreToolUse` event with no ordering between them, and the
// shared shell writes its stamp *before* it returns a reason — so presence alone cannot answer "has
// it refused?" without making the stand-aside depend on which process won the race. A record older
// than this window is a refusal about an earlier call, which that guard will not repeat on the same
// open sequence, and this rule is free to speak.
const BATCH_REFUSAL_WINDOW_MS = 10_000

// **The question is what the batching guard will do on this call, not what it would do from a clean
// slate.** Asked with `NEVER_MS` in place of its record, the answer stayed `true` for the whole of an
// open sequence it had *already* refused — and since that guard will not refuse the same sequence
// twice, a run that kept single-calling after being refused had neither hook speak, and this rule was
// lost for the run with nothing recorded to say so. That is the silent deletion the stand-aside
// exists to prevent, arrived at from the other side.
function will_batch_guard_refuse(tail: string, call: GuardedCall, run: GuardRun): boolean {
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
	if (delivered_at_ms !== hook_decision.NEVER_MS) return false

	return !will_batch_guard_refuse(tail, call, run)
}

// **For a row that decides for itself, the stand-aside changes what it protects.** For a once-per-run
// row it protects the *record*, because a lost race spends the one delivery the run gets. A recurring
// row cannot be silently deleted that way — it fires again — and standing aside from the refusal would
// instead make it silent on precisely the lone `Bash` call the batching guard also claims, which is
// what an armed timer always is, for the whole ten-second window and the reissue inside it. So the
// refusal is asked unconditionally and the stand-aside is handed to the row as `can_record`: what must
// not happen on a call another hook may stop is the *write*, which would record a timer that never ran.
// **It is a trade, and the other side is named rather than hidden**: an arm allowed inside that window
// that really does run is not recorded either, so a second one before it fires goes uncaught. A missing
// record loses one detection; a wrong one blocks every arm until it expires.
function delivery_decision(rule: DeliveredRule): TranscriptGuardSpec['should_block'] {
	const { decide } = rule

	if (decide === undefined) return is_first_delivery

	return function should_block(
		tail: string,
		call: GuardedCall,
		_delivered_at_ms: number,
		run: GuardRun,
	): boolean {
		return decide(call, run, !will_batch_guard_refuse(tail, call, run))
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

// Where one rule's once-per-run record lives, so a caller can clear it. Exposed for the suite: the
// records land in the shared temp directory rather than under any directory a test owns, and a record
// left behind would silence the next case exactly as it silences the next call.
function delivery_path(rule_id: string, transcript_path: string): string {
	const guard = GUARDS.get(rule_id)

	return guard === undefined ? '' : guard.refusal_path(transcript_path)
}

// **The first entry whose delivery actually fires wins — not the first whose trigger matches.** Only
// one refusal can leave a `PreToolUse` hook, so a rule that matched but has already been delivered
// this run falls through and a later rule may speak on the same call. **A rule added here therefore
// has to be one whose trigger no other row also matches**, and the enumeration's own suite asserts
// that over every row's fixtures.
//
// **`shell-body` carries the one deliberate exception, and the order is what makes it safe**
// (joshuafolkken/kit#1198). A filing whose body happens to contain a backtick —
// `gh api …/issues -f title="…" -f body="… \`x\` …"` — is claimed by `wip-cap` as well. It is listed
// first because it decides whether the Issue should exist at all, and rewriting a body into a file
// for an Issue that must not be filed is wasted work. Nothing is lost by losing the race: the stamps
// are keyed per `id`, so the reissued call is delivered the second rule. An overlap is admissible
// only when that reading holds — that the losing rule's delivery is still correct one call later.
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
	ISSUE_COMMENTS_REASON,
	PIPED_VERIFICATION_REASON: piped_verification.PIPED_VERIFICATION_REASON,
	SHELL_BODY_REASON,
	SWITCH_ENV_KEY,
	WIP_CAP_REASON,
	delivery,
	delivery_path,
	is_body_only_issue_read,
	is_enabled,
	is_issue_filing,
	is_masked_verification: piped_verification.is_masked_verification,
	is_wait_timer: early_heartbeat.is_wait_timer,
}

export type { DeliveredRule }
export { delivered_rules }
