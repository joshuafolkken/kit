import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { check_reuse, type CheckRecords } from '#scripts/gate/check-reuse'
import { gate_labels } from '#scripts/gate/gate-labels'
import type { GateTree } from '#scripts/gate/gate-tree'
import { change_base } from '#scripts/git/change-base'
import { git_spawn } from '#scripts/git/git-spawn'
import { review_tree } from '#scripts/review/review-tree'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const run_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/lib/buffered-process', () => ({
	buffered_process: {
		run_buffered_process: run_mock,
		is_process_failed: (result: { exit_code: number }): boolean => result.exit_code !== 0,
	},
}))
vi.mock('#scripts/gate/type-check-step', () => ({
	type_check_step: { resolve_type_check_args: vi.fn(async () => ['josh', 'check']) },
}))
vi.mock('#scripts/gate/project-checks', () => ({
	project_checks: { is_kit_repository: vi.fn(() => false) },
}))

const { run_ship_pre_detach } = await import('./run-ship-pre-detach')

// joshuafolkken/kit#4505: a check the pre-detach step passed is not run again by the gate stage on the
// same tree — the pre-detach step writes the gate's own per-check record and the gate reads it.

const scratch = mkdtempSync(path.join(tmpdir(), 'pre-detach-reuse-'))
const read_tree = vi.spyOn(review_tree, 'read_changed_tree')
const read_base = vi.spyOn(change_base, 'resolved_through_merge')
const read_git = vi.spyOn(git_spawn, 'read')
const { EXPORTS_LABEL, TYPE_CHECK_LABEL } = gate_labels
const LABELS = [TYPE_CHECK_LABEL, EXPORTS_LABEL, 'cspell']
const SOURCE = 'scripts/a.ts'
const FILES = { [SOURCE]: 'digest-a' }
const BASE = 'base-a'
const SHIPPED: GateTree = { files: FILES, base: BASE }
const FAILED = 1

function records_in(prefix: string): CheckRecords {
	const directory = mkdtempSync(path.join(scratch, prefix))

	return function record_of(label: string): string {
		return path.join(directory, `${label}.json`)
	}
}

function answer(by_command: ReadonlyMap<string, number>): void {
	run_mock.mockImplementation(async (list: ReadonlyArray<string>) => {
		return { exit_code: by_command.get(list.join(' ')) ?? 0, output: '' }
	})
}

async function gate_reuses(
	records: CheckRecords,
	tree: GateTree = SHIPPED,
): Promise<Array<string>> {
	const reusable = await check_reuse.reusable_checks(LABELS, tree, records)

	return [...reusable.keys()]
}

async function pre_detach(prefix: string): Promise<CheckRecords> {
	const records = records_in(prefix)

	await run_ship_pre_detach.checks(scratch, records)

	return records
}

beforeEach(() => {
	run_mock.mockReset()
	read_git.mockReset()
	answer(new Map())
	read_tree.mockResolvedValue(FILES)
	read_base.mockResolvedValue(BASE)
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('run_ship_pre_detach.checks — the gate stage after it', () => {
	it('reuses the type check and the unused-export check on an unchanged tree', async () => {
		await expect(gate_reuses(await pre_detach('green-'))).resolves.toStrictEqual([
			TYPE_CHECK_LABEL,
			EXPORTS_LABEL,
		])
	})

	it('runs them again once a changed source moved', async () => {
		const edited = { files: { [SOURCE]: 'digest-b' }, base: BASE }

		await expect(gate_reuses(await pre_detach('edited-'), edited)).resolves.toStrictEqual([])
	})

	it('runs the check the pre-detach step failed', async () => {
		answer(new Map([['josh exports:unused', FAILED]]))

		await expect(gate_reuses(await pre_detach('red-'))).resolves.toStrictEqual([TYPE_CHECK_LABEL])
	})

	it('runs every check when the tree moved while the pre-detach step ran', async () => {
		read_tree.mockResolvedValueOnce(FILES).mockResolvedValue({ [SOURCE]: 'digest-during' })

		await expect(gate_reuses(await pre_detach('moved-'))).resolves.toStrictEqual([])
	})
})
