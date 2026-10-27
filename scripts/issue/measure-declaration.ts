import { z } from 'zod'
import { markdown_section } from './markdown-section'

// joshuafolkken/kit#4621: a follow-up measurement ("measure K merges after #N") took a lane for 20–40
// minutes to run one command and compare its value with a bound — work `backlog:drive` can do itself.
// The body declares that command and the bound once, under the background heading, so the drive runs
// it when the issue comes due and closes it on a pass; only a miss or an unreadable value takes a lane.
//
// **The value is the command's last non-empty output line, read as one number.** Anything else — a
// unit, a sentence, a failure — is unreadable, so a person never relies on how a free-text line parses.

const BACKGROUND_HEADING = '## 背景'
const PREFIX = '- 計測宣言:'
// joshuafolkken/kit#5144: a follow-up whose value no one command prints (an Actions record, an external
// service) says why under the same heading instead, so it files without a declaration.
const ABSENT_PREFIX = '- 計測宣言なし:'
const ABSENT = `${ABSENT_PREFIX} <理由>`
const DECLARATION = `${PREFIX} \`<command>\` <=|<|>=|> <number>`
const VALUE_PATTERN =
	/^`(?<command>[^`\s][^`]*)`\s*(?<operator><=|>=|<|>)\s*(?<threshold>-?\d+(?:\.\d+)?)$/u
const NUMBER_PATTERN = /^-?\d+(?:\.\d+)?$/u
// The refusal ends in a line ready to paste (joshuafolkken/kit#5225).
const EXAMPLE = `${PREFIX} \`pnpm josh lane:net 5168\` <= 40`
const MALFORMED = `\`${PREFIX}\` must be written ${DECLARATION}\n${EXAMPLE}`
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

// The value after `prefix` under the background heading, or `undefined` when the body has no such line.
function background_value(body: string, prefix: string): string | undefined {
	const background = markdown_section.section_lines(body, BACKGROUND_HEADING).join('\n')
	const line = markdown_section
		.unfenced_lines(background)
		.map((text) => text.trim())
		.find((text) => text.startsWith(prefix))

	return line?.slice(prefix.length).trim()
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

function parsed(value: string): MeasureDeclaration | undefined {
	const read = declaration_schema.safeParse(VALUE_PATTERN.exec(value)?.groups)

	return read.success ? read.data : undefined
}

// The declaration, or `undefined` when there is none or it does not parse — `issue:file` refuses a
// malformed one, and the drive hands an issue it cannot read to a lane as before.
function parse(body: string): MeasureDeclaration | undefined {
	const value = declared_value(body)

	return value === undefined ? undefined : parsed(value)
}

function problems(body: string): ReadonlyArray<string> {
	const value = declared_value(body)

	return value === undefined || parsed(value) !== undefined ? [] : [MALFORMED]
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
	format,
	is_stated,
	judge,
	parse,
	problems,
}

export type { MeasureDeclaration, MeasureVerdict }
export { measure_declaration }
