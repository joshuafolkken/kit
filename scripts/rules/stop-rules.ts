import { hook_decision } from '#scripts/josh/hook-decision'
import { z } from 'zod'
import { issue_citation } from './issue-citation'

// The three stop-time rules, delivered on the `Stop` hook (joshuafolkken/kit#2121).
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
// **Two rules refuse, one only notices.** Missing the stop notification or leaving a hold on a clean
// tree costs a person a silent wait or a trampled tree, so those block the stop. A bare `#N` in the
// reply is a citation slip a false positive would punish more than the slip itself, so it is a notice
// and the stop proceeds.

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
}

interface StopOutcome {
	reason: string | undefined
	notice: string | undefined
}

const NO_OUTCOME: StopOutcome = { reason: undefined, notice: undefined }

// **A mid-workflow stop is announced off-screen before it happens.** `CLAUDE.md` → "Mid-workflow stop
// notification" requires the `confirmation` Telegram before any pause; the hold is what says a run is
// mid-workflow, and the transcript is what says the notify was sent.
const STOP_NOTIFY_REASON =
	'⛔ mid-workflow stop notification: this working tree is still held by a run and no `confirmation` ' +
	'Telegram was sent this turn, so a person is being left to wait off-screen without knowing the run ' +
	'paused. `CLAUDE.md` → "Mid-workflow stop notification" requires ' +
	'`pnpm josh notify --task-type confirmation --issue-url "<url>" --body=$\'<reason>\'` before any ' +
	'mid-workflow pause. Send it, then stop again — this fires only while the hold is held and no ' +
	'notify is on the transcript, and `stop_hook_active` lets a second stop through so a run is never ' +
	'wedged.'

// **A clean tree that still holds is a tree the next run will trample.** `SKILL.md` → §2f: a stop that
// leaves the tree clean releases the hold; a `halfrun` pre-commit stop and a `needs-human-review` stop
// keep it because their tree is dirty, which is why this row is silent whenever the tree is not clean.
const HOLD_RELEASE_REASON =
	'⛔ working-tree hold not released: this working tree is clean but its `run:hold` record is still in ' +
	'place, so the next run here runs `git switch main && git pull` believing the tree is free while ' +
	'you hold it. `.claude/skills/workflow-commands/SKILL.md` → §2f: a stop that leaves the tree clean ' +
	'releases the hold with `pnpm josh run:release <N>` (bare for a `new` entry). A `halfrun` ' +
	'pre-commit stop and a `needs-human-review` stop keep the hold because their tree is dirty — this ' +
	'row is silent there. Release it, then stop again.'

// **A citation slip, not a refusal.** The stop proceeds; the notice reaches the person watching.
const ISSUE_CITATION_NOTICE =
	'ℹ issue citation: your reply names an Issue as a bare `#N`. Session-facing output cites it as a ' +
	'number-link — `[#<N>](https://github.com/<owner>/<repo>/issues/<N>) — <短い要約>` (`CLAUDE.md`, ' +
	'`prompts/collaboration-workflow/issue-citation.md`), so the reader can click through and see which ' +
	'repository it is. This is a notice only; the stop proceeds.'

function needs_notify(context: StopContext): boolean {
	return context.hold_present && !context.notified
}

function needs_release(context: StopContext): boolean {
	return context.hold_present && context.tree_clean
}

// The block half, first-wins. Two things stand both rules down: `stop_hook_active` (the loop-breaker,
// so a run that already got one continuation this prompt may stop) and a pre-gate cut in flight (a
// lane child's automatic turn-end, not a person-waiting pause).
function block_reason(context: StopContext): string | undefined {
	if (context.stop_hook_active || context.cut_pending) return undefined
	if (needs_notify(context)) return STOP_NOTIFY_REASON
	if (needs_release(context)) return HOLD_RELEASE_REASON

	return undefined
}

function notice_text(context: StopContext): string | undefined {
	return issue_citation.has_bare_reference(context.message) ? ISSUE_CITATION_NOTICE : undefined
}

// The block path decides first; the notice is asked only when nothing blocks, so a refused stop never
// also carries a citation notice about a reply the run has not finished.
function stop_outcome(context: StopContext): StopOutcome {
	const reason = block_reason(context)

	if (reason !== undefined) return { reason, notice: undefined }

	return { reason: undefined, notice: notice_text(context) }
}

// The documented shape a `Stop` hook blocks with: `reason` is fed back to Claude, which then continues
// instead of stopping. Plain stdout is not it — only this envelope holds the stop.
function block_envelope(reason: string): string {
	return JSON.stringify({ decision: BLOCK_DECISION, reason })
}

// A non-blocking notice: the stop proceeds and `systemMessage` is what the person watching sees.
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
	HOLD_RELEASE_REASON,
	ISSUE_CITATION_NOTICE,
	NO_OUTCOME,
	STOP_NOTIFY_REASON,
	SWITCH_ENV_KEY,
	block_envelope,
	block_reason,
	is_enabled,
	notice_envelope,
	notice_text,
	parse_stop_payload,
	stop_outcome,
}

export type { StopContext, StopOutcome, StopPayload }
export { stop_rules }
