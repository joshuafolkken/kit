import { describe, expect, it } from 'vitest'
import type { Audit, AuditRow } from './cost-audit'
import { cost_audit_format } from './cost-audit-format'
import type { ResultBreakdown } from './cost-audit-result'
import type { UsageBreakdown } from './cost-audit-usage'

function row(key: string, current: number, previous: number, is_regression = false): AuditRow {
	return { key, current, previous, is_regression }
}

const NO_DENSITY = { requests: 0, calls: 0, single: 0 }
const NO_REGRESSIONS = 'Regressions: none'
const NO_REWRITES = { after_wait: { count: 0, usd: 0 }, within_ttl: { count: 0, usd: 0 } }
const NO_FIRST = { sessions: 0, p50_tokens: undefined }
const USAGE_TITLE = 'Usage breakdown (this period: tokens and dollars)'
const NO_USAGE: UsageBreakdown = {
	cache_write: { tokens_5m: 0, tokens_1h: 0, usd_5m: 0, usd_1h: 0 },
	agents: [],
	first_main: NO_FIRST,
	first_subagent: NO_FIRST,
	long_output: { calls: 0, all_calls: 0, usd: 0 },
}
const NO_RESULTS: ResultBreakdown = {
	total_usd: 0,
	efforts: [],
	tools: [],
	josh: [],
	commands: [],
	reads: [],
	duplicate_reads: { files: 0, reads: 0, chars: 0 },
}

function audit_with(overrides: Partial<Audit> = {}): Audit {
	return {
		days: 7,
		lane_density: { current: NO_DENSITY, previous: NO_DENSITY },
		total: row('total', 12, 10),
		merges: undefined,
		per_merge: undefined,
		kinds: [],
		tools: [],
		guards: [],
		rewrites: { current: NO_REWRITES, previous: NO_REWRITES },
		phases: [],
		agents: [],
		usage: NO_USAGE,
		results: NO_RESULTS,
		sequences: { runs: [], retries: [] },
		...overrides,
	}
}

// joshuafolkken/kit#7042: the usage breakdown a cost-reduction Issue compares before and after.
describe('cost_audit_format.report_lines — the usage breakdown', () => {
	const usage: UsageBreakdown = {
		cache_write: { tokens_5m: 1_000_000, tokens_1h: 500_000, usd_5m: 1.25, usd_1h: 1 },
		agents: [{ agent_type: 'reviewer', runs: 4, calls: 80, usd: 12 }],
		first_main: { sessions: 3, p50_tokens: 20_800 },
		first_subagent: { sessions: 4, p50_tokens: 6200 },
		long_output: { calls: 5, all_calls: 200, usd: 3 },
	}
	const lines = cost_audit_format.report_lines(audit_with({ usage }))

	it('prints the cache write by lifetime in tokens and dollars', () => {
		expect(lines).toContain(
			'  cache write 5m: 1,000,000 tokens ($1.2500) / 1h: 500,000 tokens ($1.0000)',
		)
	})

	it('prints the first-request context p50 of main sessions and subagent runs', () => {
		expect(lines).toContain(
			'  first request context p50: main 20,800 (3 sessions) / subagent 6,200 (4 runs)',
		)
	})

	it('prints the long-output calls with their share and cost', () => {
		expect(lines).toContain('  output over 2000 tokens: 5 of 200 calls (2.5%, $3.0000)')
	})

	it('prints each agent type runs and calls per run', () => {
		expect(lines).toContain('    reviewer: 4 runs, 20.0 calls/run, $12.0000')
	})

	it('prints none where no subagent ran and no p50 where no session opened', () => {
		const empty = cost_audit_format.report_lines(audit_with())

		expect(empty).toContain('    none')
		expect(empty).toContain(
			'  first request context p50: main none (0 sessions) / subagent none (0 runs)',
		)
	})
})

describe('cost_audit_format.report_lines — the lane-child density line', () => {
	it('prints the lane children calls per request and single-call share beside the previous period', () => {
		const lane_density = {
			current: { requests: 4, calls: 8, single: 1 },
			previous: { requests: 100, calls: 145, single: 79 },
		}

		expect(cost_audit_format.report_lines(audit_with({ lane_density }))).toContain(
			'  lane-child density: 2.00 calls/request, 25.0% single-call (prev 1.45 calls/request, 79.0% single-call)',
		)
	})

	it('prints a zero density, not a division by zero, where no lane child called a tool', () => {
		expect(cost_audit_format.report_lines(audit_with())).toContain(
			'  lane-child density: 0.00 calls/request, 0.0% single-call (prev 0.00 calls/request, 0.0% single-call)',
		)
	})
})

// joshuafolkken/kit#5952: a measurement Issue declares the density, so it has to be a bare number.
describe('cost_audit_format.density_value — the density as one number', () => {
	it('prints the current period calls per request alone, two decimals', () => {
		const lane_density = {
			current: { requests: 4, calls: 8, single: 1 },
			previous: { requests: 100, calls: 145, single: 79 },
		}

		expect(cost_audit_format.density_value(audit_with({ lane_density }))).toBe('2.00')
	})

	it('answers nothing, not a zero, where no lane child made a request', () => {
		expect(cost_audit_format.density_value(audit_with())).toBeUndefined()
	})
})

describe('cost_audit_format.report_lines — the full cache rewrites', () => {
	it('prints the rewrites after a wait and within the TTL beside the previous period', () => {
		const current = { after_wait: { count: 631, usd: 182 }, within_ttl: { count: 2, usd: 0.5 } }
		const lines = cost_audit_format.report_lines(
			audit_with({ rewrites: { current, previous: NO_REWRITES } }),
		)

		expect(lines).toContain('  after a wait of 5 min or more: 631 ($182.0000) (prev 0 ($0.0000))')
		expect(lines).toContain('  within 5 min: 2 ($0.5000) (prev 0 ($0.0000))')
	})
})

const IMPLEMENT_READ = 'implement: read'
const OPUS = 'claude-opus-4-6'
const PHASE_TITLE = 'Lane children by phase'

// joshuafolkken/kit#5936: the lane requests by phase, the four token kinds beside the cost.
describe('cost_audit_format.report_lines — the phase table', () => {
	it('prints each phase with its cost and four token kinds', () => {
		const tokens = { input: 1200, cache_read: 3_400_000, cache_write: 56_000, output: 7800 }
		const lines = cost_audit_format.report_lines(
			audit_with({
				phases: [{ key: IMPLEMENT_READ, tokens, usd: 2.5, models: [], long_calls: 0 }],
			}),
		)

		expect(lines).toContain(
			'  implement: read: $2.5000 — 1,200 / 3,400,000 / 56,000 / 7,800 · 0 calls over 2000',
		)
	})

	// joshuafolkken/kit#6899: under the row, each model's dollars by the same four token types.
	it('prints each model of a phase under it with its dollars by token type', () => {
		const tokens = { input: 0, cache_read: 0, cache_write: 0, output: 0 }
		const models = [{ model: OPUS, input: 0.5, cache_read: 1, cache_write: 0.25, output: 0.75 }]
		const lines = cost_audit_format.report_lines(
			audit_with({ phases: [{ key: IMPLEMENT_READ, tokens, usd: 2.5, models, long_calls: 0 }] }),
		)
		const phase = lines.indexOf('  implement: read: $2.5000 — 0 / 0 / 0 / 0 · 0 calls over 2000')

		expect(lines.filter((line) => line.endsWith('; per model in dollars)'))).toHaveLength(2)
		expect(lines[phase + 1]).toBe(
			'    claude-opus-4-6: $2.5000 — $0.5000 / $1.0000 / $0.2500 / $0.7500',
		)
	})

	it('says none for a period with no lane request', () => {
		const lines = cost_audit_format.report_lines(audit_with())
		const title = lines.findIndex((line) => line.startsWith(PHASE_TITLE))

		expect(lines[title + 1]).toBe('  none')
	})
})

// joshuafolkken/kit#7045: the long-output calls placed by phase, named in the title.
describe('cost_audit_format.report_lines — the long-output calls by phase', () => {
	it('prints each phase with its calls whose output passed 2000 tokens', () => {
		const tokens = { input: 0, cache_read: 0, cache_write: 0, output: 9000 }
		const lines = cost_audit_format.report_lines(
			audit_with({ phases: [{ key: 'plan', tokens, usd: 1, models: [], long_calls: 3 }] }),
		)
		const title = lines.findIndex((line) => line.startsWith(PHASE_TITLE))

		expect(lines[title]).toContain('· calls with output over 2000 tokens;')
		expect(lines[title + 1]).toBe('  plan: $1.0000 — 0 / 0 / 0 / 9,000 · 3 calls over 2000')
	})
})

// joshuafolkken/kit#5971: the lane's delegated units by agent type, in the phase table's shape.
describe('cost_audit_format.report_lines — the agent type table', () => {
	const AGENT_TITLE = 'Lane subagents by agent type'

	it('prints each agent type with its cost and four token kinds', () => {
		const tokens = { input: 10, cache_read: 2000, cache_write: 300, output: 40 }
		const lines = cost_audit_format.report_lines(
			audit_with({
				agents: [{ key: 'subagent: reviewer', tokens, usd: 1.25, models: [], long_calls: 2 }],
			}),
		)
		const title = lines.findIndex((line) => line.startsWith(AGENT_TITLE))

		expect(lines[title + 1]).toBe(
			'  subagent: reviewer: $1.2500 — 10 / 2,000 / 300 / 40 · 2 calls over 2000',
		)
	})

	it('says none for a period with no lane subagent, before the closing regressions', () => {
		const lines = cost_audit_format.report_lines(audit_with())
		const title = lines.findIndex((line) => line.startsWith(AGENT_TITLE))

		const usage = lines.indexOf(USAGE_TITLE)

		expect(lines.slice(title + 1, usage)).toStrictEqual(['  none', ''])
		expect(lines.at(-1)).toBe(NO_REGRESSIONS)
	})
})

const FULLRUN_LINE = '  fullrun: $9.0000 (prev $12.0000, -25.0%)'

// joshuafolkken/kit#6913: a kind row carries its current-period model lines, as a phase row does.
describe('cost_audit_format.report_lines — the session kinds by model', () => {
	it('prints each model of a session kind under it with its dollars by token type', () => {
		const models = [{ model: OPUS, input: 4, cache_read: 2, cache_write: 1, output: 2 }]
		const lines = cost_audit_format.report_lines(
			audit_with({ kinds: [{ ...row('fullrun', 9, 12), models }] }),
		)
		const kind = lines.indexOf(FULLRUN_LINE)

		expect(lines[kind - 1]).toBe(
			'By session kind (this period per model: cost — input / cache read / cache write / output in dollars)',
		)
		expect(lines[kind + 1]).toBe(
			'    claude-opus-4-6: $9.0000 — $4.0000 / $2.0000 / $1.0000 / $2.0000',
		)
	})
})

describe('cost_audit_format.report_lines — the printed report', () => {
	it('prints each row with its change against the previous period', () => {
		const lines = cost_audit_format.report_lines(audit_with({ kinds: [row('fullrun', 9, 12)] }))

		expect(lines).toContain('  total: $12.0000 (prev $10.0000, +20.0%)')
		expect(lines).toContain(FULLRUN_LINE)
	})

	it('marks a row with no previous figure as new, and an empty section as none', () => {
		const lines = cost_audit_format.report_lines(audit_with({ tools: [row('edit', 2, 0)] }))

		expect(lines).toContain('  edit: $2.0000 (prev $0.0000, new)')
		expect(lines).toContain('  none')
	})

	it('prints the effort and tool-result section before the closing regressions line', () => {
		const lines = cost_audit_format.report_lines(audit_with())
		const title = lines.findIndex((line) => line.startsWith('Effort and tool results'))

		expect(title).toBeGreaterThan(0)
		expect(title).toBeLessThan(lines.length - 1)
	})

	it('says the merges were not read when GitHub could not be reached', () => {
		const lines = cost_audit_format.report_lines(audit_with())

		expect(lines).toContain('  merges: not read from GitHub')
		expect(lines.at(-1)).toBe(NO_REGRESSIONS)
	})

	it('flags a regression on its row and names it by section in the closing list', () => {
		const audit = audit_with({
			merges: { current: 2, previous: 4 },
			per_merge: row('per merge', 6, 2.5, true),
			guards: [row('batching', 3, 1, true)],
		})
		const lines = cost_audit_format.report_lines(audit)

		expect(lines).toContain('  merges: 2 (prev 4)')
		expect(lines).toContain('  batching: $3.0000 (prev $1.0000, +200.0%)  regression')
		expect(lines.at(-1)).toBe('Regressions: per merge, guard batching')
	})
})

describe('cost_audit_format.summary_line — the line josh retrospective carries', () => {
	it('gives the total, its change and the regressions', () => {
		expect(cost_audit_format.summary_line(audit_with())).toBe(
			'Cost audit (7d): $12.0000 (+20.0%); regressions: none',
		)
	})

	it('adds the cost per merge when the merges were read', () => {
		const audit = audit_with({ per_merge: row('per merge', 6, 5) })

		expect(cost_audit_format.summary_line(audit)).toBe(
			'Cost audit (7d): $12.0000 (+20.0%), $6.0000 per merge; regressions: none',
		)
	})
})

describe('cost_audit_format.filing_lines — a regression is a filing the retrospective owes', () => {
	it('names every regression and the command that reproduces it', () => {
		const audit = audit_with({ guards: [row('batching', 3, 1, true)] })

		expect(cost_audit_format.filing_lines(audit)).toStrictEqual([
			'File a cost regression: guard batching — reproduce with `pnpm josh cost:audit`',
		])
	})

	it('adds nothing when no row regressed', () => {
		expect(cost_audit_format.filing_lines(audit_with())).toStrictEqual([])
	})
})
