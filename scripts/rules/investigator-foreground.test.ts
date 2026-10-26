import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { delegation_policy } from '#scripts/delegation/delegation-policy'
import type { GuardRun } from '#scripts/josh/hook-decision'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { afterAll, describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { investigator_foreground } from './investigator-foreground'

// joshuafolkken/kit#4721: a background `investigator` leaves its result queued until a later turn, so
// the row refuses that dispatch until it sets `run_in_background: false`. **Both directions matter**:
// a row silent on the background launch leaves the idle wait where it was, and one that speaks on a
// foreground dispatch or another agent type refuses a call that already did the right thing.

const PROMPT = 'Find where the guard reads the transcript'
const OTHER_PROMPT = 'Other work'
const INVESTIGATOR = 'investigator'
const GENERAL_PURPOSE = 'general-purpose'
const FOREGROUND_FIELD = '`run_in_background: false`'

function agent_call(
	input: Record<string, unknown>,
	name = 'Agent',
): { name: string; input: unknown } {
	return { name, input: { prompt: PROMPT, ...input } }
}

describe('investigator_foreground.is_background_investigator — the refusal', () => {
	it.each([
		['an investigator with no `run_in_background`', agent_call({ subagent_type: INVESTIGATOR })],
		[
			'an investigator launched in the background',
			agent_call({ subagent_type: INVESTIGATOR, run_in_background: true }),
		],
		['the consumer spelling', agent_call({ subagent_type: 'kit:investigator' })],
		['the published `Task` spelling', agent_call({ subagent_type: INVESTIGATOR }, 'Task')],
	])('refuses %s', (_case, call) => {
		expect(investigator_foreground.is_background_investigator(call)).toBe(true)
	})

	it.each([
		[
			'an investigator in the foreground',
			agent_call({ subagent_type: INVESTIGATOR, run_in_background: false }),
		],
		[
			'another agent type in the background',
			agent_call({ subagent_type: GENERAL_PURPOSE, model: 'sonnet' }),
		],
		['an absent type', agent_call({})],
		['a type that only contains the name', agent_call({ subagent_type: 'investigator-x' })],
		['a call of another tool', { name: 'Bash', input: { command: 'ls' } }],
		['an input that is not an object', { name: 'Agent', input: PROMPT }],
	])('lets %s through', (_case, call) => {
		expect(investigator_foreground.is_background_investigator(call)).toBe(false)
	})
})

// joshuafolkken/kit#4889: a build whose subagent tool declares no `run_in_background` drops the field
// from the parsed input, and the model writes it as a string there. The stand-down reads that string off
// the call or the tail; a tail of boolean spellings is a build that declares it, so the refusal holds.
const TIMESTAMP = '2026-10-25T08:50:55.976Z'
const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'investigator-foreground-'))

afterAll(() => {
	rmSync(WORK_DIRECTORY, { recursive: true, force: true })
})

// A transcript of its own per call, so one test's remembered build never reaches another's.
function fresh_run(): GuardRun {
	return { transcript: path.join(WORK_DIRECTORY, `${randomUUID()}.jsonl`), now_ms: 1 }
}

function lacks(tail: string, call: GuardedCall, run: GuardRun = fresh_run()): boolean {
	return investigator_foreground.lacks_background_field(tail, call, run)
}

function use_line(input: Record<string, unknown>, name = 'Agent', id = 'toolu_1'): string {
	return JSON.stringify({
		type: 'assistant',
		timestamp: TIMESTAMP,
		message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
	})
}

// This row's refusal written back against the call `id`.
function refusal_line(id: string): string {
	const content = [
		{
			type: 'tool_result',
			tool_use_id: id,
			is_error: true,
			content: investigator_foreground.INVESTIGATOR_FOREGROUND_REASON,
		},
	]

	return JSON.stringify({ type: 'user', timestamp: TIMESTAMP, message: { role: 'user', content } })
}

function refused_dispatch(input: Record<string, unknown>, id: string): string {
	return [use_line({ subagent_type: INVESTIGATOR, ...input }, 'Agent', id), refusal_line(id)].join(
		'\n',
	)
}

describe('investigator_foreground.lacks_background_field — the build without the field', () => {
	const bare = agent_call({ subagent_type: INVESTIGATOR })

	it('stands down once a dispatch on the tail wrote the field as a string', () => {
		const tail = use_line({ subagent_type: INVESTIGATOR, run_in_background: 'false' })

		expect(lacks(tail, bare)).toBe(true)
		expect(investigator_foreground.ROW.already_satisfied(tail, bare, fresh_run())).toBe(true)
	})

	it('stands down when the call in hand carries the string', () => {
		const call = agent_call({ subagent_type: INVESTIGATOR, run_in_background: 'false' })

		expect(lacks('', call)).toBe(true)
	})

	it.each([
		['an empty tail', ''],
		[
			'a boolean spelling on the tail',
			use_line({ subagent_type: INVESTIGATOR, run_in_background: false }),
		],
		['a string on another tool', use_line({ command: 'ls', run_in_background: 'false' }, 'Bash')],
		[
			'a foreground dispatch that ran with another body',
			use_line({ subagent_type: INVESTIGATOR, prompt: OTHER_PROMPT, run_in_background: false }),
		],
	])('keeps refusing on %s, where the build declares the field', (_case, tail) => {
		expect(lacks(tail, bare)).toBe(false)
	})
})

// joshuafolkken/kit#4903: the first reissue in that build drops the field from the parsed input and is
// not on the tail yet, so only the dispatch with the same body there says it is the reissue.
describe('investigator_foreground.lacks_background_field — the first reissue', () => {
	const DESCRIPTION = 'Locate the guard'
	const reissue = agent_call({ subagent_type: INVESTIGATOR, description: DESCRIPTION })

	it('stands down on the reissue of a refused dispatch with the same body', () => {
		const tail = use_line({ subagent_type: INVESTIGATOR, description: DESCRIPTION, prompt: PROMPT })

		expect(investigator_foreground.ROW.already_satisfied(tail, reissue, fresh_run())).toBe(true)
	})

	it.each([
		[
			'another prompt',
			use_line({ subagent_type: INVESTIGATOR, description: DESCRIPTION, prompt: OTHER_PROMPT }),
		],
		[
			'another description',
			use_line({ subagent_type: INVESTIGATOR, description: 'Other', prompt: PROMPT }),
		],
		[
			'another agent type',
			use_line({ subagent_type: GENERAL_PURPOSE, description: DESCRIPTION, prompt: PROMPT }),
		],
	])('keeps refusing when the tail holds %s', (_case, tail) => {
		expect(lacks(tail, reissue)).toBe(false)
	})
})

// joshuafolkken/kit#4966: the transcript keeps the boolean `false` the parsed input dropped, so the tail
// spelling of the call in hand, or a dispatch this row refused although it wrote `false`, is the tell.
describe('investigator_foreground.lacks_background_field — a dropped boolean', () => {
	const bare = agent_call({ subagent_type: INVESTIGATOR })

	it('stands down when the tail holds the call in hand written with `false`', () => {
		const tail = use_line({ subagent_type: INVESTIGATOR, prompt: PROMPT, run_in_background: false })

		expect(lacks(tail, bare)).toBe(true)
	})

	it.each([
		['the boolean', false],
		['the string', 'false'],
	])('stands down on any body once this row refused a dispatch that wrote %s', (_case, value) => {
		const tail = refused_dispatch({ prompt: OTHER_PROMPT, run_in_background: value }, 'toolu_2')

		expect(lacks(tail, bare)).toBe(true)
	})

	it('keeps refusing where that dispatch drew another guard', () => {
		const tail = use_line(
			{ subagent_type: INVESTIGATOR, prompt: OTHER_PROMPT, run_in_background: false },
			'Agent',
			'toolu_2',
		)

		expect(lacks(tail, bare)).toBe(false)
	})

	// A reissue reworded after a refusal matches no body, so it is refused once; written with `false`, it
	// is itself the refused dispatch the next one stands down on.
	it('refuses a reworded reissue once, then stands down on the next', () => {
		const refused_bare = refused_dispatch({ prompt: OTHER_PROMPT }, 'toolu_2')
		const reworded = agent_call({ subagent_type: INVESTIGATOR, prompt: `${PROMPT} again` })
		const after = refused_dispatch(
			{ prompt: `${PROMPT} again`, run_in_background: false },
			'toolu_3',
		)

		expect(lacks(refused_bare, reworded)).toBe(false)
		expect(lacks([refused_bare, after].join('\n'), bare)).toBe(true)
	})
})

describe('investigator_foreground.lacks_background_field — remembered for the session', () => {
	const string_tail = use_line({ subagent_type: INVESTIGATOR, run_in_background: 'false' })

	it('stands down on a new body once the tell has left the tail', () => {
		const run = fresh_run()
		const later = agent_call({ subagent_type: INVESTIGATOR, prompt: OTHER_PROMPT })

		expect(lacks(string_tail, agent_call({ subagent_type: INVESTIGATOR }), run)).toBe(true)
		expect(lacks('', later, run)).toBe(true)
		expect(lacks('', later)).toBe(false)
	})

	it('keeps refusing a call that names the background, remembered or not', () => {
		const run = fresh_run()
		const background = agent_call({ subagent_type: INVESTIGATOR, run_in_background: true })

		expect(lacks(string_tail, agent_call({ subagent_type: INVESTIGATOR }), run)).toBe(true)
		expect(lacks('', background, run)).toBe(false)
		expect(lacks(string_tail, background)).toBe(false)
	})
})

describe('investigator_foreground.ROW — delivered by the rule guard', () => {
	it('refuses every occurrence', () => {
		expect(investigator_foreground.ROW.decide()).toBe(true)
	})

	it('scores a foreground dispatch as kept and reaches every investigator dispatch', () => {
		const kept = agent_call({ subagent_type: INVESTIGATOR, run_in_background: false })
		const missed = agent_call({ subagent_type: INVESTIGATOR })

		expect(investigator_foreground.ROW.keeps(kept)).toBe(true)
		expect(investigator_foreground.ROW.keeps(missed)).toBe(false)
		expect(investigator_foreground.ROW.reaches(missed)).toBe(true)
	})

	it('is the one delivered row whose trigger fires on a background investigator', () => {
		const call = agent_call({ subagent_type: INVESTIGATOR })
		const claiming = delivered_rules.DELIVERED_RULES.filter((rule) => rule.is_trigger(call))

		expect(claiming.map((rule) => rule.id)).toEqual(['investigator-foreground'])
	})

	it('names the remedy and the document it points at', () => {
		expect(investigator_foreground.INVESTIGATOR_FOREGROUND_REASON).toContain(FOREGROUND_FIELD)
		expect(investigator_foreground.INVESTIGATOR_FOREGROUND_REASON).toContain('delegation.md')
	})

	// `run:prep` and the investigation guard print this step, so a run is told the field before it
	// dispatches rather than only on this row's refusal.
	it('is named by the investigation step the entry and the read guard print', () => {
		expect(delegation_policy.INVESTIGATION_STEP).toContain(FOREGROUND_FIELD)
	})
})
