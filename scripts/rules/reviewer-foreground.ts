import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { json_value } from '#scripts/lib/json-value'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { agent_model } from './agent-model'

// A lane child's `reviewer` dispatched without `run_in_background: false` is run in the foreground
// instead (joshuafolkken/kit#5154).
//
// **A headless child's turn end kills a background reviewer**, so `chain-rule.md` → "A lane child" says
// not to background it. The subagent tool launches in the background by default, and 23 of 178 lanes
// did: #5129 polled the output file in a `sleep` loop, then waited again on `run:review --join`.
//
// **The fix is the same call with one field, so the hook makes it** (`guard-remedy.ts`): no round trip,
// and a build whose tool declares no `run_in_background` drops the added field as it drops the typed
// one. Lane children only — an interactive turn is re-invoked by the background result.

// `kit:reviewer` is the consumer's spelling of the same definitions.
const REVIEWER_AGENTS: ReadonlySet<string> = new Set(['reviewer', 'reviewer-verification'])

const BACKGROUND_FIELD = 'run_in_background'

const CHAIN_RULE_STEP = '`.claude/skills/workflow-commands/chain-rule.md` → "A lane child"'

const KILLED = 'reviewer foreground: a lane child’s turn end kills a background `reviewer`'
const FOREGROUND = `\`${BACKGROUND_FIELD}: false\``

const REVIEWER_FOREGROUND_NOTE = `↻ ${KILLED}, so the call ran with ${FOREGROUND} (${CHAIN_RULE_STEP}).`

// Delivered only where the rewrite cannot reach the call.
const REVIEWER_FOREGROUND_REASON = `⛔ ${KILLED}. Reissue the call with ${FOREGROUND} (${CHAIN_RULE_STEP}). It fires on every occurrence.`

function is_reviewer(call: GuardedCall): boolean {
	if (!agent_model.SUBAGENT_TOOLS.has(call.name) || !json_value.is_record(call.input)) return false

	const type = call.input['subagent_type']

	return typeof type === 'string' && REVIEWER_AGENTS.has(type.split(':').at(-1) ?? '')
}

function is_foreground(call: GuardedCall): boolean {
	return json_value.is_record(call.input) && call.input[BACKGROUND_FIELD] === false
}

function is_background_reviewer(
	call: GuardedCall,
	is_lane_child: boolean = lane_child_marker.is_child_of(process.cwd()),
): boolean {
	return is_lane_child && is_reviewer(call) && !is_foreground(call)
}

function foreground_input(
	call: GuardedCall,
	is_lane_child: boolean = lane_child_marker.is_child_of(process.cwd()),
): Record<string, unknown> | undefined {
	if (!is_background_reviewer(call, is_lane_child) || !json_value.is_record(call.input)) {
		return undefined
	}

	return { ...call.input, [BACKGROUND_FIELD]: false }
}

const ROW = {
	id: 'reviewer-foreground',
	is_trigger: (call: GuardedCall): boolean => is_background_reviewer(call),
	reason: REVIEWER_FOREGROUND_REASON,
	decide: (): boolean => true,
	keeps: (call: GuardedCall): boolean => is_reviewer(call) && is_foreground(call),
	reaches: is_reviewer,
	rewrite: (call: GuardedCall): Record<string, unknown> | undefined => foreground_input(call),
	rewrite_note: REVIEWER_FOREGROUND_NOTE,
	about: {
		title: 'Lane child reviewer dispatched in the foreground',
		topic: CHAIN_RULE_STEP,
		fires:
			'a dispatched lane child’s `Agent` / `Task` call of the `reviewer` or `reviewer-verification` type without `run_in_background: false` — rewritten with it, every occurrence',
		quiet: 'not a lane child, another agent type, or `run_in_background: false` set',
	},
}

const reviewer_foreground = {
	REVIEWER_FOREGROUND_NOTE,
	REVIEWER_FOREGROUND_REASON,
	ROW,
	foreground_input,
	is_background_reviewer,
}

export { reviewer_foreground }
