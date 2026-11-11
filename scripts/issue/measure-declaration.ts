import { z } from 'zod'
import { issue_body_keys } from './issue-body-keys'
import { markdown_section } from './markdown-section'

// joshuafolkken/kit#4621: a follow-up measurement ("measure K merges after #N") took a lane for 20–40
// minutes to run one command and compare its value with a bound — work `backlog:drive` can do itself.
// The body declares that command and the bound once, under the background heading, so the drive runs
// it when the issue comes due and closes it on a pass; only a miss or an unreadable value takes a lane.
//
// **The value is the command's last non-empty output line, read as one number.** Anything else — a
// unit, a sentence, a failure — is unreadable, so a person never relies on how a free-text line parses.

const BACKGROUND_HEADING = issue_body_keys.heading('background')
const PREFIX = issue_body_keys.prefix('measure_declaration')
// joshuafolkken/kit#7021: a number a decision rests on, declared in the same shape so the command that
// measures it is named before the work starts. Every premise line is checked, not only the first.
const PREMISE_PREFIX = issue_body_keys.prefix('premise')
// joshuafolkken/kit#5144: a follow-up whose value no one command prints (an Actions record, an external
// service) says why under the same heading instead, so it files without a declaration.
const ABSENT_PREFIX = issue_body_keys.prefix('measure_absent')
const ABSENT = `${ABSENT_PREFIX} <理由>`
const SHAPE = '`<command>` <=|<|>=|> <number>'
const DECLARATION = `${PREFIX} ${SHAPE}`
const VALUE_PATTERN =
	/^`(?<command>[^`\s][^`]*)`\s*(?<operator><=|>=|<|>)\s*(?<threshold>-?\d+(?:\.\d+)?)$/u
const NUMBER_PATTERN = /^-?\d+(?:\.\d+)?$/u
const EXAMPLE_VALUE = '`pnpm josh lane:net 5168` <= 40'
// The refusal ends in a line ready to paste (joshuafolkken/kit#5225).
const EXAMPLE = `${PREFIX} ${EXAMPLE_VALUE}`
// joshuafolkken/kit#6016: the drive runs the command as written, so a `<merge instant>` left in it is a
// shell syntax error the drive hands to a lane — refused at filing instead. A path never reads as one,
// so a redirect pair such as `<in.txt >out.txt` still files.
const PLACEHOLDER_PATTERN = /<[^\s<>./][^<>./]*>/u
const declaration_schema = z.object({
	command: z.string().trim(),
	operator: z.enum(['<=', '<', '>=', '>']),
	threshold: z.coerce.number(),
})

type MeasureDeclaration = z.infer<typeof declaration_schema>
type Operator = MeasureDeclaration['operator']
type MeasureVerdict = { kind: 'pass' | 'fail'; value: number } | { kind: 'unreadable' }

const COMPARE: Readonly<Record<Operator, (value: number, threshold: number) => boolean>> = {
	'<=': (value, threshold) => value <= threshold,
	'<': (value, threshold) => value < threshold,
	'>=': (value, threshold) => value >= threshold,
	'>': (value, threshold) => value > threshold,
}

// The value after `prefix` on every such line under the background heading, in body order.
function background_values(body: string, prefix: string): ReadonlyArray<string> {
	const background = markdown_section.section_lines(body, BACKGROUND_HEADING).join('\n')

	return markdown_section
		.unfenced_lines(background)
		.map((text) => text.trim())
		.filter((text) => text.startsWith(prefix))
		.map((text) => text.slice(prefix.length).trim())
}

// The value after `prefix` under the background heading, or `undefined` when the body has no such line.
function background_value(body: string, prefix: string): string | undefined {
	return background_values(body, prefix)[0]
}

function declared_value(body: string): string | undefined {
	return background_value(body, PREFIX)
}

// Whether the body writes a declaration line — a malformed one is `problems`' refusal — or says why it
// has none; an empty reason says nothing.
function is_stated(body: string): boolean {
	if (declared_value(body) !== undefined) return true

	return (background_value(body, ABSENT_PREFIX) ?? '').length > 0
}

function shaped(value: string): MeasureDeclaration | undefined {
	const read = declaration_schema.safeParse(VALUE_PATTERN.exec(value)?.groups)

	return read.success ? read.data : undefined
}

function placeholder_of(declaration: MeasureDeclaration): string | undefined {
	return PLACEHOLDER_PATTERN.exec(declaration.command)?.[0]
}

function placeholder_problem(placeholder: string, prefix: string): string {
	return `\`${prefix}\` runs its command as written: replace the placeholder \`${placeholder}\` with the value it stands for\n${prefix} ${EXAMPLE_VALUE}`
}

function malformed_problem(prefix: string): string {
	return `\`${prefix}\` must be written ${prefix} ${SHAPE}\n${prefix} ${EXAMPLE_VALUE}`
}

function value_problems(value: string, prefix: string): ReadonlyArray<string> {
	const declaration = shaped(value)

	if (declaration === undefined) return [malformed_problem(prefix)]

	const placeholder = placeholder_of(declaration)

	return placeholder === undefined ? [] : [placeholder_problem(placeholder, prefix)]
}

function parsed(value: string): MeasureDeclaration | undefined {
	const declaration = shaped(value)

	return declaration === undefined || placeholder_of(declaration) !== undefined
		? undefined
		: declaration
}

// The declaration, or `undefined` when there is none or it does not parse — `issue:file` refuses a
// malformed one, and the drive hands an issue it cannot read to a lane as before.
function parse(body: string): MeasureDeclaration | undefined {
	const value = declared_value(body)

	return value === undefined ? undefined : parsed(value)
}

// Every premise line that parses, in body order; `problems` refuses the rest at filing.
function premises(body: string): ReadonlyArray<MeasureDeclaration> {
	return background_values(body, PREMISE_PREFIX).flatMap((value) => parsed(value) ?? [])
}

// The declaration's problems, then every premise line's, each read as the declaration is.
function problems(body: string): ReadonlyArray<string> {
	const value = declared_value(body)
	const declared = value === undefined ? [] : value_problems(value, PREFIX)
	const premised = background_values(body, PREMISE_PREFIX).flatMap((premise) =>
		value_problems(premise, PREMISE_PREFIX),
	)

	return [...declared, ...premised]
}

function value_of(output: string): number | undefined {
	const last = output
		.split('\n')
		.map((line) => line.trim())
		.findLast((line) => line.length > 0)

	return last !== undefined && NUMBER_PATTERN.test(last) ? Number(last) : undefined
}

function judge(declaration: MeasureDeclaration, output: string): MeasureVerdict {
	const value = value_of(output)

	if (value === undefined) return { kind: 'unreadable' }

	const is_pass = COMPARE[declaration.operator](value, declaration.threshold)

	return { kind: is_pass ? 'pass' : 'fail', value }
}

function format(declaration: MeasureDeclaration): string {
	return `\`${declaration.command}\` ${declaration.operator} ${String(declaration.threshold)}`
}

const measure_declaration = {
	ABSENT,
	DECLARATION,
	EXAMPLE,
	PREFIX,
	PREMISE_PREFIX,
	background_value,
	format,
	is_stated,
	judge,
	parse,
	premises,
	problems,
}

export type { MeasureDeclaration, MeasureVerdict }
export { measure_declaration }
