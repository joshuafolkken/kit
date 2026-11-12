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
//
// **A printed text that is no doc section is keyed on the text itself** (joshuafolkken/kit#7111) — the
// ship preconditions `run:entry` and `run:step` both print — so a changed text prints again.

const MARKER_PREFIX = 'josh-section-'
const DIGEST_LENGTH = 16
const TEXT_KEY_PREFIX = 'text\n'

interface PrintedSection {
	document: string
	heading: string
}

function marker_of(key: string): string | undefined {
	const session = process.env[agent_session_environment.SESSION_ID_KEY]

	if (session === undefined) return undefined
	const digest = createHash('sha256')
		.update(`${session}\n${key}`)
		.digest('hex')
		.slice(0, DIGEST_LENGTH)

	return path.join(PLATFORM_TEMP_ROOT, `${MARKER_PREFIX}${digest}`)
}

function section_key(found: PrintedSection): string {
	return `${found.document}\n${found.heading}`
}

function is_key_recorded(key: string): boolean {
	const marker = marker_of(key)

	return marker !== undefined && existsSync(marker)
}

function record_key(key: string): void {
	const marker = marker_of(key)

	if (marker !== undefined) writeFileSync(marker, '')
}

function is_recorded(found: PrintedSection): boolean {
	return is_key_recorded(section_key(found))
}

function record(found: PrintedSection): void {
	record_key(section_key(found))
}

function is_text_recorded(text: string): boolean {
	return is_key_recorded(`${TEXT_KEY_PREFIX}${text}`)
}

function record_text(text: string): void {
	record_key(`${TEXT_KEY_PREFIX}${text}`)
}

function repeat_line(found: PrintedSection): string {
	const fetch = `pnpm josh doc:section ${found.document} "${found.heading}"`

	return `section: ${found.document} → "${found.heading}" — printed earlier this session; after a compaction: ${fetch}`
}

const run_step_section_once = { is_recorded, is_text_recorded, record, record_text, repeat_line }

export { run_step_section_once }
