import { hook_decision } from '#scripts/josh/hook-decision'
import { z } from 'zod'
import { filing_offer } from './filing-offer'
import { issue_citation } from './issue-citation'
import { lane_background } from './lane-background'
import { reply_language } from './reply-language'

// The stop-time rules, delivered on the `Stop` hook.
//
// **It exists because `.claude/settings.json` wired no `Stop` event.** The four events it did wire
// (`SessionStart` / `UserPromptSubmit` / `PreToolUse` / `PostToolUse`) can catch the moment a call is
// about to run, but not the moment a run *stops* or *reports* — so three rules whose inputs are all
// mechanically readable could not be enforced structurally (`prompts/collaboration-workflow/rule-delivery.md`).
//
// **No second decision engine.** This loads on the same `hook_decision` foundation the PreToolUse
// guards share — the `.env` load and the switch — and reuses `lane-park`'s stop-notification judgement
// and `run:hold`'s record read rather than re-deriving either. What differs is only the event: a
// `Stop` payload has no tool call, and it blocks with `{"decision":"block"}` rather than a PreToolUse
// permission envelope. The stop guard is a second *entry* on the one foundation, exactly as
// `pretool-guard` is one — not a second copy of the plumbing.
//
// **A rule whose answer is fixed acts; only a rule that needs judgement refuses** (joshuafolkken/kit#3919).
// The stop notification, the hold release and the citation lines are each one mechanical operation the
// hook can run itself, so they come back as `actions` and the stop goes through: a refusal is a whole
// model turn spent re-reading the context to run a command the hook already knew. `stop-actions.ts`
// runs them, and only an action that fails falls back to its refusal. The rest — the reply's language,
// an unattended filing offer, a lane's index request or running task, a headless parent's wait — need
// the model, so they still block with `{"decision":"block"}`, the one channel a `Stop` hook has to it;
// `stop_hook_active` caps a false positive at a single wasted turn.

const SWITCH_ENV_KEY = 'JOSH_STOP_GUARD'
const BLOCK_DECISION = 'block'

// Only the fields the stop rules read. `last_assistant_message` is the turn's session-facing text —
// Claude Code hands it directly so the transcript's async lag is never in the citation path.
const stop_payload_schema = z.object({
	transcript_path: z.string().min(1),
	stop_hook_active: z.boolean().nullish(),
	last_assistant_message: z.string().nullish(),
})

type StopPayload = z.infer<typeof stop_payload_schema>

// What one stop looks like to the rules, computed once by the CLI from the payload and the world.
interface StopContext {
	// The Issue the `run:hold` record for this working tree names (`held` or `stale`) — `new` for an
	// unnumbered entry — or `undefined` when no record is in place.
	hold_issue: string | undefined
	// `git status --porcelain` came back empty.
	tree_clean: boolean
	// That record carries a `prrun` stop mark: the run stopped at a green pull
	// request and keeps the hold over a clean tree on purpose, so a person can look before it merges.
	prrun_stopped: boolean
	// A `confirmation` notify is on this run's transcript tail.
	notified: boolean
	// The turn's session-facing reply text.
	message: string
	// The person's last prompt — a `#N` it already carried is quoted, not cited.
	prompt: string
	// This stop already forced a continuation earlier in the prompt — the loop-breaker Claude Code
	// documents, so a run that will not comply is not blocked forever.
	stop_hook_active: boolean
	// This turn ended at a cut — its record is in place, or this turn relaunched the successor that may
	// already have cleared it (`stop-guard.ts` → `is_cut_stop`). A dispatched lane child ends its turn at
	// the cut holding the tree by design and hands off to a fresh process (`pre-gate-cut.md`), so that
	// turn-end is an automatic continuation, not the person-waiting pause the block rules are for.
	cut_pending: boolean
	// An Issue filing no guard refused is on this run's transcript tail — `filing_cap`'s count.
	filed: boolean
	// The owner of the repository the session runs in, or `undefined` when it cannot be read.
	session_owner: string | undefined
	// This session is a headless `backlogrun` parent with lanes still in flight and no cut handed its
	// record off — `run-headless.ts` → `must_keep_waiting`.
	headless_waiting: boolean
	// How many headless-wait refusals sit on this run's transcript tail — the spin bound below.
	headless_refusals: number
	// This session is a dispatched lane child for this checkout — `lane_child_marker.is_child_of`.
	lane_child: boolean
	// A background task this run launched — a command or a subagent — has not finished —
	// `lane_background.pending_background_ids` over the transcript tail.
	background_pending: boolean
	// A backgrounded subagent this run launched has not finished — `lane_background.pending_agent_ids`.
	// Apart from `background_pending`, since only a subagent is sure to end.
	agent_pending: boolean
	// This lane child handed its region to a running detached ship — `lane_handoff.is_handed_off`.
	// The supervisor notifies on its own outcome, so nobody waits on this stop.
	handed_off: boolean
	// The resolved `JOSH_SESSION_LANG` — `session_language.resolve_session_lang`.
	session_lang: string
	// This session is an agent kit launched under `claude -p` — `agent_headless.is_headless`.
	// No person reads its reply, so the rules on how a reply is written stand down.
	headless_agent: boolean
	// This session drives a live `backlogrun` carry record — `run_headless.is_backlog_parent`.
	// With `headless_agent` and `lane_child`, what makes a run unattended.
	backlog_parent: boolean
}

// The operations the hook runs itself instead of refusing — each carries what it acts on.
type StopAction =
	| { kind: 'notify'; issue: string; message: string }
	| { kind: 'release'; issue: string }
	| { kind: 'cite'; references: ReadonlyArray<string> }

// `reason` refuses the stop; otherwise `actions` run, and `blocks_on_failure` says whether a failed one
// falls back to its refusal — never past the loop-breaker.
interface StopOutcome {
	reason: string | undefined
	actions: ReadonlyArray<StopAction>
	blocks_on_failure: boolean
}

const NO_OUTCOME: StopOutcome = { reason: undefined, actions: [], blocks_on_failure: false }

// **A mid-workflow stop is announced off-screen before it happens.** `CLAUDE.md` → "Mid-workflow stop
// notification" requires the `confirmation` Telegram before any pause; the hold is what says a run is
// mid-workflow, and the transcript is what says the notify was sent. The hook sends it; this reason is
// only the fallback for a send that failed.
const STOP_NOTIFY_REASON =
	'⛔ mid-workflow stop notification: this working tree is still held by a run and no `confirmation` ' +
	'Telegram was sent this turn. Send ' +
	'`pnpm josh notify --task-type confirmation --issue-url "<url>" --body=$\'<reason>\' ' +
	'--recommended "<choice>" --alternative "<choice>"` (`CLAUDE.md` → "Mid-workflow stop ' +
	'notification"), then confirm in one line that it was sent — do not repeat your previous reply.'

// **A clean tree that still holds is a tree the next run will trample.** `working-tree-hold.md`: a stop that
// leaves the tree clean releases the hold; a `halfrun` pre-commit stop and a `needs-human-review` stop
// keep it because their tree is dirty, which is why this row is silent whenever the tree is not clean.
// The hook releases it; this reason is only the fallback for a release that failed.
const HOLD_RELEASE_REASON =
	'⛔ working-tree hold not released: this working tree is clean but its `run:hold` record is still in ' +
	'place. Release it with `pnpm josh run:release <N>` (bare for a `new` entry; ' +
	'`working-tree-hold.md`), then confirm in one line that it was released — do not repeat your ' +
	'previous reply.'

// **The fallback when the hook could not print the citation lines itself**. The bare `#N` is already
// on screen and the hook cannot unsay it, so the reason does the one thing that helps the *next* reply:
// it names the numbers it detected and hands over the exact `issue:cite` call that prints the
// paste-ready lines, then asks for the corrected citation lines alone — not the whole reply reissued.
// Reprinting the whole reply is what made the correction read as a duplicate;
// the bare copy already scrolled past stays, and the fix follows it as a short correction. The rule
// itself is not restated — it is resident in `CLAUDE.md` — only pointed at.
const ISSUE_CITATION_REASON =
	'Session-facing output cites an Issue as a number-link so the reader can click through and see ' +
	'which repository it is (`CLAUDE.md`, `prompts/collaboration-workflow/issue-citation.md`).'

function build_citation_reason(references: ReadonlyArray<string>): string {
	const numbers = references.join(', ')
	const command = `pnpm josh issue:cite ${issue_citation.cite_arguments(references).join(' ')}`

	return (
		`⛔ issue citation: your reply names an Issue as a bare \`#N\` (${numbers}). Run \`${command}\` ` +
		`to print the paste-ready citation lines, then print the corrected citation lines alone — do not ` +
		`repeat your previous reply. ${ISSUE_CITATION_REASON}`
	)
}

// **An offer to file in an unattended run is a Tier A filing deferred to nobody**.
// The judgement is already made, so the reason hands over the filing chain rather than a question; the
// rule itself is resident in `observation-filing.md` and only pointed at. **An interactive session asks
// first**: there the offer is the correct reply, so `needs_filing` is silent.
const FILING_OFFER_REASON =
	'⛔ filing offer: your reply offers to file an Issue instead of filing it, and this run is ' +
	'unattended — nobody is there to answer. Run ' +
	'`pnpm josh issue:file "<title>" --body-file <path> --depth <0|1|2>` (Tier A, ' +
	'`observation-filing.md`), then end with the one-line citation of what was filed; do not repeat ' +
	'your previous reply. If it is not worth filing after all, say so in one line instead.'

// **A headless parent's turn-end is its process's end**. Under `claude -p` the
// background waits die with the turn, so the lanes lose their parent and nothing re-invokes it. The
// reason hands over the foreground wait rather than a question, because there is nobody to answer one.
// The refusal's opening, which the transcript tail is counted by.
const HEADLESS_WAIT_MARKER = '⛔ headless parent:'

// Refusals with no foreground wait between them before the loop-breaker is honoured again. A parent
// that obeys runs a wait after each refusal, which resets the count; one that only re-stops piles them
// up. The bound lets that one end when "in flight" is a kept lane no child is working in
// (`backlogrun-park.md`), rather than spinning until the carry record expires.
const HEADLESS_REFUSAL_CAP = 3

// The foreground waits as they appear in a transcript's tool-call input — the JSON `command` field, so
// the refusal's own prose, which names the same commands, never matches. `run:progress --wait` is not
// one: it streams its reports and runs until work arrives, so it is started in
// the background, where it lives as long as the turn the foreground wait keeps open.
const HEADLESS_WAIT_CALLS = ['"command":"pnpm josh lane:await']

const HEADLESS_WAIT_BODY =
	' this is a `claude -p` `backlogrun` parent with lanes in flight, and ending this turn kills the ' +
	'process and its background waits. Hand the loop back with ' +
	'`pnpm josh run:carry --cut --owner "$PPID"` (or `--end` when the run is over), then end the turn ' +
	'(`backlogrun-progress.md`).'

const HEADLESS_WAIT_REASON = `${HEADLESS_WAIT_MARKER}${HEADLESS_WAIT_BODY}`

// **A lane child never asks a person for the index**. The index rule protects
// a person's own staging, and a lane is a per-run work tree with none to protect; the sanctioned commit
// flow is already authorized, so the reason hands it over instead of letting the run wait on a person.
// Both halves must appear — an index command and a request for permission — so a report that merely
// names `git add` is not refused.
const INDEX_COMMAND_PATTERN = /git (?:add|stage|rm --cached|restore --staged|restore -S)\b/u
const PERMISSION_PATTERN = /許可|承認|permission|approve|approval|authorization/iu

const LANE_INDEX_REASON =
	'⛔ lane index permission: this is a dispatched lane child (`JOSH_LANE_CHILD`) and your reply asks ' +
	'a person for permission to change the git index. That is Tier A here (`chain-rule.md`): remove any ' +
	'conflict markers, run `pnpm josh git -y` (it stages and commits, a conflicted merge included) and ' +
	'continue the run — do not repeat your previous reply.'

function asks_index_permission(message: string): boolean {
	return INDEX_COMMAND_PATTERN.test(message) && PERMISSION_PATTERN.test(message)
}

function needs_index_route(context: StopContext): boolean {
	return context.lane_child && asks_index_permission(context.message)
}

// **A refusal is the turn's only input, so it names the language the answer is written in**.
// The session-language line reaches a turn only through `UserPromptSubmit`;
// a turn this hook continues has no prompt, and an English refusal read alone was answered in English.
function language_note(lang: string): string {
	return (
		`Write your reply in the session language (JOSH_SESSION_LANG: ${lang}); code, commands and ` +
		'identifiers stay as they are.'
	)
}

// **A reply that drifted out of the session language is sent back once to be rewritten**.
// The drift persists — each turn matches the language of the one before — so
// the rewrite has to happen on the turn it starts; `stop_hook_active` bounds it to one.
function build_language_reason(lang: string): string {
	return (
		`⛔ session language: your reply is not written in the session language (JOSH_SESSION_LANG: ` +
		`${lang}). Rewrite it in that language and keep writing in it on the turns that follow, whatever ` +
		'language a notification, tool output or hook message was in (`CLAUDE.md` → "Output language").'
	)
}

function language_reason(context: StopContext): string | undefined {
	if (!reply_language.is_mismatch(context.message, context.session_lang)) return undefined

	return build_language_reason(context.session_lang)
}

// The sessions no person answers: one kit launched under `claude -p` (a lane child, a woken session), a
// dispatched lane child, or the `backlogrun` parent the user handed the backlog to.
function is_unattended(context: StopContext): boolean {
	return context.headless_agent || context.lane_child || context.backlog_parent
}

function needs_filing(context: StopContext): boolean {
	if (!is_unattended(context) || context.filed) return false

	return (
		filing_offer.offers_filing(context.message) &&
		filing_offer.is_first_party_target(context.message, context.session_owner)
	)
}

// **A running background subagent stands both hold rules down**. Its completion
// notice re-invokes the session, so the turn-end is a wait on the run's own work, not on a person — a
// notify there says "nothing needed" and dilutes the ones that do. A backgrounded command does not
// count: a dev server never ends, and a stop behind it would leave a person silently waiting. A lane
// child never reaches this with a task running: `needs_background_wait` answers it first.
//
// **A lane handed to the detached ship stands them down too**: the hold now
// belongs to the supervisor driving the merge, and the person hears from that supervisor's own notify.
function is_held_idle(context: StopContext): boolean {
	return context.hold_issue !== undefined && !context.agent_pending && !context.handed_off
}

function needs_notify(context: StopContext): boolean {
	return is_held_idle(context) && !context.notified
}

function needs_release(context: StopContext): boolean {
	return is_held_idle(context) && context.tree_clean && !context.prrun_stopped
}

// The bare references the citation lines are printed for. **A headless agent's reply has no reader**:
// its text lands in a stream-json log, so correcting its citations or its language costs a turn and
// reaches nobody. The artifacts a person does read — a Telegram, an Issue, a pull request — are held
// to the same rules by their own guards, not here.
function bare_references(context: StopContext): ReadonlyArray<string> {
	if (context.headless_agent) return []

	return issue_citation.unquoted_references(context.message, context.prompt)
}

// The two rules that read the reply and need the model, the filing offer first. A drifted reply
// refused for another reason is not rewritten, but the drift still ends: `block_envelope` appends the
// session-language note to every refusal, so the turn it continues is written in the session language.
function reply_reason(context: StopContext): string | undefined {
	if (needs_filing(context)) return FILING_OFFER_REASON
	if (context.headless_agent) return undefined

	return language_reason(context)
}

// The headless wait holds past the loop-breaker until the spin bound is reached.
function is_headless_held(context: StopContext): boolean {
	if (!context.headless_waiting) return false

	return !context.stop_hook_active || context.headless_refusals < HEADLESS_REFUSAL_CAP
}

// The headless-wait refusals on a transcript tail since the last foreground wait the parent ran — a
// wait is progress, so only refusals with none between them count toward the spin bound.
function count_headless_refusals(tail: string): number {
	const last_wait = Math.max(...HEADLESS_WAIT_CALLS.map((call) => tail.lastIndexOf(call)))

	return tail.slice(Math.max(last_wait, 0)).split(HEADLESS_WAIT_MARKER).length - 1
}

// **A lane child with a task still running is sent back to wait, not to notify**.
// Its turn-end kills the task, so the notify the hold rules would ask for announces a stop that loses
// the work; the #2606 child obeyed exactly that and its gate died at `exit code 143`.
function needs_background_wait(context: StopContext): boolean {
	return context.lane_child && context.background_pending
}

// The two lane rules that mean the run is not pausing at all — ahead of every action, since the notify
// would announce a pause the run has no reason to take.
function lane_reason(context: StopContext): string | undefined {
	if (needs_index_route(context)) return LANE_INDEX_REASON
	if (needs_background_wait(context)) return lane_background.LANE_BACKGROUND_STOP_REASON

	return undefined
}

function hold_actions(context: StopContext): Array<StopAction> {
	const issue = context.hold_issue
	if (issue === undefined) return []

	const notify: Array<StopAction> = needs_notify(context)
		? [{ kind: 'notify', issue, message: context.message }]
		: []

	return needs_release(context) ? [...notify, { kind: 'release', issue }] : notify
}

// The actions in the order they run: the notify ahead of the release that ends the hold it reports.
function stop_actions(context: StopContext): ReadonlyArray<StopAction> {
	const references = bare_references(context)
	const cite: Array<StopAction> = references.length > 0 ? [{ kind: 'cite', references }] : []

	return [...hold_actions(context), ...cite]
}

// First-wins across the refusals. `stop_hook_active` is the loop-breaker, so a run that already got one
// continuation this prompt may stop; the lane rules go first, then the filing offer, then the language.
//
// **The headless wait comes first and outlasts `stop_hook_active` up to its spin bound**.
// The loop-breaker exists so a person is not wedged behind a rule the run will not satisfy; a headless
// parent has no person, and letting its second stop through is exactly the silent end the rule is for.
// Each continuation it forces is a foreground wait of minutes, and the rule falls silent by itself once
// the lanes finish or a cut hands the record off; refusals with no wait between them are bounded.
function block_reason(context: StopContext): string | undefined {
	if (is_headless_held(context)) return HEADLESS_WAIT_REASON
	if (context.stop_hook_active || context.cut_pending) return undefined

	return lane_reason(context) ?? reply_reason(context)
}

// **The actions run only on the stop that goes through**, so a refused stop never notifies a pause its
// continuation then cancels, while the continuation's own stop, past the loop-breaker, still runs them
// and a failure there no longer refuses. A lane child still waiting on its own work runs none, and a
// pre-gate cut in flight stands everything but the headless wait down: it is a lane child's automatic
// turn-end, not a person-waiting pause.
function runs_actions(context: StopContext, reason: string | undefined): boolean {
	return reason === undefined && !context.cut_pending && lane_reason(context) === undefined
}

function stop_outcome(context: StopContext): StopOutcome {
	const reason = block_reason(context)
	if (!runs_actions(context, reason)) return { ...NO_OUTCOME, reason }

	const actions = stop_actions(context)
	if (actions.length === 0) return NO_OUTCOME

	return { reason, actions, blocks_on_failure: !context.stop_hook_active }
}

// The refusal an action falls back to when the hook could not run it.
function fallback_reason(action: StopAction): string {
	if (action.kind === 'notify') return STOP_NOTIFY_REASON
	if (action.kind === 'release') return HOLD_RELEASE_REASON

	return build_citation_reason(action.references)
}

// The documented shape a `Stop` hook blocks with: `reason` is fed back to Claude, which then continues
// instead of stopping. Plain stdout is not it — only this envelope holds the stop. Every reason leaves
// with the session-language note, so no rule can hand the model an English-only turn.
// `notice` is what the hook already did on this stop, shown to the person alongside.
function block_envelope(reason: string, lang: string, notice?: string): string {
	const refusal = { decision: BLOCK_DECISION, reason: `${reason} ${language_note(lang)}` }

	return JSON.stringify(notice === undefined ? refusal : { ...refusal, systemMessage: notice })
}

// The shape a `Stop` hook shows the person a line in without holding the stop: `systemMessage` alone.
function notice_envelope(notice: string): string {
	return JSON.stringify({ systemMessage: notice })
}

function parse_stop_payload(raw_payload: string): StopPayload | undefined {
	const parsed = stop_payload_schema.safeParse(JSON.parse(raw_payload))

	return parsed.success ? parsed.data : undefined
}

function is_enabled(): boolean {
	return hook_decision.is_switch_enabled(SWITCH_ENV_KEY)
}

const stop_rules = {
	FILING_OFFER_REASON,
	HEADLESS_REFUSAL_CAP,
	HEADLESS_WAIT_REASON,
	HOLD_RELEASE_REASON,
	ISSUE_CITATION_REASON,
	LANE_INDEX_REASON,
	NO_OUTCOME,
	STOP_NOTIFY_REASON,
	SWITCH_ENV_KEY,
	block_envelope,
	build_language_reason,
	count_headless_refusals,
	fallback_reason,
	is_enabled,
	notice_envelope,
	parse_stop_payload,
	stop_outcome,
}

export type { StopAction, StopContext, StopOutcome }
export { stop_rules }
