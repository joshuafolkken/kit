import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { observation_ledger } from '#scripts/observations/observation-ledger'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { review_tree } from './review-tree'

// joshuafolkken/kit#2998: a review's ledger line appended after the gate moved the changed-file map,
// so the ledger commit `pnpm josh followup` pushes no longer matched the green record and the pre-push
// hook re-ran the unit suite inside the push's timeout.
const CODE_FILE = 'a.ts'
const LEGACY_LEDGER = 'docs/maintainers/observations.md'

describe('review_tree.tree_of — observation ledger', () => {
	let root = ''

	beforeEach(() => {
		root = mkdtempSync(path.join(tmpdir(), 'josh-review-tree-ledger-'))
		writeFileSync(path.join(root, CODE_FILE), 'code')
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	it('leaves ledger paths out of the map and keeps every other path', () => {
		const tree = review_tree.tree_of(root, [
			observation_ledger.ledger_file(2998),
			CODE_FILE,
			LEGACY_LEDGER,
		])

		expect(Object.keys(tree)).toStrictEqual([CODE_FILE])
	})

	it('reads the same map whether or not the ledger changed beside the code', () => {
		const with_ledger = review_tree.tree_of(root, [CODE_FILE, observation_ledger.ledger_file(1)])

		expect(with_ledger).toStrictEqual(review_tree.tree_of(root, [CODE_FILE]))
	})
})
