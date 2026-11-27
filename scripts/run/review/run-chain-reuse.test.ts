import path from 'node:path'
import { check_related_reuse } from '#scripts/gate/check-related-reuse'
import { check_reuse, type CheckRecords } from '#scripts/gate/check-reuse'
import { gate_labels } from '#scripts/gate/gate-labels'
import type { GateTree } from '#scripts/gate/gate-tree'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { lane_ledger_write_chain_stage } from '#scripts/lane/lane-ledger-write-chain-stage'
import { review_tree } from '#scripts/review/review-tree'
import { run_ship_pre_detach } from '#scripts/run/ship/run-ship-pre-detach'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_chain } from './run-chain'
import { run_chain_reuse } from './run-chain-reuse'

// joshuafolkken/kit#9139: run:chain's exports:unused and guard-test stages answer from their green
// record while none of their inputs moved, and run again the moment one did.

const make_directory = temporary_directory('test')
const read_changed = vi.spyOn(review_tree, 'read_changed_tree')

const FAIL = 1
const SOURCE = 'scripts/run/review/run-chain.ts'
const FILES = { [SOURCE]: 'digest-a' }
const RECORDED: GateTree = { files: FILES, base: 'base-a' }
const EXPORTS_ARGV = run_ship_pre_detach.exports_argv()
const GUARD_ARGV = run_ship_pre_detach.guard_test_argv(process.cwd())
const PASSED: JoshResult = { code: 0, out: '' }
const MOVED_DOCUMENT = 'docs/moved.md'
const GREEN_AT = '2026-01-01T00:00:00.000Z'
const EXPORTS_UNUSED = 'exports:unused'

function records_in(prefix: string): CheckRecords {
	const directory = make_directory(`run-chain-reuse-${prefix}`)

	return function record_of(label: string): string {
		return path.join(directory, `${label}.json`)
	}
}

function moved(file: string): GateTree {
	return { files: { ...FILES, [file]: 'digest-b' }, base: RECORDED.base }
}

// Runs `argv` once on the recorded tree, then again on `second`; answers the runner and the second answer.
async function twice(
	argv: ReadonlyArray<string>,
	second: GateTree,
	first: JoshResult = PASSED,
): Promise<{ runner: ReturnType<typeof vi.fn>; answer: JoshResult }> {
	const runner = vi.fn(async () => first)
	const records = records_in('twice')

	await run_chain_reuse.reusing(runner, records, async () => RECORDED)(argv)
	const answer = await run_chain_reuse.reusing(runner, records, async () => second)(argv)

	return { runner, answer }
}

beforeEach(() => {
	read_changed.mockResolvedValue(FILES)
})

describe('run_chain_reuse — a stage whose inputs did not move', () => {
	it.each([
		[EXPORTS_UNUSED, EXPORTS_ARGV],
		['the guard tests', GUARD_ARGV],
	])('answers %s from its green record without running it again', async (_name, argv) => {
		const { runner, answer } = await twice(argv, RECORDED)

		expect(runner).toHaveBeenCalledOnce()
		expect(answer.code).toBe(0)
		expect(answer.out).toContain('reused')
	})

	it('names the guard tests by their label, not their path list, when it reuses them', async () => {
		const { answer } = await twice(GUARD_ARGV, RECORDED)

		expect(answer.out).toMatch(/^guard-tests: reused/u)
	})

	it('runs a stage with no record label every time and records nothing', async () => {
		const { runner } = await twice(['check:related'], RECORDED)

		expect(runner).toHaveBeenCalledTimes(2)
	})
})

describe('run_chain.run_stages — the default stage runner', () => {
	it('answers exports:unused from its green record without running it', async () => {
		const spies = [
			vi.spyOn(lane_ledger_write_chain_stage, 'record_chain_stage').mockResolvedValue(undefined),
			vi.spyOn(check_related_reuse, 'read_tree').mockResolvedValue(RECORDED),
			vi
				.spyOn(check_reuse, 'reusable_checks')
				.mockResolvedValue(new Map([[gate_labels.EXPORTS_LABEL, GREEN_AT]])),
		]
		const josh = vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: FAIL, out: '' })
		const stage = { name: EXPORTS_UNUSED, argv: EXPORTS_ARGV, next: (): string => '' }

		const chain = await run_chain.run_stages([stage], '9139', vi.fn())

		expect(josh).not.toHaveBeenCalled()
		expect(chain.stop).toBeUndefined()
		for (const spy of [...spies, josh]) spy.mockRestore()
	})
})

describe('run_chain_reuse — a stage whose inputs moved or that failed', () => {
	it.each([
		['exports:unused on a moved source', EXPORTS_ARGV, 'scripts/run/moved.ts'],
		['the guard tests on a moved document', GUARD_ARGV, MOVED_DOCUMENT],
	])('runs %s again', async (_name, argv, file) => {
		const { runner, answer } = await twice(argv, moved(file))

		expect(runner).toHaveBeenCalledTimes(2)
		expect(answer.out).not.toContain('reused')
	})

	it('reuses exports:unused when only a file outside its inputs moved', async () => {
		const { runner } = await twice(EXPORTS_ARGV, moved(MOVED_DOCUMENT))

		expect(runner).toHaveBeenCalledOnce()
	})

	it('writes no record for a red run, so the next run starts it again', async () => {
		const { runner, answer } = await twice(GUARD_ARGV, RECORDED, { code: FAIL, out: 'red' })

		expect(runner).toHaveBeenCalledTimes(2)
		expect(answer.code).toBe(FAIL)
	})
})
