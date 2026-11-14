import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { review_record_pinned } from '#scripts/review/review-record-pinned'
import { temporary_directory } from '#tools/test/temporary-directory'
import { test_state_guard } from '#tools/test/test-state-guard'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { check_related, type CheckResult } from './check-related'
import { check_related_pinned } from './check-related-pinned'
import { check_related_reuse } from './check-related-reuse'
import { check_related_unplanned } from './check-related-unplanned'
import type { GateTree } from './gate-tree'
import { metrics_totals } from './metrics-totals'
import { tree_verdict } from './tree-verdict'

const make_directory = temporary_directory('suite')
const SOURCE = 'source.ts'
const CONFIG = 'package.json'
const APPROVAL = '.josh/metrics-accepted/7450.json'
const LEDGER = '.josh/observations/7450.md'
const FILES = [SOURCE, CONFIG, APPROVAL, LEDGER]
const record_verdict = tree_verdict.record
const fixture = { root: '', target: '', is_written: false }
const INTERRUPTED = 'writer interrupted'

async function read_tree(): Promise<GateTree> {
	const files = Object.fromEntries(
		FILES.map((file) => [file, readFileSync(path.join(fixture.root, path.basename(file)), 'utf8')]),
	)

	return { files, base: 'base' }
}

async function finish_records(): Promise<boolean> {
	await Promise.resolve()
	writeFileSync(path.join(fixture.root, path.basename(APPROVAL)), 'accepted')
	writeFileSync(path.join(fixture.root, path.basename(LEDGER)), 'review recorded')
	fixture.is_written = true

	return true
}

function state(tree: GateTree): ReturnType<typeof test_state_guard.capture_state> {
	return { branch: 'lane', status: JSON.stringify(tree.files), git_env: {} }
}

async function violation_since(before: GateTree): Promise<string | undefined> {
	const after = await read_tree()

	return test_state_guard.format_violations(state(before), state(after))
}

async function passing(command: string): Promise<CheckResult> {
	return { command, exit_code: 0, output: '' }
}

function stub_checks(): void {
	vi.spyOn(check_related_reuse, 'read_tree').mockImplementation(read_tree)
	vi.spyOn(check_related_reuse, 'reusable').mockResolvedValue(new Set())
	vi.spyOn(check_related_reuse, 'record').mockResolvedValue()
	vi.spyOn(review_record_pinned, 'restart_in_lane').mockResolvedValue(false)
	vi.spyOn(check_related_pinned, 'notice').mockResolvedValue(undefined)
	vi.spyOn(check_related_unplanned, 'notice').mockResolvedValue(undefined)
}

beforeEach(() => {
	fixture.root = make_directory('check-record-order-')
	fixture.target = path.join(fixture.root, 'verdict.json')
	fixture.is_written = false
	for (const file of FILES) writeFileSync(path.join(fixture.root, path.basename(file)), 'before')
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	vi.spyOn(metrics_totals, 'rerecord').mockImplementation(finish_records)
	stub_checks()
	vi.spyOn(tree_verdict, 'read').mockReturnValue(undefined)
	vi.spyOn(tree_verdict, 'record').mockImplementation(async (entry, after) => {
		await record_verdict(entry, after, fixture.target)
	})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('check_related record completion before verification (#7450)', () => {
	it('reproduces the guard rejection when record writes overlap verification', async () => {
		const before = await read_tree()

		await finish_records()

		expect(await violation_since(before)).toContain('working tree changed')
	})

	it('checks once after asynchronous record completion and stamps that tree', async () => {
		const execute = vi.fn(async (command: string): Promise<CheckResult> => {
			expect(fixture.is_written).toBe(true)
			const before = await read_tree()
			const result = await passing(command)

			expect(await violation_since(before)).toBeUndefined()

			return result
		})

		expect(await check_related.run_all(fixture.root, execute)).toBe(0)
		expect(execute).toHaveBeenCalledTimes(check_related.CHECKS.length)
		const entry = vi.mocked(tree_verdict.record).mock.calls[0]?.[0]

		expect(entry?.before).toEqual(await read_tree())
		expect(readFileSync(fixture.target, 'utf8')).toContain('"exit_code":0')
	})
})

describe('check_related verification guards (#7450)', () => {
	it.each([SOURCE, CONFIG])('rejects a mid-check change to %s without stamping', async (file) => {
		async function execute(command: string): Promise<CheckResult> {
			if (command !== 'test:related') return await passing(command)
			const before = await read_tree()

			writeFileSync(path.join(fixture.root, path.basename(file)), 'changed during tests')
			const violation = await violation_since(before)

			return { command, exit_code: violation === undefined ? 0 : 1, output: violation ?? '' }
		}

		expect(await check_related.run_all(fixture.root, execute)).toBe(1)
		expect(existsSync(fixture.target)).toBe(false)
	})

	it('runs no checks and records no verdict if record completion rejects', async () => {
		vi.mocked(metrics_totals.rerecord).mockRejectedValue(new Error(INTERRUPTED))
		const execute = vi.fn(passing)

		await expect(check_related.run_all(fixture.root, execute)).rejects.toThrow(INTERRUPTED)
		expect(execute).not.toHaveBeenCalled()
		expect(tree_verdict.record).not.toHaveBeenCalled()
	})
})
