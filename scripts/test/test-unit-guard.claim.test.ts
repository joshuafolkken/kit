import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_unit_guard } from './test-unit-guard'
import { unit_share_fixture } from './unit-share-fixture'
import { unit_worker_share } from './unit-worker-share'

// joshuafolkken/kit#4235: a run admitted at weight 3 re-read its share after admission and opened 5
// workers. The workers it opens are now bounded by the claim the ledger admitted it on.

const { stub_claim, stub_free, stub_share } = unit_share_fixture
const ADMITTED = 3
const LATER_SHARE = 5
const ASKED = 7
const NARROWED = 1

async function worker_arguments_for(): Promise<ReadonlyArray<string>> {
	return unit_worker_share.worker_arguments([], await test_unit_guard.vitest_share([]))
}

beforeEach(() => {
	stub_free(undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('test_unit_guard.vitest_share — the claim the run was admitted on', () => {
	it('starts a run admitted at weight 3 with --maxWorkers=3, not the later share of 5', async () => {
		stub_share(LATER_SHARE)
		stub_claim({ weight: ADMITTED })

		expect(await worker_arguments_for()).toStrictEqual([`--maxWorkers=${String(ADMITTED)}`])
	})

	it('starts a solo run narrowed past the wait cap at the narrowed weight', async () => {
		stub_share(undefined)
		stub_claim({ weight: ASKED, granted: NARROWED })

		expect(await worker_arguments_for()).toStrictEqual([`--maxWorkers=${String(NARROWED)}`])
	})

	it('starts a solo run admitted as asked at the claimed weight, not vitest default', async () => {
		stub_share(undefined)
		stub_claim({ weight: ASKED })

		expect(await worker_arguments_for()).toStrictEqual([`--maxWorkers=${String(ASKED)}`])
	})

	it('leaves a solo run holding no claim to vitest', async () => {
		stub_share(undefined)
		stub_claim(undefined)

		expect(await worker_arguments_for()).toStrictEqual([])
	})
})
