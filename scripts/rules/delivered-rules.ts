import { cost_blocks } from '#scripts/cost/cost-blocks'
import { hook_decision } from '#scripts/josh/hook-decision'
import { ALIASES } from '#scripts/josh/josh-command-map'
import { time_batch_guard, type GuardedCall } from '#scripts/time/time-batch-guard'
import { time_shell } from '#scripts/time/time-shell'

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
// not. Every rule enumerated here is therefore one whose binding moment is a shell call.
function bash_call_matching(call: GuardedCall, is_match: (command: string) => boolean): boolean {
	if (call.name !== cost_blocks.BASH_TOOL) return false

	return is_match(time_shell.bash_command(call.input))
}

function is_filing_call(call: GuardedCall): boolean {
	return bash_call_matching(call, is_issue_filing)
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

// The josh subcommands whose result means pass or fail — the whole reach of the rule below, and no
// more (joshuafolkken/kit#1556). **The read-only answers are absent deliberately.** `eval:scope`,
// `latest:scope`, `review:level`, `review:brief` and `issue:state` print an answer rather than a
// verdict, and `git log | head` or `gh issue list | head` are not josh calls at all — narrowing a
// listing is the ordinary way to read one. A trigger wide enough to reach those would refuse on the
// commonest shape in the transcript, and this file's own rule is that a hook firing on the wrong turn
// is worse than no hook.
//
// **Two more kinds are out, and for reasons rather than by omission.** `pre-commit-type-check` and
// `pre-push-unit` are run by lefthook rather than typed by anyone, so no call of theirs is ever
// composed here; and `e2e:retry-check` *reports* whether the preview server crashed rather than
// passing or failing on it, which puts it with the answers above.
const VERIFICATION_COMMANDS: ReadonlySet<string> = new Set([
	'check',
	'cspell',
	'cspell:dot',
	'eval',
	'gate',
	'lint',
	'lint:eslint',
	'lint:prettier',
	'lint:related',
	'overrides',
	'ranges',
	'test',
	'test:e2e',
	'test:related',
	'test:unit',
])

// Both spellings of each check, **derived from the alias table rather than restated beside it**: a
// second copy of the aliases stops matching the first time one is renamed, and `pnpm josh ga | tail`
// masks a gate exactly as the long spelling does.
const VERIFICATION_NAMES: ReadonlySet<string> = new Set([
	...VERIFICATION_COMMANDS,
	...Object.entries(ALIASES)
		.filter(([, name]) => VERIFICATION_COMMANDS.has(name))
		.map(([alias]) => alias),
])

function is_verification_command(segment: string): boolean {
	const named = time_shell.josh_command_of(segment)

	if (!named.startsWith(time_shell.JOSH_PREFIX)) return false

	return VERIFICATION_NAMES.has(named.slice(time_shell.JOSH_PREFIX.length))
}

// A pipeline reports its last command's status, so a check in any earlier segment has its verdict
// thrown away. `time_shell.discarded_commands` is what decides which segments those are — the shell
// reading is one rule kept in one place, not a second parser written here.
function is_masked_verification(command: string): boolean {
	return time_shell.discarded_commands(command).some((segment) => is_verification_command(segment))
}

function is_masking_call(call: GuardedCall): boolean {
	return bash_call_matching(call, is_masked_verification)
}

// The masking, the two ways out of it and the boundary, in the shape a refusal can carry
// (joshuafolkken/kit#1556). **The way out travels with the refusal rather than being named**, because
// a delivery saying only "do not pipe it" leaves the caller with the same long output and no
// sanctioned way to read it, which is what put the pipe there in the first place.
const PIPED_VERIFICATION_REASON =
	"⛔ piped verification: a pipeline exits with its last command's status, so `pnpm josh gate | " +
	'tail` reports success on a gate that failed, and the verdict is discarded before anything reads ' +
	'it. Run the check without the pipe — josh prints its verdict line last, so the harness output cap ' +
	'keeps it even when the middle is elided. Where the output genuinely has to be narrowed, redirect ' +
	'it to a file and read ranges from that file, or prefix `set -o pipefail` so the pipeline carries ' +
	"the check's status. Read the printed verdict either way, never the exit code alone. Read-only " +
	'listings are untouched — this fires only on a command whose result means pass or fail. The rule ' +
	'is in `prompts/collaboration-workflow/output-bounds.md`. Reissue this call with no pipe — it ' +
	'fires once per run and cannot repeat on the call in hand.'

// **The two triggers are disjoint.** Filing is a `gh` call with a title field and no pipe; masking is
// a josh check standing before one. The single overlap a reader can construct — a check piped *into*
// `gh issue create` — is not a shape anything writes, and `wip-cap` leading the list is the safe way
// round it: the filing cap is the more consequential of the two to lose.
const DELIVERED_RULES: ReadonlyArray<DeliveredRule> = [
	{ id: 'wip-cap', is_trigger: is_filing_call, reason: WIP_CAP_REASON },
	{ id: 'piped-verification', is_trigger: is_masking_call, reason: PIPED_VERIFICATION_REASON },
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
// **Inert for today's only row, and deliberately kept.** The batching guard does not treat a filing
// call as a candidate at all, so the branch never fires for `wip-cap`; `delivered-rules.test.ts`
// pins that invariant, and it is what any new row has to be re-checked against. Erring toward
// standing aside costs at most one call's delay, while erring the other way costs the rule for the
// whole run.
function is_first_delivery(tail: string, call: GuardedCall, delivered_at_ms: number): boolean {
	if (delivered_at_ms !== hook_decision.NEVER_MS) return false

	return !time_batch_guard.should_block(tail, call, hook_decision.NEVER_MS)
}

function guard_of(rule: DeliveredRule): ReturnType<typeof hook_decision.create_transcript_guard> {
	return hook_decision.create_transcript_guard({
		prefix: `${STAMP_PREFIX}${rule.id}-`,
		switch_key: SWITCH_ENV_KEY,
		is_candidate: rule.is_trigger,
		should_block: is_first_delivery,
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
// this run falls through and a later rule may speak on the same call. With one entry that cannot
// happen; with the second row this file is built for it would be a mis-delivery, so a rule added
// here has to be one whose trigger no other row also matches.
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
	PIPED_VERIFICATION_REASON,
	SWITCH_ENV_KEY,
	WIP_CAP_REASON,
	delivery,
	delivery_path,
	is_enabled,
	is_issue_filing,
	is_masked_verification,
}

export type { DeliveredRule }
export { delivered_rules }
