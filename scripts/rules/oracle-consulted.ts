import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { bash_triggers } from './bash-triggers'
import { decision_oracle } from './decision-oracle'
import type { DeliveredRule } from './delivered-rules'
import { oracle_firing, type FiringPoint } from './oracle-firing'
import { shell_segments } from './shell-segments'
import { tail_commands } from './tail-commands'

// The one generic rule that turns a declared firing point into a delivered guard (joshuafolkken/kit#2324).
// `oracle-firing.ts` records, per oracle, the action that must consult it first; this generates a
// `DeliveredRule` for each such oracle — refused when the run performs the governed action without
// having run the oracle's command earlier, stood down once it has.
//
// **It is `issue-scout`'s shape, generalized.** Each generated row is once per run with an
// `already_satisfied` stand-down read off the tail — refuse the governed call, hand back the command,
// stand down once that command is on the tail. What `issue-scout` and `issue-fold` hand-wrote per
// oracle, this reads from the registry: the refusal is assembled from the oracle's decision, command,
// answer vocabulary and single source, so no oracle carries a hand-written refusal of its own. **No new
// delivery path** — the rows join `DELIVERED_RULES` and fire through the same `create_transcript_guard`
// shell every other row uses.

// One oracle entry, aliased so the generated rows' signatures stay under the line limit.
type Oracle = (typeof decision_oracle.DECISION_ORACLES)[number]

// The oracle's own command, the one act each generated rule asks for. Matched in either spelling by
// `is_josh_command`, which expands the alias before comparing.
function command_names(oracle: Oracle): ReadonlySet<string> {
	return new Set([decision_oracle.get_command(oracle)])
}

// Keeping the rule: a call that runs the oracle. Segment-wise, so a spelling quoted inside the governed
// call's own arguments is not read as the consultation it skipped.
function runs_the_oracle(command: string, names: ReadonlySet<string>): boolean {
	return shell_segments
		.segments_of(command)
		.some((segment) => shell_segments.is_josh_command(segment, names))
}

// The full `pnpm josh <command> <args>` string the refusal hands back, from the registry alone.
function command_line(oracle: Oracle): string {
	const command = decision_oracle.get_command(oracle)

	return oracle.args ? `pnpm josh ${command} ${oracle.args}` : `pnpm josh ${command}`
}

// The refusal, assembled from the registry so no oracle carries a hand-written one: what the call is
// doing, the decision it skipped, the command that answers it and the tokens that command emits, and
// the single source of the procedure.
function reason_for(oracle: Oracle, firing_point: FiringPoint): string {
	return (
		`⛔ decision oracle not consulted: this is ${firing_point.describes}, but the run has not run ` +
		`\`${command_line(oracle)}\` first — the oracle that decides ${oracle.decision.toLowerCase()}. ` +
		`It answers ${oracle.vocabulary.join(' | ')}; single source ${oracle.single_source}. Reissue ` +
		`after running it and reading its verdict. It fires once per run and cannot repeat on the call ` +
		`in hand.`
	)
}

function row_for(oracle: Oracle, firing_point: FiringPoint): DeliveredRule {
	const names = command_names(oracle)

	return {
		id: `oracle-consulted:${oracle.name}`,
		is_trigger: bash_triggers.on_bash_command(firing_point.governs),
		reason: reason_for(oracle, firing_point),
		already_satisfied: (tail: string, _call: GuardedCall): boolean =>
			tail_commands.prior_bash_commands(tail).some((command) => runs_the_oracle(command, names)),
		keeps: bash_triggers.on_bash_command((command: string) => runs_the_oracle(command, names)),
	}
}

// One row per oracle that declared a firing point, in registry order. Spread into `DELIVERED_RULES`
// after the filing rows, so a firing point that overlaps a filing (`issue:lint`) delivers on the
// reissue rather than ahead of `wip-cap` / `issue-scout`.
const ROWS: ReadonlyArray<DeliveredRule> = oracle_firing
	.firing_oracles()
	.map(({ oracle, firing_point }) => row_for(oracle, firing_point))

const oracle_consulted = { ROWS, command_line, reason_for, row_for, runs_the_oracle }

export { oracle_consulted }
