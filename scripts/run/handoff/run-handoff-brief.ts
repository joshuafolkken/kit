import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import path from 'node:path'
import type { AgentEnvironment } from '#scripts/agent/agent-provider'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { cli_body } from '#scripts/josh/cli-body'
import { durable_state } from '#scripts/josh/durable-state'
import { run_handoff_args, type WorkflowHandoff } from './run-handoff-args'
import { run_handoff_retrospective } from './run-handoff-retrospective'

// **The brief a hand-off starts its child with, and the record of the briefs already handed off.**
// Two consultation sessions in one checkout once shared one fixed brief path, and one handed off the
// brief the other had already filed (joshuafolkken/kit#9166). So each session takes its own path from
// `run:handoff brief-path`, and a brief whose text was handed off before is refused unless `--again`
// says the repeat is meant. The ledger sits in the common git directory, which every lane and every
// consultation session of the clone shares; one row per started child: digest, time, log.

const LEDGER_SUFFIX = '.tsv'
const FIELD_SEPARATOR = '\t'
const ROW_SEPARATOR = '\n'
const DIGEST_ALGORITHM = 'sha256'
// Under the ignored scratch root (`.gitignore` → `.josh/tmp/`), one fresh directory per call.
const BRIEF_ROOT = path.join('.josh', 'tmp')
const BRIEF_DIRECTORY_PREFIX = 'handoff-brief-'
const BRIEF_NAME = 'brief.md'

interface LedgerPorts {
	read_ledger: (target: string) => string | undefined
	append_ledger: (target: string, text: string) => void
}

interface BriefRequest extends Pick<LedgerPorts, 'read_ledger'> {
	environment: AgentEnvironment
	git_directory: string
}

// `digest` is `undefined` for the generated retrospective brief, which is never checked or recorded.
type BriefRead =
	{ kind: 'read'; text: string; digest: string | undefined } | { kind: 'problem'; problem: string }

type WrittenRead =
	{ kind: 'read'; text: string; digest: string } | { kind: 'problem'; problem: string }

interface HandedRow {
	digest: string
	at: string
	log: string
}

// What a started child leaves on the ledger.
interface HandedEntry {
	digest: string | undefined
	git_directory: string
	log: string
}

function digest_of(text: string): string {
	return createHash(DIGEST_ALGORITHM).update(text).digest('hex')
}

function ledger_path(git_directory: string): string {
	return durable_state.path(durable_state.PREFIX.HANDOFF_LEDGER, git_directory, LEDGER_SUFFIX)
}

function row_of(line: string): HandedRow | undefined {
	const [digest, at, log] = line.split(FIELD_SEPARATOR)

	if (digest === undefined || at === undefined || log === undefined) return undefined

	return { digest, at, log }
}

// The latest hand-off of the brief with this digest, or `undefined` when it was never handed off.
function handed_of(ledger: string, digest: string): HandedRow | undefined {
	const rows = ledger.split(ROW_SEPARATOR).map((line) => row_of(line))

	return rows.findLast((row) => row?.digest === digest)
}

function refusal(row: HandedRow): string {
	return [
		`this brief was already handed off at ${row.at}; read that run's log: ${row.log}`,
		`Hand the same brief off again only on purpose, with ${run_handoff_args.AGAIN_FLAG}.`,
	].join('\n')
}

// The retrospective's brief is generated; its close names this session — the backlogrun parent that
// owns the carry — as the mark's owner.
function generated(environment: AgentEnvironment): BriefRead {
	const owner = agent_session_environment.own_session_pid(environment)

	return { kind: 'read', text: run_handoff_retrospective.brief(owner), digest: undefined }
}

function written(brief_file: string): WrittenRead {
	const read = cli_body.read_result(brief_file)

	if ('problem' in read) {
		return { kind: 'problem', problem: `could not read ${brief_file}: ${read.problem}` }
	}

	return { kind: 'read', text: read.text, digest: digest_of(read.text) }
}

function unhanded(read: Extract<WrittenRead, { kind: 'read' }>, request: BriefRequest): BriefRead {
	const ledger = request.read_ledger(ledger_path(request.git_directory)) ?? ''
	const row = handed_of(ledger, read.digest)

	return row === undefined ? read : { kind: 'problem', problem: refusal(row) }
}

// The brief the child starts with: a written one is read as written and refused when already handed off.
function brief_of(handoff: WorkflowHandoff, request: BriefRequest): BriefRead {
	if (handoff.brief_file === undefined) return generated(request.environment)

	const read = written(handoff.brief_file)

	if (read.kind === 'problem' || handoff.again === true) return read

	return unhanded(read, request)
}

// Called once the child has started, so a brief whose child never started can be handed off again.
function record(entry: HandedEntry, at: number, append: LedgerPorts['append_ledger']): void {
	if (entry.digest === undefined) return

	const row = [entry.digest, new Date(at).toISOString(), entry.log].join(FIELD_SEPARATOR)

	append(ledger_path(entry.git_directory), `${row}${ROW_SEPARATOR}`)
}

function append_ledger(target: string, text: string): void {
	mkdirSync(path.dirname(target), { recursive: true })
	appendFileSync(target, text)
}

// A fresh brief path under `cwd`, relative to it; the directory is made, so no two calls share one.
function brief_path(cwd: string): string {
	const root = path.join(cwd, BRIEF_ROOT)

	mkdirSync(root, { recursive: true })

	const directory = mkdtempSync(path.join(root, BRIEF_DIRECTORY_PREFIX))

	return path.relative(cwd, path.join(directory, BRIEF_NAME))
}

const run_handoff_brief = { append_ledger, brief_of, brief_path, digest_of, ledger_path, record }

export type { BriefRead, LedgerPorts }
export { run_handoff_brief }
