import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { json_value } from '#scripts/lib/json-value'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'

// A dispatched lane child's whole `Read` of a spilled Bash result is refused and pointed at a narrowed
// read (joshuafolkken/kit#5040).
//
// **The spill is the largest single result a cut session carries.** A Bash result over the harness cap
// is saved to `tool-results/<id>.txt` and previewed; reading that file back whole put 10,000–18,000
// characters into the context in one call, 10–40% of a cut session's tool results. A `grep` or
// `sed -n` over the same file reads only the lines the run needs.
//
// **Lane children only, every occurrence.** The cut that the context growth triggers is a lane
// child's; a person in an interactive session keeps the whole read. A paginated `Read` (an `offset` or
// a `limit`) is already narrowed and passes.

const SPILLED_RESULT = /\/tool-results\/[^/]+\.txt$/u

function read_input(call: GuardedCall): Record<string, unknown> | undefined {
	if (call.name !== 'Read' || !json_value.is_record(call.input)) return undefined

	return call.input
}

function reads_spilled_result(input: Record<string, unknown>): boolean {
	const { file_path } = input

	return typeof file_path === 'string' && SPILLED_RESULT.test(file_path)
}

function is_paginated(input: Record<string, unknown>): boolean {
	return input['offset'] !== undefined || input['limit'] !== undefined
}

// The occasion the rule governs: any `Read` of a spilled result, whole or narrowed.
function reaches_spilled_result(call: GuardedCall): boolean {
	const input = read_input(call)

	return input !== undefined && reads_spilled_result(input)
}

// Keeping the rule: the spilled result read with a page, never whole.
function keeps_narrowed_read(call: GuardedCall): boolean {
	const input = read_input(call)

	return input !== undefined && reads_spilled_result(input) && is_paginated(input)
}

function is_whole_spilled_read(
	call: GuardedCall,
	is_lane_child: boolean = lane_child_marker.is_child_of(process.cwd()),
): boolean {
	if (!reaches_spilled_result(call) || keeps_narrowed_read(call)) return false

	return is_lane_child
}

const LANE_SPILLED_READ_REASON =
	'⛔ lane child reading a spilled Bash result whole: `tool-results/<id>.txt` is the output that ' +
	'overflowed the cap, and reading it back whole fills the context the cut is measured on. Read only ' +
	'the lines you need: `grep -n <pattern> <path>` or `sed -n <from>,<to>p <path>`. ' +
	'Refused on every occurrence.'

// The row itself, so `delivered-rules.ts` spreads one entry; the shape is `lane-direct-tool.ts`'s, with
// the narrowed read as its compliance call.
const ROW = {
	id: 'lane-spilled-read',
	is_trigger: is_whole_spilled_read,
	reason: LANE_SPILLED_READ_REASON,
	decide: (): boolean => true,
	keeps: keeps_narrowed_read,
	reaches: reaches_spilled_result,
	about: {
		title: 'Lane child reading a spilled Bash result whole',
		topic: '`prompts/collaboration-workflow/output-bounds.md`',
		fires:
			"a dispatched lane child's `Read` of a `tool-results/<id>.txt` file with no `offset` or `limit`. Every occurrence",
		quiet: 'not a lane child, another file, or a paginated `Read`',
	},
}

const lane_spilled_read = {
	LANE_SPILLED_READ_REASON,
	ROW,
	is_whole_spilled_read,
	keeps_narrowed_read,
	reaches_spilled_result,
}

export { lane_spilled_read }
