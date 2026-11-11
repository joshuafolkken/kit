import path from 'node:path'
import { git_spawn } from '#scripts/git/git-spawn'
import { review_tree } from '#scripts/review/review-tree'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { check_related_reuse } from './check-related-reuse'
import type { CheckResult } from './check-related-section'
import { check_reuse, type CheckRecords } from './check-reuse'
import { gate_labels } from './gate-labels'
import type { GateTree } from './gate-tree'

// joshuafolkken/kit#7251: the gate linted again the tree `check:related`'s `lint:related` had just
// passed. Its green now writes the gate's `lint` record, which holds until a lint input moves.

const make_directory = temporary_directory('suite')
const read_git = vi.spyOn(git_spawn, 'read')
const read_tree = vi.spyOn(review_tree, 'read_changed_tree')
const { LINT_LABEL, LINT_TARGET } = gate_labels
const SOURCE = 'scripts/a.ts'
const FILES = { [SOURCE]: 'digest-a' }
const RECORDED: GateTree = { files: FILES, base: 'base-a' }
const EDITED: GateTree = { files: { [SOURCE]: 'digest-b' }, base: 'base-a' }

function records_in(prefix: string): CheckRecords {
	const directory = make_directory(`check-related-lint-record-${prefix}`)

	return function record_of(label: string): string {
		return path.join(directory, `${label}.json`)
	}
}

function lint_related(output: string): CheckResult {
	return { command: LINT_TARGET, exit_code: 0, output }
}

async function gate_reuses_lint(records: CheckRecords, tree: GateTree): Promise<boolean> {
	const reusable = await check_reuse.reusable_checks([LINT_LABEL], tree, records)

	return reusable.has(LINT_LABEL)
}

beforeEach(() => {
	read_git.mockReset()
	read_tree.mockResolvedValue(FILES)
})

describe('check_related_reuse.record — the gate lint record', () => {
	it('lets the gate reuse lint on the tree lint:related passed', async () => {
		const records = records_in('same-')

		await check_related_reuse.record([lint_related('')], RECORDED, records)

		await expect(gate_reuses_lint(records, RECORDED)).resolves.toBe(true)
	})

	it('runs the gate lint again once a changed source moved', async () => {
		const records = records_in('edited-')

		await check_related_reuse.record([lint_related('')], RECORDED, records)

		await expect(gate_reuses_lint(records, EDITED)).resolves.toBe(false)
	})

	it('records no gate lint from a pass that printed a warning', async () => {
		const records = records_in('warning-')

		await check_related_reuse.record([lint_related('1:1  warning  x')], RECORDED, records)

		await expect(gate_reuses_lint(records, RECORDED)).resolves.toBe(false)
	})
})
