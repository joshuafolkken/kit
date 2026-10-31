import { lane_breakdown } from './lane-breakdown'
import type { Subagent, ToolCall } from './lane-transcript-calls'

// The calls behind a breakdown row (joshuafolkken/kit#5539): each row's calls grouped by what they ran,
// the longest three groups with their count and minutes — so an overrun investigation reads which
// `test:related`, which command or which review pass a row's minutes went to without the transcript.
//
// **A call's label is what it ran**: the josh command a Bash call names (`test:related`), else the
// command's first 60 characters past a leading `cd`; a review subagent's pass and level (`round 1 ·
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

interface CallGroup {
	label: string
	count: number
	ms: number
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

// Every josh command a Bash call chains, joined (`lint:related + test:related`), else its own words
// on one line, so a heredoc keeps the printout at one call group per line.
function command_label(command: string): string {
	const commands = [...command.matchAll(JOSH_COMMAND)].map((match) => match[1])
	const words = command.replace(LEADING_CD, '').replaceAll(WHITESPACE, ' ').trim()

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

function group_text(group: CallGroup): string {
	return `${group.label} ×${String(group.count)} ${lane_breakdown.minutes_text(group.ms)}`
}

const lane_breakdown_calls = { by_kind, group_text, label_of, top_of }

export { lane_breakdown_calls }
export type { CallGroup }
