import { createHash } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { PLATFORM_TEMP_ROOT } from '#scripts/josh/platform-temporary'

// **A command prints the section that governs it, once per agent session** (joshuafolkken/kit#5626):
// a command with a row in `run_step_section`'s table prints it, so the reader never spends a
// `doc:section` turn fetching it. A second print of the same section in the same session — a re-run,
// or `ship` after `run:review` handed the same step — prints one line naming it instead of the text
// the session already holds. The line carries the `doc:section` fetch, because a compaction keeps the
// session id while it drops the section from context.
//
// **The marker is keyed on the section, not the command**, so two commands one section governs print
// it once between them. It is a per-session cache, so it stays in the temp root (`durable-state.ts`).
// Without a session id (a Codex session, a detached supervisor) nothing is remembered and the section
// always prints: a missing rule costs more than a repeated one.

const MARKER_PREFIX = 'josh-section-'
const DIGEST_LENGTH = 16

interface PrintedSection {
	document: string
	heading: string
}

function marker_of(found: PrintedSection): string | undefined {
	const session = process.env[agent_session_environment.SESSION_ID_KEY]

	if (session === undefined) return undefined
	const digest = createHash('sha256')
		.update(`${session}\n${found.document}\n${found.heading}`)
		.digest('hex')
		.slice(0, DIGEST_LENGTH)

	return path.join(PLATFORM_TEMP_ROOT, `${MARKER_PREFIX}${digest}`)
}

function is_recorded(found: PrintedSection): boolean {
	const marker = marker_of(found)

	return marker !== undefined && existsSync(marker)
}

function record(found: PrintedSection): void {
	const marker = marker_of(found)

	if (marker !== undefined) writeFileSync(marker, '')
}

function repeat_line(found: PrintedSection): string {
	const fetch = `pnpm josh doc:section ${found.document} "${found.heading}"`

	return `section: ${found.document} → "${found.heading}" — printed earlier this session; after a compaction: ${fetch}`
}

const run_step_section_once = { is_recorded, record, repeat_line }

export { run_step_section_once }
