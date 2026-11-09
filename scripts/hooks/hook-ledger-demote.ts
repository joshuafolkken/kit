import { hook_demoted } from './hook-demoted'
import type { LedgerGroup, LedgerLine } from './hook-ledger-read'

// `josh hook:ledger --demote` (joshuafolkken/kit#6591): the rules the ledger shows mostly refusing work
// the same session then ran — at least `MIN_REFUSALS` refusals over the period, `MIN_PASSED_SHARE` or
// more of them passing later (#6587's rule). `--apply` records them in `.josh/hook-demoted.json`, where
// the PreToolUse guard turns their refusals into notices (`hook-demoted.ts`); `--restore <rule>` takes
// one back out.

const MIN_REFUSALS = 10
const MIN_PASSED_SHARE = 0.5
const PREFIX = 'josh hook:ledger:'

function is_mostly_passed(group: LedgerGroup, passed: ReadonlySet<LedgerLine>): boolean {
	const passed_count = group.lines.filter((line) => passed.has(line)).length

	return group.lines.length >= MIN_REFUSALS && passed_count >= group.lines.length * MIN_PASSED_SHARE
}

function candidates(
	groups: ReadonlyArray<LedgerGroup>,
	passed: ReadonlySet<LedgerLine>,
): Array<string> {
	const rules = groups.filter((group) => is_mostly_passed(group, passed)).map((group) => group.rule)

	return [...new Set(rules)]
}

// The candidates, one line each, and — with `--apply` — the file they were added to.
async function report(
	rules: ReadonlyArray<string>,
	should_apply: boolean,
	file: string,
): Promise<string> {
	if (rules.length === 0) return `${PREFIX} no rule meets the demotion rule`

	const listed = rules.map((rule) => `${PREFIX} demote ${rule}`)

	if (!should_apply) return listed.join('\n')

	await hook_demoted.write_rules(new Set([...hook_demoted.read_rules(file), ...rules]), file)

	return [...listed, `${PREFIX} recorded in ${file}`].join('\n')
}

async function restore(rule: string, file: string): Promise<string> {
	const demoted = hook_demoted.read_rules(file)

	if (!demoted.has(rule)) return `${PREFIX} ${rule} is not demoted`

	await hook_demoted.write_rules(new Set([...demoted].filter((kept) => kept !== rule)), file)

	return `${PREFIX} restored ${rule} to blocking`
}

const hook_ledger_demote = { candidates, report, restore }

export { hook_ledger_demote }
