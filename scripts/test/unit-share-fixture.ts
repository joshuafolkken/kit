import { core_budget } from '#scripts/gate/core-budget'
import { free_cores } from '#scripts/gate/free-cores'
import { vi, type MockInstance } from 'vitest'
import { unit_worker_share, type UnitClaim } from './unit-worker-share'

// What a unit run reads its worker count from, pinned for the suites that drive the guard.
//
// **Pinned rather than left real, because the real answer is what else is running on the machine**
// (joshuafolkken/kit#1515). `run_vitest` asks for this run's share of the workers and appends
// `--maxWorkers` when there is one, so a suite asserting the exact argument list would pass alone and
// fail beside a second lane — the class of flake that issue is about. Only the readings are stubbed;
// the marker lifecycle around the spawn stays real, so the wrapper is still exercised.
function stub_share(share: number | undefined): void {
	vi.spyOn(unit_worker_share, 'current_share').mockReturnValue(share)
}

// The free cores and memory are the machine's too, so they are pinned for the share's reason.
function stub_free(
	free: number | undefined,
	memory_workers?: number,
): MockInstance<typeof free_cores.read> {
	return vi.spyOn(free_cores, 'read').mockResolvedValue({ cores: free, memory_workers })
}

// So is the claim this run holds: the suite itself runs inside one (joshuafolkken/kit#4235).
function stub_claim(claim: UnitClaim | undefined): void {
	const reservation = claim && { pid: process.pid, claimed_at: 0, is_unit: true, ...claim }

	vi.spyOn(core_budget, 'held_unit_claim').mockReturnValue(reservation)
}

const unit_share_fixture = { stub_claim, stub_free, stub_share }

export { unit_share_fixture }
