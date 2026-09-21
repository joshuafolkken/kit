import { existsSync, readFileSync } from 'node:fs'
import { json_value } from '#scripts/lib/json-value'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'

// The trigger and the delivered text behind the `rule-body` row of `delivered-rules.ts`
// (joshuafolkken/kit#2272). It delivers the residency questions at the one moment they are skipped —
// the edit that writes a rule into prose.
//
// **The gap it closes.** joshuafolkken/kit#2117 put question 0 (is the answer computable, so it is a
// decision oracle) into the residency criterion and built `pnpm josh oracle:list`, but nothing made
// that question fire: a new computable rule could still be written into prose and no test would fail,
// so friction ran one way only — toward more prose. The criterion lived in `residency.md`, and
// whether a run read it before writing a rule was left to judgement. This row is the firing.
//
// **The trigger is the append, not the edit.** A rule delivered on *every* edit to these files would
// speak on typo fixes, link swaps and deletions — the wrong-turn firing `rule-delivery.md` calls worse
// than no hook at all. So the trigger reads the edit's own text: a rule body is a net addition of
// prose, which a deletion (net negative), a typo (net near zero) and a link swap (net zero once the
// URL is stripped) all fail. What stays is the case the Issue names — writing rule prose into a rule
// document.
//
// **No `decide`, so once per run.** The refusal changes what the run *knows* — that a new rule owes
// question 0 and the ordering question — which is the shape `rule-delivery.md` says once-per-run is
// right for: told once, the run applies it to every later rule it writes. It declares no `keeps`,
// because keeping the rule is *not* writing the prose, which is the absence of a call rather than a
// call (`git-force.ts`).

// The two edit tools the `PreToolUse` matcher routes here. A `Write` carries the whole new file; an
// `Edit` carries the region as `old_string` / `new_string`.
const EDIT_TOOL = 'Edit'
const WRITE_TOOL = 'Write'

// The three rule-document families question 0 must be pushed at: the resident source, the
// collaboration-workflow prompts, and the skill bodies. Anchored at a path separator or the string
// start so a substring like `my-prompts/` cannot match. Split into three so no single pattern carries
// the whole alternation.
const CLAUDE_DOCUMENT = /(?:^|\/)CLAUDE\.md$/u
const PROMPT_DOCUMENT = /(?:^|\/)prompts\/.+\.md$/u
const SKILL_DOCUMENT = /(?:^|\/)\.claude\/skills\/.+\.md$/u

function is_rule_document(file_path: string): boolean {
	return (
		CLAUDE_DOCUMENT.test(file_path) ||
		PROMPT_DOCUMENT.test(file_path) ||
		SKILL_DOCUMENT.test(file_path)
	)
}

// A markdown link target (`](url)`) and a bare URL, blanked before the net-length measure so a link
// swap — the change confined to a URL — reads as no prose added. The link target keeps its brackets so
// only the URL is removed, and both spellings are stripped from old and new alike.
const LINK_TARGET = /\]\([^)]*\)/gu
const BARE_URL = /https?:\/\/\S+/gu

function prose_of(text: string): string {
	return text.replaceAll(LINK_TARGET, ']()').replaceAll(BARE_URL, '')
}

// A rule body is at least a sentence of guidance, and a trigger-plus-pointer line runs well past this.
// Below it a change is a typo, a word tweak or a link swap, not a new rule — the threshold is what
// keeps the firing on the wrong turn from being worse than no hook.
const MIN_APPENDED_PROSE = 120

function adds_rule_prose(old_text: string, new_text: string): boolean {
	return prose_of(new_text).length - prose_of(old_text).length >= MIN_APPENDED_PROSE
}

function string_field(input: Record<string, unknown>, key: string): string {
	const value = input[key]

	return typeof value === 'string' ? value : ''
}

// The file's current text, read synchronously before the write lands so a `Write` has an `old` to
// measure against. Injected so the suite controls it without touching the real filesystem, the way
// `file-body.ts` injects its existence check. A new file reads as empty, so its whole body is added.
function read_existing(file_path: string): string {
	return existsSync(file_path) ? readFileSync(file_path, 'utf8') : ''
}

function texts_of(
	name: string,
	input: Record<string, unknown>,
	read: (file_path: string) => string,
): { old_text: string; new_text: string } {
	if (name === WRITE_TOOL) {
		return {
			old_text: read(string_field(input, 'file_path')),
			new_text: string_field(input, 'content'),
		}
	}

	return {
		old_text: string_field(input, 'old_string'),
		new_text: string_field(input, 'new_string'),
	}
}

function is_edit_tool(name: string): boolean {
	return name === EDIT_TOOL || name === WRITE_TOOL
}

// The call's input when it is an edit of a rule document, and `undefined` otherwise. The tool-name and
// path tests run before the text read, so an ordinary edit pays nothing and a `Write`'s file read
// happens only for a rule document.
function rule_document_input(call: GuardedCall): Record<string, unknown> | undefined {
	if (!is_edit_tool(call.name) || !json_value.is_record(call.input)) return undefined

	return is_rule_document(string_field(call.input, 'file_path')) ? call.input : undefined
}

// The trigger: an `Edit` or `Write` that adds rule prose to a rule document.
function writes_rule_prose(
	call: GuardedCall,
	read: (file_path: string) => string = read_existing,
): boolean {
	const input = rule_document_input(call)

	if (input === undefined) return false

	const { old_text, new_text } = texts_of(call.name, input, read)

	return adds_rule_prose(old_text, new_text)
}

// The instruction in the shape a refusal can carry: what the edit is doing, the two questions it
// skips, the commands that answer them, and the reissue every once-per-run delivery needs.
const RULE_BODY_REASON =
	'⛔ rule written into prose: this edit adds rule text to CLAUDE.md, a `prompts/**` doc or a skill ' +
	'body. Before it lands, run the residency questions the addition skips. A rule whose answer is ' +
	'computable from mechanically readable inputs should be a decision oracle, not prose — question 0; ' +
	'`pnpm josh oracle:list` lists the existing oracles a new one joins (single source ' +
	'`scripts/rules/decision-oracle.ts`). A rule that decides *when* or *in what order* to act belongs ' +
	'in the run driver, not prose — the ordering question; `pnpm josh run:step` is the state machine a ' +
	'sequencing rule moves into. Only a rule that is neither — not computable, not ordering — stays ' +
	'prose, and then as a trigger-plus-pointer line rather than a second copy of its procedure. The ' +
	'criterion is `prompts/collaboration-workflow/residency.md` (question 0 and the ordering question); ' +
	'the delivery enumeration is `prompts/collaboration-workflow/rule-delivery.md`. This fires once per ' +
	'run — once you have confirmed the rule can be neither an oracle nor an ordering step, reissue this ' +
	'edit and it will go through.'

// The row itself, so `delivered-rules.ts` spreads one entry. No `decide` (once per run) and no `keeps`
// (not writing the prose is the absence of a call, not a call).
const ROW = {
	id: 'rule-body',
	is_trigger: writes_rule_prose,
	reason: RULE_BODY_REASON,
}

const rule_body_guard = {
	RULE_BODY_REASON,
	ROW,
	adds_rule_prose,
	is_rule_document,
	prose_of,
	writes_rule_prose,
}

export { rule_body_guard }
