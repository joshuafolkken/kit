import { observation_ledger } from '#scripts/observations/observation-ledger'
import { describe, expect, it } from 'vitest'
import { review_tree } from './review-tree'

const PACKAGE_FILE = 'package.json'
const LEDGER_ISSUE = 3017

describe('review_tree.read_changed_tree', () => {
	// joshuafolkken/kit#3017: a ledger line appended after the gate changed this map, so the ledger
	// commit's pre-push no longer matched the green record and re-ran the whole unit suite.
	it('leaves the observation ledger out of the digest map', async () => {
		const ledger = observation_ledger.ledger_file(LEDGER_ISSUE)
		const tree = await review_tree.read_changed_tree([PACKAGE_FILE, ledger])

		expect(Object.keys(tree)).toStrictEqual([PACKAGE_FILE])
	})
})
