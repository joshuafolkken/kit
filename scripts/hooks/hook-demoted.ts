import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { GuardOutcome } from '#scripts/josh/hook-decision'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import type { HookContext } from './hook-context'
import { hook_ledger } from './hook-ledger'

// The guard rules demoted from blocking to notice (joshuafolkken/kit#6591). `josh hook:ledger --demote
// --apply` records a rule whose refusals the same session mostly went on to run; the PreToolUse guard
// then returns that rule's refusal as a notice — its text kept under a header saying the call ran, so a
// refusal's "reissue it" is not obeyed twice — and lets the call run. **The file is tracked**, so a demotion is reviewed and reverted like code; the ledger still counts
// the demoted refusal, so the weekly review (`retrospective.md`) reads what it would have stopped.

const DEMOTED_FILE = '.josh/hook-demoted.json'
const NOTICE_HEADER =
	'ℹ Demoted rule — this call ran; do not reissue it. The refusal it would have given:\n'
const INDENT = '\t'
const rules_schema = z.object({ rules: z.array(z.string()) })

// A missing or unreadable file demotes nothing.
function read_rules(file = DEMOTED_FILE): ReadonlySet<string> {
	try {
		return new Set(json_value.parse_with(readFileSync(file, 'utf8'), rules_schema)?.rules)
	} catch {
		return new Set()
	}
}

// Under a test run the tracked file is not read, so a guard suite never depends on what was demoted.
function rules(environment: HookContext['env'] = process.env): ReadonlySet<string> {
	return environment['VITEST'] === undefined ? read_rules() : new Set()
}

async function write_rules(demoted: ReadonlySet<string>, file = DEMOTED_FILE): Promise<void> {
	const sorted = [...demoted].toSorted((left, right) => left.localeCompare(right))
	const body = JSON.stringify({ rules: sorted }, undefined, INDENT)

	await mkdir(path.dirname(file), { recursive: true })
	await writeFile(file, `${body}\n`)
}

function is_demoted(reason: string, demoted: ReadonlySet<string>): boolean {
	return demoted.has(hook_ledger.rule_of(reason))
}

// The first refusal whose rule is not demoted blocks; where every refusal is demoted, the first one
// speaks as a notice. `undefined` where nothing refused.
function verdict(
	reasons: ReadonlyArray<string>,
	demoted: ReadonlySet<string>,
): GuardOutcome | undefined {
	const blocking = reasons.find((reason) => !is_demoted(reason, demoted))

	if (blocking !== undefined) return { reason: blocking, notice: undefined, fault: undefined }

	const [first] = reasons

	return first === undefined
		? undefined
		: { reason: undefined, notice: `${NOTICE_HEADER}${first}`, fault: undefined }
}

// The refusal a demoted notice stood for, so the ledger records it; `undefined` for any other notice.
function refusal_of(notice: string | undefined, demoted: ReadonlySet<string>): string | undefined {
	if (notice?.startsWith(NOTICE_HEADER) !== true) return undefined

	const reason = notice.slice(NOTICE_HEADER.length)

	return is_demoted(reason, demoted) ? reason : undefined
}

const hook_demoted = {
	DEMOTED_FILE,
	NOTICE_HEADER,
	read_rules,
	refusal_of,
	rules,
	verdict,
	write_rules,
}

export { hook_demoted }
