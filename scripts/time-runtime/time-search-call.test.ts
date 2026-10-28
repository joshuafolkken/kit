import { describe, expect, it } from 'vitest'
import { time_search_call } from './time-search-call'
import { time_spans } from './time-spans'

function bash(command: string): ReturnType<typeof time_spans.to_tool_call> {
	return time_spans.to_tool_call('Bash', { command }, time_spans.NO_MESSAGE_ID)
}

const READ_CALL = time_spans.to_tool_call(
	'Read',
	{ file_path: 'scripts/a.ts' },
	time_spans.NO_MESSAGE_ID,
)

const GREP = 'grep -n batching scripts/hooks/batch-guard.ts'
const RG = 'rg mode_here scripts/'
const SED_READ = 'sed -n 1,20p scripts/a.ts'
const CAT = 'cat scripts/a.ts'
const GATE = 'pnpm josh gate'

describe('time_search_call.is_read_only_search — the investigation guard’s search', () => {
	it.each([[GREP], [RG], ['find scripts -name "*.ts"']])('counts %j as a search', (command) => {
		expect(time_search_call.is_read_only_search(bash(command))).toBe(true)
	})

	it.each([[SED_READ], [CAT], [GATE]])('does not count %j as a search', (command) => {
		expect(time_search_call.is_read_only_search(bash(command))).toBe(false)
	})

	it('does not count a Read as a search', () => {
		expect(time_search_call.is_read_only_search(READ_CALL)).toBe(false)
	})
})

describe('time_search_call.is_search_chain_call — the batching guard’s search chain', () => {
	it.each([[GREP], [RG], [SED_READ]])('joins %j to a search chain', (command) => {
		expect(time_search_call.is_search_chain_call(bash(command))).toBe(true)
	})

	it.each([['sed -i s/a/b/ scripts/a.ts'], [CAT], [GATE]])(
		'keeps %j out of a search chain',
		(command) => {
			expect(time_search_call.is_search_chain_call(bash(command))).toBe(false)
		},
	)

	it('keeps a Read out of a search chain', () => {
		expect(time_search_call.is_search_chain_call(READ_CALL)).toBe(false)
	})
})
