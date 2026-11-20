import { cost_blocks } from '#scripts/cost-runtime/cost-blocks'
import { cost_pricing } from '#scripts/cost-runtime/cost-pricing'
import { lane_child_invocation } from '#scripts/lane/lane-child-invocation'
import { time_shell } from '#scripts/time-runtime/time-shell'
import type { TranscriptLine } from '#scripts/time-runtime/time-transcript-line'
import { cost_audit_kind } from './cost-audit-kind'
import type { AuditSession } from './cost-audit-read'

// Why a `resume` session was started, for `josh cost:audit`'s resume table (joshuafolkken/kit#8311).
//
// **The trigger is read off the transcripts, never a recorded field**, so the table covers the sessions
// that ran before it existed. An outage and a ship stop are named by their prompt's wording, which
// `lane-child-invocation.ts` writes from the markers read here. A cut's prompt says only that a cut was
// carried, so which cut is read off the lane's session before it: its last `run:cut` without `--impl`
// was the pre-gate cut; with `--impl`, a review command before it marks the cut a held review round
// hands to a fresh session (`run-chain-review-fix.ts`), and none an implementation cut. A session the
// rules do not place is `unknown`, still counted.

const IMPLEMENT_CUT = 'implement cut'
const PRE_GATE_CUT = 'pre-gate cut'
const REVIEW_FIX_CUT = 'review-fix cut'
const OUTAGE = 'API outage'
const SHIP_STOP = 'ship stop'
const UNKNOWN = 'unknown'
// A cut resume until the lane's session before it places it.
const CUT = 'cut'
const TRIGGERS = [IMPLEMENT_CUT, PRE_GATE_CUT, REVIEW_FIX_CUT, OUTAGE, SHIP_STOP, UNKNOWN] as const
const CUT_COMMAND = 'run:cut'
const IMPL_FLAG = '--impl'
const RESUME_FLAG = '--resume'
const REVIEW_COMMANDS: ReadonlyArray<string> = ['run:review', 'run:chain', 'review:record']

// The ship stop's prompt carries the failed output, so its marker is tried before the cut's.
const PROMPT_RULES: ReadonlyArray<readonly [string, string]> = [
	[lane_child_invocation.OUTAGE_MARKER, OUTAGE],
	[lane_child_invocation.SHIP_STOP_MARKER, SHIP_STOP],
	[lane_child_invocation.CUT_MARKER, CUT],
]

interface TriggerTotal {
	sessions: number
	usd: number
}

interface TriggerRow {
	key: string
	current: TriggerTotal
	previous: TriggerTotal
}

interface Classified {
	kind: string
	trigger: string | undefined
}

// The trigger a `resume` session's opening prompt names, `undefined` for every other kind.
function prompt_trigger(kind: string, prompt: string): string | undefined {
	if (kind !== cost_audit_kind.RESUME) return undefined

	return PROMPT_RULES.find(([marker]) => prompt.includes(marker))?.[1] ?? UNKNOWN
}

// A session's kind and trigger from the kind its opening prompt gave and every user prompt it holds,
// the opening one first. The outage relaunch resumes the stopped session (`lane-resume.ts`), so its
// prompt follows the opening `fullrun` one: any prompt naming the outage makes the session an outage
// resume.
function classify(kind: string, prompts: ReadonlyArray<string>): Classified {
	const is_outage = prompts.some((prompt) => prompt.includes(lane_child_invocation.OUTAGE_MARKER))

	if (is_outage) return { kind: cost_audit_kind.RESUME, trigger: OUTAGE }

	return { kind, trigger: prompt_trigger(kind, prompts[0] ?? '') }
}

function commands_of(lines: ReadonlyArray<TranscriptLine>): Array<string> {
	return lines
		.flatMap((line) => line.blocks)
		.filter(
			(block) => block.type === cost_blocks.TOOL_USE_TYPE && block.name === cost_blocks.BASH_TOOL,
		)
		.map((block) => time_shell.bash_command(block.input))
}

function runs(command: string, names: ReadonlyArray<string>): boolean {
	const ran = time_shell.josh_commands_of(command)

	return names.some((name) => ran.includes(`${time_shell.JOSH_PREFIX}${name}`))
}

function is_cut(command: string): boolean {
	return runs(command, [CUT_COMMAND]) && !command.includes(RESUME_FLAG)
}

// The cut the lane's session before a cut resume ended on, read off its commands.
function cut_trigger(lines: ReadonlyArray<TranscriptLine>): string {
	const commands = commands_of(lines)
	const cut = commands.findLast((command) => is_cut(command))

	if (cut === undefined) return UNKNOWN
	if (!cut.includes(IMPL_FLAG)) return PRE_GATE_CUT

	const before = commands.slice(0, commands.lastIndexOf(cut))

	return before.some((command) => runs(command, REVIEW_COMMANDS)) ? REVIEW_FIX_CUT : IMPLEMENT_CUT
}

// A lane child's own session: a brokered reviewer's sits in the lane directory too.
function is_child(session: AuditSession): boolean {
	return session.is_lane && session.kind !== cost_audit_kind.REVIEW
}

function placed(session: AuditSession, before: AuditSession | undefined): AuditSession {
	if (session.trigger !== CUT) return session

	return { ...session, trigger: before === undefined ? UNKNOWN : cut_trigger(before.lines) }
}

// The sessions, oldest first, each cut resume placed by its lane's child session before it.
function with_triggers(sessions: ReadonlyArray<AuditSession>): Array<AuditSession> {
	const last = new Map<number, AuditSession>()

	return sessions.map((session) => {
		const before = session.issue === undefined ? undefined : last.get(session.issue)

		if (is_child(session) && session.issue !== undefined) last.set(session.issue, session)

		return placed(session, before)
	})
}

function is_counted(session: AuditSession): boolean {
	return session.kind === cost_audit_kind.RESUME && session.records.length > 0
}

function add_session(totals: Map<string, TriggerTotal>, session: AuditSession): void {
	const key = session.trigger ?? UNKNOWN
	const earlier = totals.get(key) ?? { sessions: 0, usd: 0 }

	totals.set(key, {
		sessions: earlier.sessions + 1,
		usd: earlier.usd + cost_pricing.cost_of(session.records),
	})
}

// The resume sessions holding a request in `sessions`, already cut to one window, by trigger.
function totals_of(sessions: ReadonlyArray<AuditSession>): Map<string, TriggerTotal> {
	const totals = new Map<string, TriggerTotal>()

	for (const session of sessions) {
		if (is_counted(session)) add_session(totals, session)
	}

	return totals
}

// Every trigger in a fixed order, both periods, so a zero row still shows.
function rows_of(
	current: ReadonlyArray<AuditSession>,
	previous: ReadonlyArray<AuditSession>,
): Array<TriggerRow> {
	const now = totals_of(current)
	const before = totals_of(previous)
	const zero: TriggerTotal = { sessions: 0, usd: 0 }

	return TRIGGERS.map((key) => ({
		key,
		current: now.get(key) ?? zero,
		previous: before.get(key) ?? zero,
	}))
}

const cost_audit_resume = {
	CUT,
	IMPLEMENT_CUT,
	OUTAGE,
	PRE_GATE_CUT,
	REVIEW_FIX_CUT,
	SHIP_STOP,
	UNKNOWN,
	classify,
	cut_trigger,
	prompt_trigger,
	rows_of,
	with_triggers,
}

export type { Classified, TriggerRow, TriggerTotal }
export { cost_audit_resume }
