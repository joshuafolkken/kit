import { interactive_ask } from '#scripts/agent/interactive-ask'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'

// A dispatched lane child's interactive ask is refused and routed to the park procedure, delivered at
// the call it binds on (joshuafolkken/kit#2201).
//
// **This is joshuafolkken/kit#2034's rule, moved one tool-call earlier.** #2034 gave a lane child that
// stops for a decision the right instruction — park the question on the Issue before it notifies — but
// wired it to the `confirmation` notify. A child that reaches for `AskUserQuestion` never gets that
// far: the ask is refused by the harness, the turn ends there, and #2034's guard never fires. Measured
// on 2026-09-20 inside `backlogrun #2163 --only`: #2178's child hit a Tier B branch, called
// `AskUserQuestion`, was refused, and died with the question stranded in its exit record's
// `permission_denials`. So the trigger is the ask itself, not the stop that a routed child would have
// reached afterward.
//
// **A hook denial is guidance, where the harness's own denial is death.** The harness refuses an
// interactive ask in a headless session by ending the turn; this rule refuses the same call with a
// `PreToolUse` deny, which returns to the model with the park procedure — so the refusal becomes an
// instruction the child can act on rather than the end of its run. That is the same shape
// `prompts/collaboration-workflow/rule-delivery.md` names: a rule whose trigger is one tool call is
// delivered by a hook that refuses it and states the rule.
//
// **It fires on every occurrence, not once per run.** An interactive ask must never succeed in a lane
// child, so refused-once-and-free-after would put the second ask back on the harness's fatal denial —
// the disposition `git-force.ts` takes for the same "must never happen" reason. The child's route is
// always the park, never a reissue of the ask.
//
// **The world is consulted after the tool name, never on every call.** `is_child_of` reads the
// dispatch mark against this checkout's own issue; the tool-name test runs first, so a run that never
// asks pays nothing for it, and a person working in a lane carries no mark and sees no refusal.

function is_interactive_ask(
	call: GuardedCall,
	is_lane_child: boolean = lane_child_marker.is_child_of(process.cwd()),
): boolean {
	if (!interactive_ask.is_interactive_tool(call.name)) return false

	return is_lane_child
}

// The instruction in the shape a refusal can carry: what the child cannot do, what to do instead, and
// the pointer to the procedure. **The park is named, not restated** — its single source is
// `backlogrun-park.md` → "park and continue", and a second copy here would be the clone `CLAUDE.md`
// prohibits. The one command is spelled so the child is not left to reconstruct it from a doc read.
const LANE_INTERACTIVE_ASK_REASON =
	'⛔ lane child interactive ask: this session is a dispatched lane child and cannot ask a person, so ' +
	'this call is refused. Left to run it would end the turn with nothing on the Issue — the parent then ' +
	'finds an OPEN Issue with `in-progress` and no question (joshuafolkken/kit#2201; joshuafolkken/kit#2034 ' +
	'placed the same rule one tool-call too late). Do not ask: park the decision instead. Apply ' +
	'`needs-decision` and post a comment carrying the question, the options and whether work was stashed — ' +
	"`gh api repos/{owner}/{repo}/issues/<N>/labels -f 'labels[]=needs-decision'` then " +
	'`pnpm josh issue:comment <N> --body-file <path>` — then send the ' +
	'`confirmation` Telegram and stop. The procedure is ' +
	'`.claude/skills/workflow-commands/pre-gate-cut.md` → "A lane child records its park before it stops", ' +
	'and the park itself is `backlogrun-park.md` → "park and continue". This rule fires on every ' +
	'occurrence, not once per run.'

// The row itself, so `delivered-rules.ts` spreads one entry. `decide` returns true so it refuses every
// occurrence; it declares no `keeps` — not asking is the absence of a call, not a call, so the row is
// reported unmeasured rather than scored on an act that does not exist (`git-force.ts`).
const ROW = {
	id: 'lane-interactive-ask',
	is_trigger: is_interactive_ask,
	reason: LANE_INTERACTIVE_ASK_REASON,
	decide: (): boolean => true,
}

const lane_interactive_ask = { LANE_INTERACTIVE_ASK_REASON, ROW, is_interactive_ask }

export { lane_interactive_ask }
