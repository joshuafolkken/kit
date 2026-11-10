import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { agent_session_role } from '#scripts/agent/agent-session-role'
import { git_branch } from '#scripts/git/git-branch'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { git_spawn } from '#scripts/git/git-spawn'
import { json_value } from '#scripts/lib/json-value'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { time_transcript_line } from '#scripts/time-runtime/time-transcript-line'
import { z } from 'zod'
import { hook_context, type HookContext } from './hook-context'

// Every refusal a hook makes, one JSON line each, so a rule can be judged by how often it spoke.
//
// **The stamps in `scripts/josh/hook-decision.ts` answer "has this fired yet", never "how often"**,
// and they are overwritten on the next refusal. This ledger keeps what they drop: which hook, which
// rule, on which call, in which session — what a per-rule count reads (`josh hook:ledger`,
// joshuafolkken/kit#6664).
//
// **It lives in the common git directory, not in `.josh/`.** Every lane appends to the one file of
// its repository, a lane's worktree is removed with its lines otherwise, and nothing under `.git` is
// ever staged with a run.

const LEDGER_DIRECTORY = 'hook-ledger'
const LEDGER_EXTENSION = '.jsonl'
const COMMAND_HEAD = 80
// A reason with no `⛔ <rule>:` opening is named by its own opening, as long as `rule-value.ts` reads.
const RULE_HEAD = 48
// A Stop payload names no tool; the stop itself is the call that was refused.
const STOP_TOOL = 'Stop'
const COMMAND_FIELDS: ReadonlyArray<string> = ['command', 'file_path', 'pattern', 'url', 'prompt']

const input_schema = z.record(z.string(), z.unknown())

// Each field falls back on its own, so a `null` transcript (`hook-decision.ts` reads it nullish) keeps
// the tool and command it came with; `command_of` reads the input whatever its shape.
const payload_schema = z.object({
	tool_name: z.string().catch(STOP_TOOL),
	tool_input: z.unknown().optional(),
	transcript_path: z.string().catch(''),
})

const EMPTY_PAYLOAD = payload_schema.parse({})

// The refusing shape a `Stop` hook writes (`stop_rules.block_envelope`); a notice alone holds nothing.
const block_schema = z.object({ decision: z.literal('block'), reason: z.string() })

interface HookLedgerEntry {
	at: string
	hook: string
	rule: string
	tool: string
	role: string
	// Absent where the branch names no Issue.
	issue: number | undefined
	session: string
	command: string
}

interface Refusal {
	hook: string
	reason: string
	raw_payload: string
}

function rule_of(reason: string): string {
	const guard = time_transcript_line.guard_from_refusal(reason)

	return guard === '' ? reason.trim().slice(0, RULE_HEAD) : guard
}

// The call's opening: the shell line, the file or the pattern — whichever field the tool carries.
function command_of(input: unknown): string {
	const fields = input_schema.safeParse(input).data ?? {}
	const value = COMMAND_FIELDS.map((key) => fields[key]).find((field) => typeof field === 'string')

	return typeof value === 'string' ? value.slice(0, COMMAND_HEAD) : ''
}

function entry_of(
	refusal: Refusal,
	branch: string,
	now: Date,
	environment: HookContext['env'],
): HookLedgerEntry {
	const payload = json_value.parse_with(refusal.raw_payload, payload_schema) ?? EMPTY_PAYLOAD

	return {
		at: now.toISOString(),
		hook: refusal.hook,
		rule: rule_of(refusal.reason),
		tool: payload.tool_name,
		role: environment[agent_session_role.KEY] ?? '',
		issue: git_branch.issue_from_branch(branch),
		session: payload.transcript_path,
		command: command_of(payload.tool_input),
	}
}

// `undefined` outside a repository and under a test run, so a hook suite never writes the real ledger.
function ledger_directory(context: HookContext = hook_context.from_process()): string | undefined {
	if (context.env['VITEST'] !== undefined) return undefined

	const common = git_common_directory.repository(context.cwd)

	return common === undefined
		? undefined
		: path.join(common, git_common_directory.STATE_DIRECTORY, LEDGER_DIRECTORY)
}

async function append(entry: HookLedgerEntry, directory: string): Promise<void> {
	const day = observation_ledger_home.ledger_date(new Date(entry.at))

	await mkdir(directory, { recursive: true })
	await appendFile(path.join(directory, `${day}${LEDGER_EXTENSION}`), `${JSON.stringify(entry)}\n`)
}

// **The ledger only counts, so it never fails the hook.** A line it could not write leaves the
// refusal standing exactly as it was emitted.
async function record(
	refusal: Refusal,
	directory: string | undefined = ledger_directory(),
	context: HookContext = hook_context.from_process(),
): Promise<void> {
	if (directory === undefined) return

	try {
		const branch = await git_spawn.read(['-C', context.cwd, 'rev-parse', '--abbrev-ref', 'HEAD'])

		await append(entry_of(refusal, branch, new Date(), context.env), directory)
	} catch {
		// Nothing to report to: the hook has already answered the call.
	}
}

// The hooks' one call: nothing is written for an outcome that refused nothing.
async function record_reason(
	hook: string,
	reason: string | undefined,
	raw_payload: string,
	context: HookContext = hook_context.from_process(),
): Promise<void> {
	if (reason !== undefined) {
		await record({ hook, reason, raw_payload }, ledger_directory(context), context)
	}
}

// The reason a written `Stop` envelope sends the turn back with, or `undefined` for one that holds nothing.
function blocked_reason(envelope: string): string | undefined {
	return json_value.parse_with(envelope, block_schema)?.reason
}

const hook_ledger = {
	blocked_reason,
	command_of,
	ledger_directory,
	record,
	record_reason,
	rule_of,
}

export type { HookLedgerEntry }
export { hook_ledger }
