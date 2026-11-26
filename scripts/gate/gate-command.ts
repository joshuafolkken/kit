import { GATE_COMMAND } from '#scripts/josh/josh-command-types'
import { composite_arguments } from '#scripts/josh/josh-composite-arguments'
import { cli_flags } from '#scripts/lib/cli-flags'
import { gate_skip } from './gate-skip'
import { gate_static_group } from './gate-static-group'
import { GATE_TARGETS, verification_gate, type GateOptions } from './verification-gate'
import { whole_tree_reuse } from './whole-tree-reuse'

// The `josh gate` argument reading, kept apart from `verification-gate.ts` so the gate itself has
// room for what it runs (joshuafolkken/kit#8844).
//
// `josh gate` fans out to four sub-commands and forwards nothing to them, so an appended flag
// would vanish exactly the way it does behind an `sh -c` composite — a run that looks configured
// and is not. The composite guard only inspects `shell` entries, so a `script` entry that fans out
// has to refuse for itself; the message comes from that guard so the two read identically.
// `--verbose` and `--force` are consumed here rather than forwarded, which is why they do not fall
// foul of the refusal above: the refusal exists because a forwarded flag vanishes into the
// sub-commands, and a flag the gate reads itself never reaches them. Every other argument is still
// refused.
const VERBOSE_FLAG = '--verbose'
// Read here and never forwarded, exactly as the two above are: it selects which sub-commands the
// gate fans out to rather than being passed to one of them.
const NO_UNIT_FLAG = '--no-unit'
// `--whole-tree`: the ship's gate adds the whole-tree checks to the full set (`whole-tree-reuse.ts`).
const { WHOLE_TREE_FLAG } = whole_tree_reuse
const ACCEPTED_FLAGS: ReadonlyArray<string> = [
	VERBOSE_FLAG,
	gate_skip.FORCE_FLAG,
	NO_UNIT_FLAG,
	WHOLE_TREE_FLAG,
]

// The flags are the caller's, the destinations are the run's, so the two are merged here rather than
// letting an option override a flag the user typed.
function unknown_arguments(extra_arguments: ReadonlyArray<string>): ReadonlyArray<string> {
	return extra_arguments.filter(
		(argument) =>
			!ACCEPTED_FLAGS.includes(argument) && gate_static_group.group_of(argument) === undefined,
	)
}

// The shared refusal, plus the arguments it is actually about — or, on `--help`, the usage. Some flags
// are accepted, so the bare "takes no extra arguments" would send a reader to drop the ones that work.
// The list is interpolated rather than spelled out here, so adding a flag cannot leave this line stale.
function refuse(extra_arguments: ReadonlyArray<string>, unknown: ReadonlyArray<string>): number {
	const groups = Object.keys(gate_static_group.STATIC_GROUPS).join('|')
	const accepted = [...ACCEPTED_FLAGS, `${gate_static_group.STATIC_GROUP_FLAG_PREFIX}<${groups}>`]
	const refusal =
		`${composite_arguments.format_rejection(GATE_COMMAND, GATE_TARGETS)}\n` +
		`  refused: ${unknown.join(' ')}\n  accepted here: ${accepted.join(' ')}`
	const usage = cli_flags.usage_line(accepted, GATE_COMMAND)

	return cli_flags.answer_usage(extra_arguments, usage, refusal)
}

async function run_gate_command(
	extra_arguments: ReadonlyArray<string>,
	options: GateOptions = {},
): Promise<number> {
	const unknown = unknown_arguments(extra_arguments)

	if (unknown.length > 0) return refuse(extra_arguments, unknown)

	// A `--static-group` is a part of the static set, so it implies `--no-unit` and every withholding that flag carries.
	const static_group = gate_static_group.find_group(extra_arguments)
	const is_unit_included = !extra_arguments.includes(NO_UNIT_FLAG) && static_group === undefined

	return await verification_gate.run_verification_gate({
		is_scoped_enforced: true,
		...options,
		is_verbose: extra_arguments.includes(VERBOSE_FLAG),
		is_forced: extra_arguments.includes(gate_skip.FORCE_FLAG),
		is_unit_included,
		is_whole_tree_included: !is_unit_included || extra_arguments.includes(WHOLE_TREE_FLAG),
		static_group,
	})
}

const gate_command = {
	ACCEPTED_FLAGS,
	NO_UNIT_FLAG,
	VERBOSE_FLAG,
	WHOLE_TREE_FLAG,
	run_gate_command,
}

export { gate_command }
