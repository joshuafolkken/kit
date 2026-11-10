import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it, vi } from 'vitest'
import { review_pair_cli, type PairSources } from './review-pair-cli'
import { review_pair_log } from './review-pair-log'

// joshuafolkken/kit#6902: `josh review:pair` records both reviewers' findings with severity and each
// agent's cost, and reads the code slot without writing anything a gate reads.

const OPUS_TEXT = 'fixed bug-risks:high:a.ts:3 — the guard is inverted.'
const SONNET_TEXT = 'tests:medium:a.test.ts — no case pins the guard.\ncomments:low:b.ts — unclear.'
const ARGV = ['--issue', '6902', '--opus-agent', 'opus1', '--sonnet-agent', 'sonnet1']
const COSTS: Record<string, { model: string; usd: number }> = {
	opus1: { model: 'claude-opus-5-5', usd: 1.5 },
	sonnet1: { model: 'claude-sonnet-5-5', usd: 0.4 },
}
const make_directory = temporary_directory()

function sources(log_path: string, overrides: Partial<PairSources> = {}): PairSources {
	return {
		opus_text: () => OPUS_TEXT,
		sonnet_text: () => SONNET_TEXT,
		cost_of: (agent) => COSTS[agent] ?? {},
		log_path,
		...overrides,
	}
}

function fresh_log(): string {
	return path.join(make_directory('review-pair-log-'), 'josh', 'review-pairs.jsonl')
}

describe('review_pair_cli.findings_of', () => {
	it('reads each line with its severity, a fixed mark dropped', () => {
		expect(review_pair_cli.findings_of(OPUS_TEXT)).toStrictEqual([
			{ severity: 'high', line: 'bug-risks:high:a.ts:3 — the guard is inverted.' },
		])
	})

	it('reads none as no finding and a missing file as unreadable', () => {
		expect(review_pair_cli.findings_of('none\n')).toStrictEqual([])
		expect(review_pair_cli.findings_of(undefined)).toBeUndefined()
	})
})

// joshuafolkken/kit#7020: a reviewer the ship or a lane's broker started headless is a session of its own.
describe('review_pair_cli.is_agent_session', () => {
	it("matches a delegated unit's transcript and a headless session's own", () => {
		expect(review_pair_cli.is_agent_session('root/subagents/agent-abc', 'abc')).toBe(true)
		expect(review_pair_cli.is_agent_session('abc', 'abc')).toBe(true)
		expect(review_pair_cli.is_agent_session('other-abc', 'abc')).toBe(false)
	})
})

describe('review_pair_cli.run', () => {
	it('appends one comparison with both sides, their severities and costs', () => {
		const log = fresh_log()

		expect(review_pair_cli.run(ARGV, sources(log))).toBe(0)
		const [line] = review_pair_log.read(log)

		expect(line?.issue).toBe(6902)
		expect(line?.opus).toMatchObject({ agent: 'opus1', ...COSTS['opus1'] })
		expect(line?.sonnet.usd).toBe(0.4)
		expect(line?.sonnet.findings.map((finding) => finding.severity)).toStrictEqual([
			'medium',
			'low',
		])
	})

	it('reads the code slot once and writes only the pair ledger', () => {
		const opus_text = vi.fn(() => OPUS_TEXT)
		const log = fresh_log()

		expect(review_pair_cli.run(ARGV, sources(log, { opus_text }))).toBe(0)
		expect(opus_text).toHaveBeenCalledOnce()
		expect(review_pair_log.read(log)).toHaveLength(1)
	})

	it('refuses an argv without both agents, and a reviewer that left no findings', () => {
		const log = fresh_log()

		expect(review_pair_cli.run(['--issue', '6902'], sources(log))).toBe(1)
		expect(review_pair_cli.run(ARGV, sources(log, { sonnet_text: () => undefined }))).toBe(1)
		expect(review_pair_log.read(log)).toStrictEqual([])
	})
})
