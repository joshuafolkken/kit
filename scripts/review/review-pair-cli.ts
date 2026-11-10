#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { cost_pricing } from '#scripts/cost-runtime/cost-pricing'
import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import { stamp_file } from '#scripts/josh/stamp-file'
import { cli_flags } from '#scripts/lib/cli-flags'
import { run_ship_review } from '#scripts/run/ship/run-ship-review'
import { z } from 'zod'
import { review_pair } from './review-pair'
import { review_pair_log, type PairFinding, type PairSide } from './review-pair-log'
import { review_record_slot } from './review-record-slot'

// `josh review:pair` — record one paired comparison (joshuafolkken/kit#6902): the Opus reviewer's
// findings from the code slot, the Sonnet reviewer's from the paired findings file, and each agent's
// cost from its transcript, appended to `review-pairs.jsonl`. It reads the code slot and writes the
// ledger alone, so neither `review:attest` nor the merge gate sees the paired result.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const NONE_LINE = 'none'
const USD_DIGITS = 2
const SEVERITY_PATTERN = /^[^:]+:(?<severity>[^:]+):/u
const USAGE = 'Usage: josh review:pair --issue <N> --opus-agent <id> --sonnet-agent <id>'
const OPTIONS = {
	issue: { type: 'string' },
	'opus-agent': { type: 'string' },
	'sonnet-agent': { type: 'string' },
} as const
const request_schema = z.object({
	issue: z.coerce.number().int().positive(),
	'opus-agent': z.string().min(1),
	'sonnet-agent': z.string().min(1),
})

interface AgentCost {
	model?: string | undefined
	usd?: number
}

interface PairSources {
	opus_text: () => string | undefined
	sonnet_text: () => string | undefined
	cost_of: (agent: string) => AgentCost
	log_path?: string | undefined
}

interface PairRequest {
	issue: number
	opus_agent: string
	sonnet_agent: string
}

function refuse(text: string): number {
	console.error(text)

	return FAILURE_EXIT_CODE
}

// A delegated unit's transcript is `<session>/subagents/agent-<id>.jsonl` (`cost-transcript.ts`); a
// headless reviewer the ship or a lane's broker started is a session of its own (joshuafolkken/kit#7020).
function is_agent_session(session_id: string, agent: string): boolean {
	return session_id === agent || session_id.endsWith(`/agent-${agent}`)
}

function agent_cost(agent: string): AgentCost {
	const directories = cost_transcript.transcript_directories(process.cwd())
	const file = cost_transcript
		.list_sessions_across(directories)
		.find((session) => is_agent_session(session.session_id, agent))
	if (file === undefined) return {}
	const { records } = cost_transcript.read_session(file)

	return { model: records[0]?.model, usd: cost_pricing.cost_of(records) }
}

function to_finding(line: string): PairFinding {
	const spec = review_record_slot.unmarked(line)

	return { severity: SEVERITY_PATTERN.exec(spec)?.groups?.['severity'] ?? '', line: spec }
}

// A reviewer's findings text, `none` read as no finding; `undefined` where it is missing or unreadable.
function findings_of(text: string | undefined): ReadonlyArray<PairFinding> | undefined {
	const verdict = run_ship_review.read_verdict(text?.trim() === NONE_LINE ? '' : text)

	if (verdict.kind === run_ship_review.VERDICT.INVALID) return undefined

	return verdict.report.map((line) => to_finding(line))
}

function side(agent: string, text: string | undefined, sources: PairSources): PairSide | undefined {
	const findings = findings_of(text)

	return findings === undefined
		? undefined
		: { agent, ...sources.cost_of(agent), findings: [...findings] }
}

function request_of(argv: ReadonlyArray<string>): PairRequest | undefined {
	const values = request_schema.safeParse(cli_flags.arguments_of(argv, OPTIONS)?.values).data

	if (values === undefined) return undefined

	return {
		issue: values.issue,
		opus_agent: values['opus-agent'],
		sonnet_agent: values['sonnet-agent'],
	}
}

function dollars(usd: number | undefined): string {
	return usd === undefined ? '$?' : `$${usd.toFixed(USD_DIGITS)}`
}

function summary(opus: PairSide, sonnet: PairSide): string {
	const sides = [
		`opus ${String(opus.findings.length)} findings ${dollars(opus.usd)}`,
		`sonnet ${String(sonnet.findings.length)} findings ${dollars(sonnet.usd)}`,
	]

	return `review:pair recorded — ${sides.join(' · ')}`
}

function record(request: PairRequest, sources: PairSources): number {
	const opus = side(request.opus_agent, sources.opus_text(), sources)
	const sonnet = side(request.sonnet_agent, sources.sonnet_text(), sources)

	if (opus === undefined || sonnet === undefined) return refuse('a reviewer left no findings')
	const line = { at: new Date().toISOString(), issue: request.issue, opus, sonnet }
	if (!review_pair_log.record(line, sources.log_path)) return refuse('no ledger to record into')
	console.info(summary(opus, sonnet))

	return SUCCESS_EXIT_CODE
}

const SOURCES: PairSources = {
	opus_text: () => review_record_slot.slot_text(false),
	sonnet_text: () => stamp_file.read_stamp_text(review_pair.paths().findings),
	cost_of: agent_cost,
	log_path: review_pair_log.target(),
}

function run(argv: ReadonlyArray<string>, sources: PairSources = SOURCES): number {
	const request = request_of(argv)

	return request === undefined ? refuse(USAGE) : record(request, sources)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = run(process.argv.slice(ARGV_OFFSET))
}

const review_pair_cli = { findings_of, is_agent_session, run }

export type { PairSources }
export { review_pair_cli }
