import { hook_decision } from '#scripts/josh/hook-decision'
import { z } from 'zod'
import { filing_offer } from './filing-offer'
import { issue_citation } from './issue-citation'

// The stop-time rules, delivered on the `Stop` hook (joshuafolkken/kit#2121, joshuafolkken/kit#2422,
// joshuafolkken/kit#2445).
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
// **Every rule refuses** (joshuafolkken/kit#2247). Missing the stop notification or leaving a hold
// on a clean tree costs a person a silent wait or a trampled tree; a bare `#N` in the reply reaches
// the person watching but not the model that could fix it, so it too blocks — `{"decision":"block"}`
// is the one channel a `Stop` hook has to the model, and `stop_hook_active` caps a false positive at a
// single wasted turn. The detection is tightened to match (`issue-citation.ts`, `filing-offer.ts`).

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
	// The `run:hold` record for this working tree is still in place (`held` or `stale`).
	hold_present: boolean
	// `git status --porcelain` came back empty.
	tree_clean: boolean
	// A `confirmation` notify is on this run's transcript tail.
	notified: boolean
	// The turn's session-facing reply text.
	message: string
	// This stop already forced a continuation earlier in the prompt — the loop-breaker Claude Code
	// documents, so a run that will not comply is not blocked forever.
	stop_hook_active: boolean
	// A pre-gate cut record is in place for this work tree. A dispatched lane child ends its turn at
	// the cut holding the tree by design and hands off to a fresh process (`pre-gate-cut.md`), so that
	// turn-end is an automatic continuation, not the person-waiting pause the block rules are for.
	cut_pending: boolean
	// An Issue filing no guard refused is on this run's transcript tail — `filing_cap`'s count.
	filed: boolean
	// The owner of the repository the session runs in, or `undefined` when it cannot be read.
	session_owner: string | undefined
	// This session is a headless `backlogrun` parent with lanes still in flight and no cut handed its
	// record off — `run-headless.ts` → `must_keep_waiting` (joshuafolkken/kit#2437).
	headless_waiting: boolean
	// How many headless-wait refusals sit on this run's transcript tail — the spin bound below.
	headless_refusals: number
	// This session is a dispatched lane child for this checkout — `lane_child_marker.is_child_of`.
	lane_child: boolean
}

interface StopOutcome {
	reason: string | undefined
}

const NO_OUTCOME: StopOutcome = { reason: undefined }

// **A mid-workflow stop is announced off-screen before it happens.** `CLAUDE.md` → "Mid-workflow stop
// notification" requires the `confirmation` Telegram before any pause; the hold is what says a run is
// mid-workflow, and the transcript is what says the notify was sent.
const STOP_NOTIFY_REASON =
	'⛔ mid-workflow stop notification: this working tree is still held by a run and no `confirmation` ' +
	'Telegram was sent this turn, so a person is being left to wait off-screen without knowing the run ' +
	'paused. `CLAUDE.md` → "Mid-workflow stop notification" requires ' +
	'`pnpm josh notify --task-type confirmation --issue-url "<url>" --body=$\'<reason>\'` before any ' +
	'mid-workflow pause. Send it, then end with a one-line confirmation that it was sent — do not repeat ' +
	'your previous reply. This fires only while the hold is held and no notify is on the transcript, and ' +
	'`stop_hook_active` lets a second stop through so a run is never wedged.'

// **A clean tree that still holds is a tree the next run will trample.** `SKILL.md` → §2f: a stop that
// leaves the tree clean releases the hold; a `halfrun` pre-commit stop and a `needs-human-review` stop
// keep it because their tree is dirty, which is why this row is silent whenever the tree is not clean.
const HOLD_RELEASE_REASON =
	'⛔ working-tree hold not released: this working tree is clean but its `run:hold` record is still in ' +
	'place, so the next run here runs `git switch main && git pull` believing the tree is free while ' +
	'you hold it. `.claude/skills/workflow-commands/SKILL.md` → §2f: a stop that leaves the tree clean ' +
	'releases the hold with `pnpm josh run:release <N>` (bare for a `new` entry). A `halfrun` ' +
	'pre-commit stop and a `needs-human-review` stop keep the hold because their tree is dirty — this ' +
	'row is silent there. Release it, then end with a one-line confirmation that it was released — do ' +
	'not repeat your previous reply.'

// **A refusal that corrects rather than advises** (joshuafolkken/kit#2247). The bare `#N` is already
// on screen and the hook cannot unsay it, so the reason does the one thing that helps the *next* reply:
// it names the numbers it detected and hands over the exact `issue:cite` call that prints the
// paste-ready lines, then asks for the corrected citation lines alone — not the whole reply reissued
// (joshuafolkken/kit#2329). Reprinting the whole reply is what made the correction read as a duplicate;
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

// **An offer to file is a Tier A filing deferred to the user** (joshuafolkken/kit#2422). The judgement
// is already made, so the reason hands over the filing chain rather than a question; the rule itself
// is resident in `SKILL.md` → §2i and only pointed at.
const FILING_OFFER_REASON =
	'⛔ filing offer: your reply offers to file an Issue instead of filing it. Filing into a ' +
	'first-party repository is Tier A — the trigger is the judgement that it is worth filing, not the ' +
	"run's progress (`.claude/skills/workflow-commands/SKILL.md` → §2i, `observation-filing.md`). Run " +
	'`pnpm josh issue:scout "<title>"`, file it, run `pnpm josh epic:bundle <new>`, then end with the ' +
	'one-line citation of what was filed — do not repeat your previous reply. If it is not worth filing ' +
	'after all, say so in one line instead.'

// **A headless parent's turn-end is its process's end** (joshuafolkken/kit#2437). Under `claude -p` the
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
// the refusal's own prose, which names the same commands, never matches.
const HEADLESS_WAIT_CALLS = ['"command":"pnpm josh lane:await', '"command":"pnpm josh run:progress']

const HEADLESS_WAIT_BODY =
	' this is a `claude -p` `backlogrun` parent (`JOSH_RUN_HEADLESS`) with lanes still ' +
	'in flight, and ending this turn ends the process — its background waits are killed with it and the ' +
	'lanes are left without a parent. Wait in the foreground instead: run `pnpm josh lane:await <N...>` ' +
	'for the in-flight lanes (and `pnpm josh run:progress --wait` for the heartbeat) as foreground ' +
	'commands within the tool timeout, act on what they report, and continue the loop. End the turn only ' +
	'after `pnpm josh run:carry --cut` or `--end` (`backlogrun-progress.md` → "The parent keeps no clock ' +
	'of its own").'

const HEADLESS_WAIT_REASON = `${HEADLESS_WAIT_MARKER}${HEADLESS_WAIT_BODY}`

// **A lane child never asks a person for the index** (joshuafolkken/kit#2445). The index rule protects
// a person's own staging, and a lane is a per-run work tree with none to protect; the sanctioned commit
// flow is already authorized, so the reason hands it over instead of letting the run wait on a person.
// Both halves must appear — an index command and a request for permission — so a report that merely
// names `git add` is not refused.
const INDEX_COMMAND_PATTERN = /git (?:add|stage|rm --cached|restore --staged|restore -S)\b/u
const PERMISSION_PATTERN = /許可|承認|permission|approve|approval|authorization/iu

const LANE_INDEX_REASON =
	'⛔ lane index permission: this is a dispatched lane child (`JOSH_LANE_CHILD`) and your reply asks ' +
	"a person for permission to change the git index. A lane is a per-run work tree with no person's " +
	'staging to protect, and the sanctioned commit flow is already authorized: remove any conflict ' +
	'markers, then run `pnpm josh git -y`, which stages and commits them — a conflicted merge included. ' +
	'This is Tier A (`.claude/skills/workflow-commands/chain-rule.md` → "origin/main is merged in before ' +
	'the gate"). Do it and continue the run — do not repeat your previous reply.'

function asks_index_permission(message: string): boolean {
	return INDEX_COMMAND_PATTERN.test(message) && PERMISSION_PATTERN.test(message)
}

function needs_index_route(context: StopContext): boolean {
	return context.lane_child && asks_index_permission(context.message)
}

function needs_filing(context: StopContext): boolean {
	if (context.filed || !filing_offer.offers_filing(context.message)) return false

	return filing_offer.is_first_party_target(context.message, context.session_owner)
}

function needs_notify(context: StopContext): boolean {
	return context.hold_present && !context.notified
}

function needs_release(context: StopContext): boolean {
	return context.hold_present && context.tree_clean
}

function citation_reason(message: string): string | undefined {
	const references = issue_citation.bare_references(message)
	if (references.length === 0) return undefined

	return build_citation_reason(references)
}

// The two rules that read the reply itself, filing offer first.
function reply_reason(context: StopContext): string | undefined {
	if (needs_filing(context)) return FILING_OFFER_REASON

	return citation_reason(context.message)
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

// The two hold rules, notify ahead of release — behind the lane index route (joshuafolkken/kit#2445),
// since the notify they would ask for announces a pause the run has no reason to take.
function hold_reason(context: StopContext): string | undefined {
	if (needs_index_route(context)) return LANE_INDEX_REASON
	if (needs_notify(context)) return STOP_NOTIFY_REASON
	if (needs_release(context)) return HOLD_RELEASE_REASON

	return undefined
}

// First-wins across every rule. Two things stand every rule down: `stop_hook_active` (the
// loop-breaker, so a run that already got one continuation this prompt may stop) and a pre-gate cut in
// flight (a lane child's automatic turn-end, not a person-waiting pause). The two hold rules keep their
// order ahead of the reply rules, so a stop that both still owes its notify and holds a bare `#N` still
// reports the notify first; the filing offer goes ahead of the citation, since the filing it forces
// produces the citation the reply then needs.
//
// **The headless wait comes first and outlasts `stop_hook_active` up to its spin bound** (joshuafolkken/kit#2437).
// The loop-breaker exists so a person is not wedged behind a rule the run will not satisfy; a headless
// parent has no person, and letting its second stop through is exactly the silent end the rule is for.
// Each continuation it forces is a foreground wait of minutes, and the rule falls silent by itself once
// the lanes finish or a cut hands the record off; refusals with no wait between them are bounded.
function block_reason(context: StopContext): string | undefined {
	if (is_headless_held(context)) return HEADLESS_WAIT_REASON
	if (context.stop_hook_active || context.cut_pending) return undefined

	return hold_reason(context) ?? reply_reason(context)
}

function stop_outcome(context: StopContext): StopOutcome {
	return { reason: block_reason(context) }
}

// The documented shape a `Stop` hook blocks with: `reason` is fed back to Claude, which then continues
// instead of stopping. Plain stdout is not it — only this envelope holds the stop.
function block_envelope(reason: string): string {
	return JSON.stringify({ decision: BLOCK_DECISION, reason })
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
	block_reason,
	count_headless_refusals,
	is_enabled,
	parse_stop_payload,
	stop_outcome,
}

export type { StopContext, StopOutcome }
export { stop_rules }
