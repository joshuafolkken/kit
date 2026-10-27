import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { delegation_policy } from '#scripts/delegation/delegation-policy'
import type { GuardRun } from '#scripts/josh/hook-decision'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { implementation_cut } from './implementation-cut'
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
const ROW_REASON = investigator_foreground.ROW.reason
const { REISSUE_WINDOW_MS } = implementation_cut

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
// the call or the tail; a boolean spelling that ran is a build that declares it, so the refusal holds.
const TIMESTAMP = '2026-10-25T08:50:55.976Z'
const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'investigator-foreground-'))

afterAll(() => {
	rmSync(WORK_DIRECTORY, { recursive: true, force: true })
})

const TIMESTAMP_MS = Date.parse(TIMESTAMP)

// A transcript of its own per call, so one test's remembered build never reaches another's. Past the
// reissue window of the tail's results unless a test says otherwise.
function fresh_run(now_ms = TIMESTAMP_MS + REISSUE_WINDOW_MS): GuardRun {
	return { transcript: path.join(WORK_DIRECTORY, `${randomUUID()}.jsonl`), now_ms }
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

// A result written back against the call `id` — this row's refusal, or the unit's answer.
function result_line(id: string, is_refused = true): string {
	const content = [
		{
			type: 'tool_result',
			tool_use_id: id,
			is_error: is_refused,
			content: is_refused ? investigator_foreground.INVESTIGATOR_FOREGROUND_REASON : 'Found it',
		},
	]

	return JSON.stringify({ type: 'user', timestamp: TIMESTAMP, message: { role: 'user', content } })
}

function refused_dispatch(input: Record<string, unknown>, id: string, is_refused = true): string {
	const use = use_line({ subagent_type: INVESTIGATOR, ...input }, 'Agent', id)

	return [use, result_line(id, is_refused)].join('\n')
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
		const tail = refused_dispatch({ description: DESCRIPTION, prompt: PROMPT }, 'toolu_2')

		expect(investigator_foreground.ROW.already_satisfied(tail, reissue, fresh_run())).toBe(true)
	})

	it.each([
		['another prompt', refused_dispatch({ description: DESCRIPTION, prompt: OTHER_PROMPT }, 'id')],
		['another description', refused_dispatch({ description: 'Other', prompt: PROMPT }, 'id')],
		[
			'another agent type',
			[
				use_line({ subagent_type: GENERAL_PURPOSE, description: DESCRIPTION, prompt: PROMPT }),
				result_line('toolu_1'),
			].join('\n'),
		],
		[
			'the same body with no result yet, written bare',
			use_line({ subagent_type: INVESTIGATOR, description: DESCRIPTION, prompt: PROMPT }),
		],
		// A build that declares the field: the dispatch ran, so a bare repeat of it is still refused.
		[
			'a foreground dispatch with the same body that ran',
			refused_dispatch(
				{ description: DESCRIPTION, prompt: PROMPT, run_in_background: false },
				'toolu_2',
				false,
			),
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
		const use = use_line(
			{ subagent_type: INVESTIGATOR, prompt: OTHER_PROMPT, run_in_background: false },
			'Agent',
			'toolu_2',
		)
		const content = [
			{ type: 'tool_result', tool_use_id: 'toolu_2', is_error: true, content: '⛔ agent model: x' },
		]
		const other = JSON.stringify({ type: 'user', timestamp: TIMESTAMP, message: { content } })

		expect(lacks([use, other].join('\n'), bare)).toBe(false)
	})
})

// A reissue reworded after a refusal matches no body, so it is refused once; written with `false`, it
// is itself the refused dispatch the next one stands down on.
describe('investigator_foreground.lacks_background_field — a reworded reissue', () => {
	it('refuses a reworded reissue once, then stands down on the next', () => {
		const bare = agent_call({ subagent_type: INVESTIGATOR })
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

	// The delivered guard hands the row its session, so the remembered build reaches a live refusal.
	it('stands the delivered guard down on an empty transcript once the build is remembered', () => {
		const run = fresh_run()
		const tool_input = { subagent_type: INVESTIGATOR, prompt: OTHER_PROMPT }
		const payload = JSON.stringify({
			transcript_path: run.transcript,
			tool_name: 'Agent',
			tool_input,
		})

		vi.stubEnv(delivered_rules.SWITCH_ENV_KEY, '')
		writeFileSync(run.transcript, '')

		expect(delivered_rules.delivery(payload)).toBe(investigator_foreground.ROW.reason)
		expect(lacks(string_tail, agent_call({ subagent_type: INVESTIGATOR }), run)).toBe(true)
		expect(delivered_rules.delivery(payload)).toBeUndefined()
	})
})

function payload_of(run: GuardRun, input: Record<string, unknown>): string {
	return JSON.stringify({ transcript_path: run.transcript, tool_name: 'Agent', tool_input: input })
}

function sibling_use(id: string, prompt: string): Record<string, unknown> {
	return { type: 'tool_use', id, name: 'Agent', input: { subagent_type: INVESTIGATOR, prompt } }
}

// Two dispatches launched in one message, the first refused by this row.
function sibling_tail(): string {
	const content = [sibling_use('toolu_2', PROMPT), sibling_use('toolu_3', OTHER_PROMPT)]
	const message = { id: 'msg_1', role: 'assistant', content }
	const use = JSON.stringify({ type: 'assistant', timestamp: TIMESTAMP, message })

	return [use, result_line('toolu_2')].join('\n')
}

// joshuafolkken/kit#5148: the harness drops the undeclared field before the hook and the transcript see
// it, so a reissue rewritten after the refusal leaves no tell. The row's own answered refusal is the
// tell, read off the tail so a sibling or a later dispatch in a build that declares the field is not.
const REWRITTEN_INPUT = { subagent_type: INVESTIGATOR, prompt: OTHER_PROMPT }

function within_window(): GuardRun {
	return fresh_run(TIMESTAMP_MS + REISSUE_WINDOW_MS - 1)
}

describe('investigator_foreground.lacks_background_field — the row’s own refusal as the tell', () => {
	const rewritten = agent_call(REWRITTEN_INPUT)
	const refused_tail = refused_dispatch({ prompt: PROMPT }, 'toolu_2')

	it('stands down on a rewritten reissue with no field anywhere, and remembers the build', () => {
		const run = within_window()

		expect(lacks(refused_tail, rewritten, run)).toBe(true)
		expect(lacks('', agent_call({ subagent_type: INVESTIGATOR }), run)).toBe(true)
	})

	it('keeps refusing a dispatch that names the background after a refusal', () => {
		const background = agent_call({ subagent_type: INVESTIGATOR, run_in_background: true })

		expect(lacks(refused_tail, background, within_window())).toBe(false)
	})

	it.each([
		['past the reissue window', refused_tail, fresh_run],
		['beside the refused call in its message', sibling_tail(), within_window],
		[
			'after a foreground reissue that ran',
			[refused_tail, refused_dispatch({ prompt: PROMPT }, 'toolu_3', false)].join('\n'),
			within_window,
		],
	])('refuses a bare dispatch %s, and remembers nothing', (_case, tail, run_of) => {
		const run = run_of()

		expect(lacks(tail, rewritten, run)).toBe(false)
		expect(lacks('', rewritten, run)).toBe(false)
	})

	it('refuses the rewritten reissue on the delivered guard once the refusal is past the window', () => {
		const run = fresh_run()

		vi.stubEnv(delivered_rules.SWITCH_ENV_KEY, '')
		writeFileSync(run.transcript, refused_tail)

		expect(delivered_rules.delivery(payload_of(run, REWRITTEN_INPUT))).toBe(ROW_REASON)
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
