import { cost_blocks } from '#scripts/cost/cost-blocks'
import { investigation_reads } from '#scripts/delegation/investigation-reads'
import { hook_decision, type GuardRun, type TranscriptGuardSpec } from '#scripts/josh/hook-decision'
import { time_batch_guard, type GuardedCall } from '#scripts/time/time-batch-guard'
import { time_shell } from '#scripts/time/time-shell'
import { early_heartbeat } from './early-heartbeat'
import { piped_verification } from './piped-verification'
import { pre_gate_cut } from './pre-gate-cut'
import { prior_comment_read } from './prior-comment-read'
import { run_tail } from './run-tail'
import { shell_body_trigger } from './shell-body-trigger'
import { shell_segments } from './shell-segments'

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

// **What a compliance test is asked of: the call, the turn it went out in, and the run it belongs
// to** — the calls the same assistant message issued, and every call the run made
// (joshuafolkken/kit#1792 for the turn, joshuafolkken/kit#1867 for the run). Every row but two answers
// from the call alone and simply ignores the rest, which is why widening the one signature costs them
// nothing. **The batching rule cannot be written without the turn**: its subject is *how many calls a
// turn carried*, and no field of a single call says that. **The pre-gate cut cannot be written without
// the run**: a cut relaunches a second process that issues the identical entry check, so the two
// halves are separable only by a call one of them makes elsewhere in the run. In both cases the
// alternative was a second predicate slot beside this one, i.e. two ways to declare the same thing.
type CallTest = (
	call: GuardedCall,
	turn: ReadonlyArray<GuardedCall>,
	run: ReadonlyArray<GuardedCall>,
) => boolean

// One rule delivered by trigger. `id` keys its own refusal record, so one rule firing never spends
// another's budget.
interface DeliveredRule {
	id: string
	// Whether this call is the moment the rule binds, judged from the call alone.
	is_trigger: (call: GuardedCall) => boolean
	// What the model is told. The deny reason is the only text that reaches it, so it carries the
	// instruction and the pointer rather than a summary of either.
	reason: string
	// **A stand-down read from the transcript tail, not the call** (joshuafolkken/kit#1905). A rule
	// whose subject a run can *satisfy earlier in the run* — the comments read on the first open, so a
	// later body read of the same Issue asks for nothing new — supplies this so the delivery is
	// suppressed once that earlier act is on the tail. It is checked before `is_first_delivery`, so a
	// satisfied call neither refuses nor spends the once-per-run record. Absent, delivery is unchanged.
	already_satisfied?: (tail: string, call: GuardedCall) => boolean
	// **A rule that has to bind on every occurrence supplies this, and once-per-run stops applying to
	// it** (joshuafolkken/kit#1570). Once per run is right for a rule a run then obeys — read the
	// comments, count the Issues, put the body in a file — because the refusal changes what the run
	// knows. It is wrong for one whose subject is a *recurring* act: refused once and free
	// afterwards, the enforcement is back to the parent's self-restraint, which is the thing that
	// failed. A row with this field is asked it instead, and it is asked on every candidate call —
	// `can_record` is what the batching stand-aside becomes for such a row (see `delivery_decision`).
	decide?: (call: GuardedCall, run: GuardRun, can_record: boolean) => boolean
	// **What keeping this rule looks like, as a call** (joshuafolkken/kit#1525). It names the act the
	// rule asks for, so a run that made it *before* the trigger fired can be told apart from one that
	// complied only because the refusal made it. `scripts/rules/rule-value.ts` reads that difference
	// off recorded sessions to score what the rule's carried text earns unaided; a row that declares
	// none is reported unmeasured rather than scored, because "never kept" and "always kept" are both
	// claims the absence of a predicate does not support. It lives here rather than in the
	// measurement so a rule's trigger and its compliance test stay one definition.
	keeps?: CallTest
	// **The occasion the rule governs, read in either spelling** (joshuafolkken/kit#1643).
	// `is_trigger` is the right denominator for a rule whose trigger is a *neutral* act — filing an
	// Issue, reading one — because a run that keeps the rule makes that call too. It is the wrong one
	// for a rule whose trigger is the violation itself: a run that backgrounded every push never trips
	// `run-tail`, so it drops out of the reading altogether and the rate is taken over runs that broke
	// the rule at least once. Such a row declares this instead, and `scripts/rules/rule-value.ts`
	// counts a run that reached it whether or not the trigger fired. Absent, the denominator stays
	// `is_trigger` and the row's reading is exactly what it was.
	reaches?: CallTest
}

// **A rule the measurement scores, whether or not `pnpm josh rule:guard` is what delivers it**
// (joshuafolkken/kit#1792). `DELIVERED_RULES` is the *delivery* registry — every row in it becomes a
// live `PreToolUse` guard through `GUARDS` below — so a rule already delivered by a binary of its own
// cannot join it without being refused twice for one violation, each refusal spending a record the
// other cannot see. The batching guard is that rule: `pnpm josh batch:guard` has delivered it since
// joshuafolkken/kit#1344, and until now it was the one delivered rule `pnpm josh rule:value` could
// not read. So the two registries are separated rather than merged, and `is_trigger` — the field
// that only a *delivered* row needs, because it is what `guard_of` makes the candidate test from —
// becomes the one optional field here.
type MeasuredRule = Omit<DeliveredRule, 'is_trigger'> & {
	is_trigger?: DeliveredRule['is_trigger']
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
// view <N> …"` is read as the write it is rather than as the read it quotes. The cut itself is
// `shell-segments.ts`, shared with the triggers that need the same one.
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

// A field projection — `--jq` for `gh api`, `--json` for `gh issue view` — whose value never names the
// body. `gh api …/issues/<N> --jq '{state, labels}'` fetches the Issue only to read its state or its
// labels, which is a state check and not the body read this rule guards (joshuafolkken/kit#1905); a
// `--jq '.body'` still names the body and stays a body read. The value is taken quoted or bare, so the
// comma list `--json state,labels` and the expression `'{state, labels}'` are read the same way.
const FIELD_PROJECTION = /(?:--jq|--json)[= ]\s*('[^']*'|"[^"]*"|\S+)/u
const NAMES_THE_BODY = /\bbody\b/u

function projects_away_body(segment: string): boolean {
	const projection = FIELD_PROJECTION.exec(segment)

	if (projection === null) return false

	return !NAMES_THE_BODY.test(projection[1] ?? '')
}

function is_body_read_segment(segment: string): boolean {
	if (projects_away_body(segment)) return false

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
	const segments = shell_segments.segments_of(command)

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
const { carries_a_body, is_shell_evaluated_body, keeps_body_safe } = shell_body_trigger

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

// **Keeping the WIP cap is counting the open Issues**, which is the one act the rule asks for before
// a filing.
//
// **It has to be Issues, open, and a listing — all three, in one segment.** A pattern that took any
// of them alone scored `gh pr list --state open` and `epic:bundle`'s candidate search as the count,
// and those inflate exactly the ratio the retirement decision reads. `gh issue list` alone is not
// enough either: the cap is about *open* Issues, and a listing that does not say so is some other
// question. Segment-wise like the comments predicate, so a spelling quoted inside a filing's body
// is not read as the count that filing skipped.
const ISSUE_LISTING = /^gh\s+(?:-{1,2}[\w-]+(?:[= ]\S+)?\s+)*issue\s+list\b/u
const ISSUES_QUERY = /repos\/[^\s'"]*\/issues\?[^\s'"]*state=open/u
const OPEN_STATE = /--state[= ]open|state=open/u
// **A label filter makes it a different question.** `gh issue list --label epic --state open` and
// `…/issues?labels=epic&state=open` ask which epics are open, which is what `epic:bundle` and the
// Issue template do; counting either as the WIP count would credit the cap as kept by a run that
// never counted the backlog. The residual the pattern cannot separate is named in
// `docs/josh-commands.md`: the inventory command in the `diag` skill is byte-identical to the count
// command in `wip-cap.md`, so no pattern can tell those two apart.
const LABEL_FILTER = /--label\b|[?&]labels=/u

function counts_open_issues(command: string): boolean {
	return shell_segments.segments_of(command).some((segment) => {
		if (LABEL_FILTER.test(segment)) return false

		return (ISSUE_LISTING.test(segment) && OPEN_STATE.test(segment)) || ISSUES_QUERY.test(segment)
	})
}

// **Keeping the comments rule is fetching them**, in any of the spellings the refusal hands back.
function reads_issue_comments(command: string): boolean {
	return shell_segments.segments_of(command).some((segment) => fetches_issue_comments(segment))
}

const ASKS_ABOUT_THE_CUT = on_bash_command(pre_gate_cut.asks_about_the_cut)
const CLAIMS_THE_HOLD = on_bash_command(pre_gate_cut.claims_the_hold)

// **The occasion the pre-gate cut governs, in the one shape that separates a cut run's two halves**
// (joshuafolkken/kit#1867). Asking about the cut is what a lane child does whatever it goes on to do;
// claiming the working tree is what only the process on the near side of the boundary does, because
// the `resume` verdict tells its counterpart to skip that claim. A run doing both reached the
// boundary; a run that asked without claiming is the session the cut produced, which had no cut of
// its own to take and belongs in no denominator.
function reaches_the_pre_gate_boundary(
	call: GuardedCall,
	_turn: ReadonlyArray<GuardedCall>,
	run: ReadonlyArray<GuardedCall>,
): boolean {
	if (!ASKS_ABOUT_THE_CUT(call)) return false

	return run.some((issued) => CLAIMS_THE_HOLD(issued))
}

const DELIVERED_RULES: ReadonlyArray<DeliveredRule> = [
	{
		id: 'wip-cap',
		is_trigger: on_bash_command(is_issue_filing),
		reason: WIP_CAP_REASON,
		keeps: on_bash_command(counts_open_issues),
	},
	{
		id: 'issue-comments',
		is_trigger: on_bash_command(is_body_only_issue_read),
		reason: ISSUE_COMMENTS_REASON,
		already_satisfied: prior_comment_read.already_read_for_call,
		keeps: on_bash_command(reads_issue_comments),
	},
	{
		id: 'shell-body',
		is_trigger: on_bash_command(is_shell_evaluated_body),
		reason: SHELL_BODY_REASON,
		keeps: on_bash_command(keeps_body_safe),
		reaches: on_bash_command(carries_a_body),
	},
	{
		id: 'piped-verification',
		is_trigger: on_bash_command(piped_verification.is_masked_verification),
		reason: piped_verification.PIPED_VERIFICATION_REASON,
		keeps: on_bash_command(piped_verification.keeps_verdict_intact),
		reaches: on_bash_command(piped_verification.runs_verification),
	},
	{
		id: 'early-heartbeat',
		is_trigger: on_bash_command(early_heartbeat.is_wait_timer),
		reason: early_heartbeat.EARLY_HEARTBEAT_REASON,
		decide: early_heartbeat.decide,
		keeps: on_bash_command(early_heartbeat.is_progress_watch),
		reaches: on_bash_command(early_heartbeat.waits_for_progress),
	},
	// **The one row whose trigger reads a field of the input beside the command**, so it supplies its
	// own tool-name check rather than going through `on_bash_command`: a push step already issued with
	// `run_in_background` is the rule obeyed, and refusing it would charge a run for doing the right
	// thing. It supplies `decide` because a push is a recurring act — one per child in a batch, and a
	// second inside one `fullrun` when round 2 fixes a finding in place.
	{
		id: 'run-tail',
		is_trigger: run_tail.is_foreground_push_step,
		reason: run_tail.RUN_TAIL_REASON,
		decide: run_tail.decide,
		keeps: run_tail.is_backgrounded_push_step,
		reaches: run_tail.is_push_step_call,
	},
	// **The one row whose trigger consults the world beside the command**, because "is this a lane that
	// has not cut" is not readable from the call: it is the working directory's own name and the cut
	// record on disk. Both reads are synchronous, and the command match runs first, so a run that never
	// types `pnpm josh gate` pays nothing for it.
	//
	// **Once per run rather than `decide`, and the direction of the error is why.** Taking the cut ends
	// the process, so this is not the recurring act joshuafolkken/kit#1570 wrote `decide` for — and the
	// five verdicts that legitimately leave a run at the gate (`not-a-lane`, `unready`, `busy`,
	// `failed`, `unknown`) all need the reissue to go through. A row that refused every time would wedge exactly
	// those runs; a row that refuses once cannot.
	//
	// **`pnpm josh rule:value` read this row with a ceiling of about 50%, and joshuafolkken/kit#1867 is
	// what removed it** (the ceiling was recorded here by joshuafolkken/kit#1864's review round 2). A
	// cut relaunches a *new session*, which the measurement groups as a run of its own, and that
	// resumed run issues the entry check — so scored on the asking alone it joined the denominator
	// while never being able to satisfy `keeps`, which only the cutting run can, and ten perfectly
	// obedient children read as ten kept out of twenty. **The two halves are separable, just not from
	// one call**: both processes issue byte-identical `--resume` strings, but the `fresh` verdict sends
	// a run on to claim the working-tree hold while the `resume` verdict tells its counterpart to skip
	// that claim. `reaches_the_pre_gate_boundary` is that conjunction, and it is why `CallTest` is
	// handed the run's calls beside the turn's rather than a second predicate slot of its own.
	// Dropping `reaches` altogether is still strictly worse — the trigger evaluates against the
	// *measuring* process's working directory, so it is always false from the main checkout and the row
	// would read as no runs at all.
	//
	// **It overlaps `piped-verification` on a piped gate call, and the order is safe in both
	// directions.** `pnpm josh gate | tail` in an uncut lane is a real instance of both defects; the
	// earlier row speaks, its own reason says to reissue, and this one delivers on the reissue — the
	// reading "the losing rule's delivery is still correct one call later" that the comment below
	// requires of any admissible overlap.
	{
		id: 'pre-gate-cut',
		is_trigger: on_bash_command(pre_gate_cut.is_uncut_gate),
		reason: pre_gate_cut.PRE_GATE_CUT_REASON,
		keeps: on_bash_command(pre_gate_cut.takes_the_cut),
		reaches: reaches_the_pre_gate_boundary,
	},
]

// A turn that issued more than this many calls is a turn that batched. The guard counts turns that
// issued a *single* tool call, so the boundary is the same one `SEQUENCE_BEFORE_LIMIT` is counted in.
const ALONE_IN_TURN = 1

// **Keeping the batching rule is a refusable call that went out beside siblings** — the one
// compliance test of the seven that cannot be read off the call alone (joshuafolkken/kit#1792). The
// guard's whole subject is the run of turns that each issued one call, so the act it asks for is a
// turn carrying more than one, and `is_guarded_call` is what keeps the credit to calls the guard
// could actually have refused: a turn of two `Write`s is not the rule being kept, because neither
// call was ever at risk.
function batches_the_turn(call: GuardedCall, turn: ReadonlyArray<GuardedCall>): boolean {
	return time_batch_guard.is_guarded_call(call) && turn.length > ALONE_IN_TURN
}

// **The row `pnpm josh rule:value` scores the batching guard from** (joshuafolkken/kit#1792). It is
// measured but not delivered, for the reason `MeasuredRule` states.
//
// **It declares no `is_trigger`, and that is the honest answer rather than a gap.** Whether a call
// would be refused depends on the turns *behind* it — `time_batch_guard.should_block` reads the
// transcript tail for exactly that — and `scripts/rules/rule-value.ts` hands a predicate one call at
// a time, so a call-shaped trigger here could only ever be a guess. What the transcript does record
// is the refusal itself, and the measurement takes that as the trigger: compliance credited after a
// refusal is the delivery's contribution, which is the same line every other row is scored on.
//
// **The `reaches` half is what keeps the reading off zero**, the failure joshuafolkken/kit#1643
// named. The batching guard fires only on the violation, so scored against its trigger the rate
// would be taken over runs that broke the rule at least once and would read near zero by
// construction — a manufactured retirement candidate for the most-cited resident rule there is. The
// occasion it governs is issuing a call the guard could refuse, in *either* spelling: alone in its
// turn, or beside the calls that did not need its result.
const BATCHING_RULE: MeasuredRule = {
	id: 'batching',
	reason: time_batch_guard.REASON,
	keeps: batches_the_turn,
	reaches: time_batch_guard.is_guarded_call,
}

// **The row `pnpm josh rule:value` scores the investigation guard from** (joshuafolkken/kit#1764).
// It is measured but not delivered, for exactly the reason the batching row is: `josh
// investigation:guard` has delivered it since joshuafolkken/kit#1460, and a row in `DELIVERED_RULES`
// would refuse the same violation a second time, each refusal spending a record the other cannot
// see. Until now it was the second delivered rule the measurement could not read at all — and the
// one whose subject, `investigation` at 35.9% of a run's turns, is the largest contributor any
// mechanism here addresses.
//
// **It declares no `is_trigger`, and that is honest rather than a gap.** Whether a read would be
// refused depends on the reads *behind* it — `investigation_reads.should_block` reads the transcript
// tail for exactly that — and the measurement hands a predicate one call at a time, so a call-shaped
// trigger could only be a guess. The refusal itself is what the transcript records, and
// `observe_error` takes that as the trigger.
//
// **`reaches` is the read the guard could have refused, not the refusal**, the distinction
// joshuafolkken/kit#1643 drew: scored against a trigger that fires only on the violation, the rate
// would be taken over runs that broke the rule at least once and would read near zero by
// construction.
//
// **It declares no `keeps` either, and the unmeasured cell is the honest answer rather than a gap.**
// The obvious predicate — a subagent dispatch — credits *any* dispatch, because that is what the
// guard's own reset does; a run that read twenty files in the main line, was never refused and sent
// one review agent at the end would score as full compliance. That row would sit near 100% for the
// rule this very Issue measures as let through on a third of all reads, and `pnpm josh rule:value` is
// what retirement decisions are read from. The module's own doctrine settles it: a rule with no
// `keeps` is reported unmeasured, because 0 and 1 are both claims the data does not make. **The
// compliance reading exists elsewhere and is better**: `pnpm josh time`'s `Investigation reads:`
// block, built from this same guard's predicates, says per run how much reading was refused, let
// through, or main-line by design. What this row adds is the reach and the delivery count, which is
// the continuous reading the guard had none of.
const INVESTIGATION_RULE: MeasuredRule = {
	id: 'investigation',
	reason: investigation_reads.REASON,
	reaches: investigation_reads.is_refusable_call,
}

// Every rule the measurement can score, delivery registry first so a printed table reads in
// enumeration order with the rows delivered from here at the top.
const MEASURED_RULES: ReadonlyArray<MeasuredRule> = [
	...DELIVERED_RULES,
	BATCHING_RULE,
	INVESTIGATION_RULE,
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
// **Both extras hang off `is_first_delivery`, and a row declares at most one.** `decide` is for a
// recurring rule (joshuafolkken/kit#1570); `already_satisfied` is for a once-per-run rule the run can
// satisfy earlier (joshuafolkken/kit#1905), where the earlier act stands the delivery down before the
// once-per-run record is spent. A row with neither takes `is_first_delivery` unchanged.
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
		if (decide === undefined) return is_first_delivery(tail, call, delivered_at_ms, run)

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
	MEASURED_RULES,
	PIPED_VERIFICATION_REASON: piped_verification.PIPED_VERIFICATION_REASON,
	PRE_GATE_CUT_REASON: pre_gate_cut.PRE_GATE_CUT_REASON,
	RUN_TAIL_REASON: run_tail.RUN_TAIL_REASON,
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

export type { DeliveredRule, MeasuredRule }
export { delivered_rules }
