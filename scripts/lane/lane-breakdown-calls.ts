import { command_memory } from '#scripts/gate/command-memory'
import { lint_related_scope } from '#scripts/lint/lint-related-scope'
import { lint_timing } from '#scripts/lint/lint-timing'
import { git_argv } from '#scripts/rules/git-argv'
import { shell_segments } from '#scripts/rules/shell-segments'
import { lane_breakdown } from './lane-breakdown'
import type { Subagent, ToolCall } from './lane-transcript-calls'

// The calls behind a breakdown row (joshuafolkken/kit#5539): each row's calls grouped by what they ran,
// the longest three groups with their count and minutes — so an overrun investigation reads which
// `test:related`, which command or which review pass a row's minutes went to without the transcript.
//
// **A call's label is what it ran**: the josh command a Bash call names (`test:related`), what a
// `reserved-run` wrapped (`reserved-run (eslint)`), else the command's first 60 characters past a
// leading `cd`; a review subagent's pass and level (`round 1 ·
// medium`, `interaction · medium`, `round 2 · low`); any other subagent's type; any other tool's name.

const TOP = 3
const LABEL_WIDTH = 60
const JOSH_COMMAND = /\bjosh ([\w:-]+)/gu
const CHAIN = ' + '
const LEADING_CD = /^cd \S+ && /u
const WHITESPACE = /\s+/gu
const ROUND_TWO_AGENT = 'reviewer-verification'
const ROUND_ONE_AGENT = 'reviewer'
const SEPARATOR = ' · '
const LINT_RELATED = 'lint:related'

interface CallGroup {
	label: string
	count: number
	ms: number
	// What the group's longest call said its seconds went on — the start to plan's `lint:related` alone.
	detail?: string | undefined
}

// A call and the milliseconds it counted under its row.
interface TimedCall {
	call: ToolCall
	ms: number
}

// A timed call and the row it counted under.
interface KindCall extends TimedCall {
	name: string
}

function josh_commands(command: string): Array<string | undefined> {
	return [...command.matchAll(JOSH_COMMAND)].map((match) => match[1])
}

// What a `josh reserved-run <weight> -- <command>` wrapped (joshuafolkken/kit#5653): the josh commands
// it names, else its program past a runner (`pnpm exec eslint …` is `eslint`) — so a lane's
// whole-repository eslint reads `reserved-run (eslint)`, not the bare wrapper.
function reserved_label(wrapped: string): string {
	const commands = josh_commands(wrapped)
	const program = git_argv.program_of(wrapped)?.name ?? ''

	return `reserved-run (${commands.length > 0 ? commands.join(CHAIN) : program})`
}

// The josh commands one command of a line names, a `reserved-run` as the one it wrapped.
function segment_labels(segment: string): Array<string | undefined> {
	const call = git_argv.program_of(segment)
	const wrapped = call === undefined ? undefined : command_memory.wrapped_command_of(call)

	return wrapped === undefined ? josh_commands(segment) : [reserved_label(wrapped)]
}

// Every josh command a Bash call chains, joined (`lint:related + test:related`), else its own words
// on one line, so a heredoc keeps the printout at one call group per line.
function command_label(command: string): string {
	const words = command.replace(LEADING_CD, '').replaceAll(WHITESPACE, ' ').trim()
	const commands = shell_segments
		.quote_aware_commands_of(words)
		.flatMap((segment) => segment_labels(segment))

	return commands.length > 0 ? commands.join(CHAIN) : words.slice(0, LABEL_WIDTH)
}

// The review pass a subagent call ran, `undefined` for a subagent that is not a reviewer.
function pass_of(subagent: Subagent): string | undefined {
	if (subagent.pass !== undefined) return subagent.pass
	if (subagent.type.endsWith(ROUND_TWO_AGENT)) return 'round 2'

	return subagent.type.endsWith(ROUND_ONE_AGENT) ? 'round 1' : undefined
}

function subagent_label(subagent: Subagent): string {
	const words = [pass_of(subagent), subagent.level].filter((word) => word !== undefined)

	return words.length > 0 ? words.join(SEPARATOR) : subagent.type
}

function label_of(call: ToolCall): string {
	if (call.command !== undefined) return command_label(call.command)
	if (call.subagent !== undefined) return subagent_label(call.subagent)

	return call.tool ?? ''
}

// The calls grouped by label, the longest `TOP` groups first.
function top_of(timed: ReadonlyArray<TimedCall>): Array<CallGroup> {
	const groups = new Map<string, CallGroup>()

	for (const { call, ms } of timed) {
		const label = label_of(call)
		const group = groups.get(label) ?? { label, count: 0, ms: 0 }

		groups.set(label, { label, count: group.count + 1, ms: group.ms + ms })
	}

	return [...groups.values()].toSorted((left, right) => right.ms - left.ms).slice(0, TOP)
}

// Each row's longest groups, by the row's name.
function by_kind(parts: ReadonlyArray<KindCall>): Map<string, Array<CallGroup>> {
	const names = new Set(parts.map((part) => part.name))

	return new Map(
		[...names].map((name) => [name, top_of(parts.filter((part) => part.name === name))]),
	)
}

function names_lint_related(label: string): boolean {
	return label.split(CHAIN).includes(LINT_RELATED)
}

// The timing line of the group's own longest call (`lint-timing.ts`).
function lint_detail(label: string, timed: ReadonlyArray<TimedCall>): string | undefined {
	const [longest] = timed
		.filter(({ call }) => label_of(call) === label)
		.toSorted((left, right) => right.ms - left.ms)

	return longest === undefined
		? undefined
		: lint_timing.detail_of(lint_related_scope.COMMAND_LABEL, longest.call.output)
}

// Each `lint:related` group with what its longest call spent its seconds on (joshuafolkken/kit#5712):
// a lane's first run is the outlier the start to plan is read for.
function with_lint_detail(
	groups: ReadonlyArray<CallGroup>,
	timed: ReadonlyArray<TimedCall>,
): Array<CallGroup> {
	return groups.map((group) =>
		names_lint_related(group.label) ? { ...group, detail: lint_detail(group.label, timed) } : group,
	)
}

function group_text(group: CallGroup): string {
	const text = `${group.label} ×${String(group.count)} ${lane_breakdown.minutes_text(group.ms)}`

	return group.detail === undefined ? text : `${text} (${group.detail})`
}

const lane_breakdown_calls = { by_kind, group_text, label_of, top_of, with_lint_detail }

export { lane_breakdown_calls }
export type { CallGroup }
