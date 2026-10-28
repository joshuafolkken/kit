import { afterEach, describe, expect, it, vi } from 'vitest'
import { check_related, type CheckResult } from './check-related'
import { check_related_reuse } from './check-related-reuse'
import { check_reuse, type CheckRecords } from './check-reuse'
import { gate_labels } from './gate-labels'
import { gate_tree, type GateTree } from './gate-tree'
import { scoped_green } from './scoped-green'

// joshuafolkken/kit#5156: `check:related` read neither green record, so a re-run after fixing one
// check ran the three that had passed over again.

const { CHECKS } = check_related
const [LINT = '', TEST = '', TYPE_CHECK = '', CSPELL = ''] = CHECKS
const { TYPE_CHECK_LABEL, SPELL_CHECK_LABEL } = gate_labels
const SOURCE = 'scripts/a.ts'
const TREE: GateTree = { files: { [SOURCE]: 'digest-a' }, base: 'base-a' }
const AT = '2026-10-27T00:00:00.000Z'

function record_of(label: string): string {
	return `/records/${label}.json`
}

const RECORDS: CheckRecords = record_of

function answer(scripts: ReadonlyArray<string>, labels: ReadonlyArray<string>): void {
	vi.spyOn(scoped_green, 'green_scripts').mockReturnValue(scripts)
	vi.spyOn(check_reuse, 'reusable_checks').mockResolvedValue(
		new Map(labels.map((label) => [label, AT])),
	)
}

describe('check_related_reuse.reusable', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('reuses all four when every record still holds', async () => {
		answer([LINT, TEST], [TYPE_CHECK_LABEL, SPELL_CHECK_LABEL])

		await expect(check_related_reuse.reusable(CHECKS, TREE, RECORDS)).resolves.toStrictEqual(
			new Set(CHECKS),
		)
	})

	it('asks the scoped records with the tree and the gate records under the gate labels', async () => {
		answer([], [])

		await check_related_reuse.reusable(CHECKS, TREE, RECORDS)

		expect(scoped_green.green_scripts).toHaveBeenCalledExactlyOnceWith(TREE.files, TREE.base)
		expect(check_reuse.reusable_checks).toHaveBeenCalledExactlyOnceWith(
			[TYPE_CHECK_LABEL, SPELL_CHECK_LABEL],
			TREE,
			RECORDS,
		)
	})

	it('leaves out each check whose record no longer holds', async () => {
		answer([LINT], [SPELL_CHECK_LABEL])

		await expect(check_related_reuse.reusable(CHECKS, TREE, RECORDS)).resolves.toStrictEqual(
			new Set([LINT, CSPELL]),
		)
	})
})

describe('check_related_reuse.read_tree', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('answers a tree with no answer when git fails, so every check runs', async () => {
		vi.spyOn(gate_tree, 'read_gate_tree').mockRejectedValue(new Error('git failed'))

		const tree = await check_related_reuse.read_tree()

		expect(tree).toStrictEqual(check_related_reuse.UNREAD_TREE)
		expect(scoped_green.green_scripts(tree.files, tree.base)).toStrictEqual([])
	})
})

function result(command: string, exit_code = 0): CheckResult {
	return { command, exit_code, output: '' }
}

describe('check_related_reuse.record', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('hands the type check and cspell to the gate records under the gate labels', async () => {
		const record = vi.spyOn(check_reuse, 'record_green_checks').mockResolvedValue()

		await check_related_reuse.record(
			[result(LINT), result(TYPE_CHECK), result(CSPELL, 1)],
			TREE,
			RECORDS,
		)

		expect(record).toHaveBeenCalledExactlyOnceWith(
			[
				{ ...result(TYPE_CHECK), label: TYPE_CHECK_LABEL, elapsed_ms: 0 },
				{ ...result(CSPELL, 1), label: SPELL_CHECK_LABEL, elapsed_ms: 0 },
			],
			TREE,
			RECORDS,
		)
	})
})
