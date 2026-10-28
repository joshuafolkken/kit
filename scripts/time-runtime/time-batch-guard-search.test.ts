import { time_transcript_fixture } from '#tools/time/time-transcript-fixture'
import { describe, expect, it } from 'vitest'
import { time_batch_guard } from './time-batch-guard'
import { bash_call, NEVER_REFUSED, transcript } from './time-batch-guard-fixtures'

const { bash_turn_lines: bash_turn } = time_transcript_fixture

// The search-chain refusal a lane child keeps (kit#5342): the batching rule narrowed to a run of
// searches issued one per turn.

const GREP = 'grep -n mode_here scripts/lane/lane-guard-policy.ts'
const SED = 'sed -n 1,40p scripts/hooks/batch-guard.ts'
const RG = 'rg is_child_of tools/cost-audit/'

function chain_of(first: string, second: string, current: string): string {
	return transcript(bash_turn(0, first), bash_turn(1, second), bash_turn(2, current, false))
}

function blocks(text: string, command: string): boolean {
	return time_batch_guard.should_block_search_chain(text, bash_call(command), NEVER_REFUSED)
}

describe('time_batch_guard.should_block_search_chain — three single-call searches in a row', () => {
	it('refuses a third search after two single-call search turns', () => {
		expect(blocks(chain_of(GREP, SED, RG), RG)).toBe(true)
	})

	// A bundleable read the general rule would refuse on, so only the search narrowing lets it through.
	it('lets the call through when an earlier turn of the run read rather than searched', () => {
		const text = chain_of('cat docs/josh-commands-run.md', SED, RG)

		expect(time_batch_guard.should_block(text, bash_call(RG), NEVER_REFUSED)).toBe(true)
		expect(blocks(text, RG)).toBe(false)
	})

	// A search into what an earlier search found needed its result, so the chain is dependent.
	it('lets a search through that shares a target with the chain', () => {
		const command = 'grep -n refuse scripts/hooks/batch-guard.ts'

		expect(blocks(chain_of(GREP, SED, command), command)).toBe(false)
	})

	it('lets a call that is not a search through after a search chain', () => {
		const command = 'pnpm josh test:related'

		expect(blocks(chain_of(GREP, SED, command), command)).toBe(false)
	})

	it('lets a search through after one single-call search turn', () => {
		const text = transcript(bash_turn(0, GREP), bash_turn(1, RG, false))

		expect(blocks(text, RG)).toBe(false)
	})
})

describe('time_batch_guard.is_search_chain_call — the pre-read filter', () => {
	it.each([[GREP], [SED], [RG]])('reads the transcript for %j', (command) => {
		expect(time_batch_guard.is_search_chain_call(bash_call(command))).toBe(true)
	})

	it.each([[{ name: 'Read', input: { file_path: 'a.ts' } }], [bash_call('pnpm josh gate')]])(
		'skips the read for %j',
		(call) => {
			expect(time_batch_guard.is_search_chain_call(call)).toBe(false)
		},
	)
})
