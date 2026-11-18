import { josh_command } from '#scripts/josh/josh-run'
import { test_related_caller } from '#scripts/test/test-related-caller'
import { describe, expect, it, vi } from 'vitest'
import { run_chain, type ChainStage } from './run-chain'

// joshuafolkken/kit#7965: a `test:related` a stage starts names that stage as its caller. Kept apart
// from `run-chain.test.ts` because spying on `josh_run` needs an isolated worker.

const CHECK_RELATED = 'check:related'
const ISSUE = '5630'

function stage_named(name: string): ChainStage {
	const stage = run_chain.main_line_stages([], false).find((candidate) => candidate.name === name)

	if (stage === undefined) throw new Error(`no stage ${name}`)

	return stage
}

describe('run_chain — the caller a stage names', () => {
	it('hands each stage command its own name as the test:related caller', async () => {
		const josh_run = vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: '' })

		await run_chain.run_stages([stage_named(CHECK_RELATED)], ISSUE, vi.fn())

		expect(josh_run).toHaveBeenCalledWith([CHECK_RELATED], true, undefined, {
			[test_related_caller.CALLER_ENVIRONMENT]: `run:chain ${CHECK_RELATED}`,
		})
		josh_run.mockRestore()
	})
})
