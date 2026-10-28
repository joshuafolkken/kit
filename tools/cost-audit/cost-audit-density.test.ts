import { describe, expect, it } from 'vitest'
import { cost_audit_density } from './cost-audit-density'
import { cost_audit_fixture } from './cost-audit-fixture'
import type { AuditSession } from './cost-audit-read'
import type { ToolCategory } from './cost-audit-tool'

const { record, session } = cost_audit_fixture
const READ: ToolCategory = 'doc read'
const RUN_KIND = 'fullrun'

// A session whose n-th request `r<n>` issued `counts[n]` calls.
function session_with(
	counts: ReadonlyArray<number>,
	kind = RUN_KIND,
	is_lane = true,
): AuditSession {
	const ids = counts.map((_count, index) => `r${String(index)}`)
	const categories = ids.map(
		(id, index) => [id, Array.from({ length: counts[index] ?? 0 }, () => READ)] as const,
	)

	return session(
		kind,
		ids.map((id) => record(id, 0, 0)),
		categories,
		is_lane,
	)
}

describe('cost_audit_density.density_of — the lane children’s round-trip density', () => {
	it('counts calls and single-call requests over the requests that called a tool', () => {
		const density = cost_audit_density.density_of([session_with([1, 1, 3, 0])])

		expect(density).toEqual({ requests: 3, calls: 5, single: 2 })
	})

	it.each([
		['a main-line session', RUN_KIND, false],
		['a delegated unit', 'subagent', true],
	])('leaves %s out', (_name, kind, is_lane) => {
		const density = cost_audit_density.density_of([session_with([1, 2], kind, is_lane)])

		expect(density).toEqual({ requests: 0, calls: 0, single: 0 })
	})
})

describe('cost_audit_density — the two printed ratios', () => {
	it('divides calls and single-call requests by the requests', () => {
		const density = { requests: 4, calls: 6, single: 3 }

		expect(cost_audit_density.calls_per_request(density)).toBe(1.5)
		expect(cost_audit_density.single_share(density)).toBe(0.75)
	})

	it('answers zero for both where no request called a tool', () => {
		const density = { requests: 0, calls: 0, single: 0 }

		expect(cost_audit_density.calls_per_request(density)).toBe(0)
		expect(cost_audit_density.single_share(density)).toBe(0)
	})
})
