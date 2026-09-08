import { cost_blocks } from '#scripts/cost/cost-blocks'
import { hook_decision } from '#scripts/josh/hook-decision'
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
function is_filing_call(call: GuardedCall): boolean {
	if (call.name !== cost_blocks.BASH_TOOL) return false

	return is_issue_filing(time_shell.bash_command(call.input))
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

// A body handed to a command as an inline double-quoted argument, in the spellings a run reaches for:
// `gh`'s field flags (`-f` / `-F` / `--field` / `--raw-field` with `body=`), `gh`'s own `--body`, and
// `josh`'s `--body` and `--notify-message`. The value is captured so the decision can be made on what
// the body actually contains rather than on the flag alone.
//
// **`-b` is deliberately absent.** It is `gh`'s short `--body`, but it is also `git checkout -b`, and
// a branch name is not a body — covering it would refuse calls where nothing is wrong. The `*-file`
// spellings end in `-` where this pattern needs whitespace or `=`, so `--body-file <path>` and
// `--notify-message-file <path>` cannot match it.
const INLINE_BODY_VALUE =
	/(?:(?:-f|-F|--field|--raw-field)\s*'?body=|(?:--body|--notify-message)[\s=]+)"((?:[^"\\]|\\.)*)"/gu

// **What zsh evaluates inside double quotes, measured in this harness rather than assumed**
// (joshuafolkken/kit#1198): a backtick runs as command substitution and a `$` expands. `!` does
// **not** — history expansion is off in a non-interactive zsh, and `"hello!world"` survives intact —
// so it is deliberately absent: a rule that fired on every exclamation mark would be firing on turns
// where nothing is wrong, which `prompts/collaboration-workflow/rule-delivery.md` names as worse than
// no hook at all.
const SHELL_EVALUATED = /[`$]/u

// **The one exemption: a body that is *entirely* one command substitution.** `body="$(cat <path>)"`
// is the rule already being kept — the substitution's output is not re-scanned by the shell, so a
// body full of backticks reaches the command byte for byte, and refusing it would spend the run's one
// delivery on a caller who had already moved the body into a file.
//
// **It is anchored to the whole value, not to the `$(` alone.** Excusing `$(` anywhere would let
// `body="Result: run $(git log -1) to confirm"` through, and that one really is evaluated: the
// substitution replaces the text and the command runs. The trade-off of anchoring is a delivery that
// arrives on a safe call, which costs one reissue; the trade-off of not anchoring is a rule that
// never fires on the case it exists for.
const WHOLE_VALUE_SUBSTITUTION = /^\$\([^()]*\)$/u

// A backslash escape makes the next character literal inside double quotes, so `\$` and `` \` `` are
// safe. They are dropped before the test rather than excluded from it, which is the same thing in one
// pass and keeps `SHELL_EVALUATED` readable.
const ESCAPED_PAIR = /\\./gu

// **The trigger is the body's content, not the flag.** Every worked example in this repository's
// prompts passes a placeholder (`-f body="<plan>"`), which is inert; the moment a real body carrying
// a backtick is substituted in, the call becomes the one that executes text. Keying on the flag would
// refuse the inert examples too — firing on turns where the rule is already being kept.
function is_evaluated_value(raw_value: string): boolean {
	const literal = raw_value.replaceAll(ESCAPED_PAIR, '')

	if (WHOLE_VALUE_SUBSTITUTION.test(literal)) return false

	return SHELL_EVALUATED.test(literal)
}

function is_shell_evaluated_body(command: string): boolean {
	for (const match of command.matchAll(INLINE_BODY_VALUE)) {
		if (is_evaluated_value(match[1] ?? '')) return true
	}

	return false
}

function is_inline_body_call(call: GuardedCall): boolean {
	if (call.name !== cost_blocks.BASH_TOOL) return false

	return is_shell_evaluated_body(time_shell.bash_command(call.input))
}

// The instruction in the shape a refusal can carry: what the shell is about to do, the four safe
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
	{ id: 'wip-cap', is_trigger: is_filing_call, reason: WIP_CAP_REASON },
	{ id: 'shell-body', is_trigger: is_inline_body_call, reason: SHELL_BODY_REASON },
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
// this run falls through and a later rule may speak on the same call.
//
// **The two rows can both match one call, and the order is the answer rather than a defect**
// (joshuafolkken/kit#1198). A `gh api …/issues -f title="…" -f body="… \`x\` …"` is a filing *and* an
// inline body. `wip-cap` is listed first because it decides whether the Issue should exist at all,
// and a body rewritten into a file for an Issue that must not be filed is wasted work. Nothing is
// lost by losing the race: the stamps are keyed per `id`, so the reissued call is delivered the
// second rule. A row whose trigger overlaps an existing one is therefore admissible only when this
// same reading holds — that its delivery is still correct one call later.
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
	SHELL_BODY_REASON,
	SWITCH_ENV_KEY,
	WIP_CAP_REASON,
	delivery,
	delivery_path,
	is_enabled,
	is_issue_filing,
	is_shell_evaluated_body,
}

export type { DeliveredRule }
export { delivered_rules }
