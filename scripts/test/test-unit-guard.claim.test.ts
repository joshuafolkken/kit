import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_unit_guard } from './test-unit-guard'
import { unit_share_fixture } from './unit-share-fixture'
import { unit_worker_share } from './unit-worker-share'

// The core count is pinned so the free-memory bound below is narrower than it on any machine.
const { PINNED_CORES } = vi.hoisted(() => ({ PINNED_CORES: 11 }))

vi.mock('node:os', async (import_original) => ({
	...(await import_original<Record<string, unknown>>()),
	availableParallelism: (): number => PINNED_CORES,
}))

// joshuafolkken/kit#4235: a run admitted at weight 3 re-read its share after admission and opened 5
// workers. The workers it opens are now bounded by the claim the ledger admitted it on.

const { stub_claim, stub_free, stub_share } = unit_share_fixture
const ADMITTED = 3
// The claim holds vitest's own process too (joshuafolkken/kit#4362), so its workers are one fewer.
const ADMITTED_WORKERS = ADMITTED - unit_worker_share.MAIN_PROCESS_CORES
const LATER_SHARE = 5
const ASKED = 7
const ASKED_WORKERS = ASKED - unit_worker_share.MAIN_PROCESS_CORES
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
	it('starts a run admitted at weight 3 with --maxWorkers=2, not the later share of 5', async () => {
		stub_share(LATER_SHARE)
		stub_claim({ weight: ADMITTED })

		expect(await worker_arguments_for()).toStrictEqual([`--maxWorkers=${String(ADMITTED_WORKERS)}`])
	})

	it('starts a solo run narrowed past the wait cap at the narrowed weight', async () => {
		stub_share(undefined)
		stub_claim({ weight: ASKED, granted: NARROWED })

		expect(await worker_arguments_for()).toStrictEqual([`--maxWorkers=${String(NARROWED)}`])
	})

	it('starts a solo run admitted as asked at the claimed weight less vitest itself, not vitest default', async () => {
		stub_share(undefined)
		stub_claim({ weight: ASKED })

		expect(await worker_arguments_for()).toStrictEqual([`--maxWorkers=${String(ASKED_WORKERS)}`])
	})

	it('leaves a solo run holding no claim to vitest', async () => {
		stub_share(undefined)
		stub_claim(undefined)

		expect(await worker_arguments_for()).toStrictEqual([])
	})
})

// joshuafolkken/kit#4528: the free memory the guard reads narrows a solo run's workers too.
describe('test_unit_guard.vitest_share — the free memory', () => {
	const MEMORY_WORKERS = 2

	beforeEach(() => {
		vi.spyOn(unit_worker_share, 'live_run_count').mockReturnValue(0)
		stub_claim(undefined)
	})

	it('starts a solo run at the workers the free memory holds', async () => {
		stub_free(undefined, MEMORY_WORKERS)

		expect(await worker_arguments_for()).toStrictEqual([`--maxWorkers=${String(MEMORY_WORKERS)}`])
	})

	it('leaves a solo run to vitest where the memory could not be read', async () => {
		stub_free(undefined)

		expect(await worker_arguments_for()).toStrictEqual([])
	})
})
