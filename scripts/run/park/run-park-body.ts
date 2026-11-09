import { markdown_section } from '#scripts/issue/markdown-section'

// The `run:park` body schema (joshuafolkken/kit#6669): numbered options under the options heading,
// each with its tier and the permission taking it needs, and one recommendation line naming the
// option the child recommends, or no recommendation with why. A child parks because it lacks the
// permission to take its own recommendation, so the parent reads it instead of rebuilding the choice.
//
// **The one parser of the schema**: `run:park` refuses a body `problem_of` names, and a reader of a
// park comment summarizes it through `summary_of` — `run:board`'s park rows (joshuafolkken/kit#6688).

interface ParkOption {
	number: number
	tier?: string | undefined
	permission?: string | undefined
}

interface ParkPick {
	number?: number
}

interface ParkBody {
	options: ReadonlyArray<ParkOption>
	pick: ParkPick | undefined
}

const OPTIONS_HEADING = '### 選択肢'
const PICK_HEADING = '### 推奨'
const NO_PICK_WORD = '推奨なし'
const TIER_LINE = '   - 層: A|B|C'
const ANY_HEADING = /^#{1,6} /u
const ITEM = /^(\d+)\. +\S/u
const TIER = /^- 層: ?([ABC])$/u
const PERMISSION = /^- 必要な権限: ?(\S.*)$/u
const PICK = /^(\d+)[\s:：.、]+\S/u
const NO_PICK = /^推奨なし[\s:：—-]+\S/u
const AUTO_TIER = 'A'
// The tier no parent takes, even on a person's behalf: trust settings, third parties, destructive acts.
const PERSON_TIER = 'C'
// The permissions a parent holds without a person: none at all, or the parent's own.
const AUTO_PERMISSIONS: ReadonlySet<string> = new Set(['なし', '親'])

const FORMAT = [
	'Park body schema:',
	OPTIONS_HEADING,
	'1. <option>',
	TIER_LINE,
	'   - 必要な権限: なし | 親 | owner コメント | epic 編集 | 信頼設定 | 人',
	'2. <option>',
	TIER_LINE,
	'   - 必要な権限: …',
	PICK_HEADING,
	`<option number> <reason>   (or: ${NO_PICK_WORD} <reason>)`,
].join('\n')

function section_of(lines: ReadonlyArray<string>, heading: string): ReadonlyArray<string> {
	const start = lines.findIndex((line) => line.trim() === heading)

	if (start === -1) return []
	const rest = lines.slice(start + 1)
	const end = rest.findIndex((line) => ANY_HEADING.test(line))

	return end === -1 ? rest : rest.slice(0, end)
}

function tier_of(option: ParkOption, line: string): string | undefined {
	return option.tier ?? TIER.exec(line)?.[1]
}

function permission_of(option: ParkOption, line: string): string | undefined {
	return option.permission ?? PERMISSION.exec(line)?.[1]?.trim()
}

function with_detail(option: ParkOption, raw_line: string): ParkOption {
	const line = raw_line.trim()

	return { ...option, tier: tier_of(option, line), permission: permission_of(option, line) }
}

// Each numbered item opens an option; the lines under it fill in its tier and permission.
function next_options(options: ReadonlyArray<ParkOption>, line: string): ReadonlyArray<ParkOption> {
	const number = ITEM.exec(line)?.[1]

	if (number !== undefined) return [...options, { number: Number(number) }]
	const last = options.at(-1)

	return last === undefined ? options : [...options.slice(0, -1), with_detail(last, line)]
}

function options_of(lines: ReadonlyArray<string>): ReadonlyArray<ParkOption> {
	let options: ReadonlyArray<ParkOption> = []

	for (const line of lines) options = next_options(options, line)

	return options
}

function first_line(lines: ReadonlyArray<string>): string {
	return lines.find((candidate) => candidate.trim() !== '')?.trim() ?? ''
}

function pick_of(lines: ReadonlyArray<string>): ParkPick | undefined {
	const line = first_line(lines)

	if (NO_PICK.test(line)) return {}
	const number = PICK.exec(line)?.[1]

	return number === undefined ? undefined : { number: Number(number) }
}

function parse(body: string): ParkBody {
	const lines = markdown_section.fence_free_lines(body)

	return {
		options: options_of(section_of(lines, OPTIONS_HEADING)),
		pick: pick_of(section_of(lines, PICK_HEADING)),
	}
}

function option_problem(option: ParkOption): string | undefined {
	const name = `option ${String(option.number)}`

	if (option.tier === undefined) return `${name} has no "- 層: A|B|C" line`

	return option.permission === undefined ? `${name} has no "- 必要な権限: …" line` : undefined
}

function is_listed(park: ParkBody, number: number | undefined): boolean {
	return number === undefined || park.options.some((option) => option.number === number)
}

function pick_problem(park: ParkBody): string | undefined {
	if (park.pick === undefined) {
		return `${PICK_HEADING} needs one line: "<option number> <reason>" or "${NO_PICK_WORD} <reason>"`
	}

	if (is_listed(park, park.pick.number)) return undefined

	return `${PICK_HEADING} names option ${String(park.pick.number)}, which ${OPTIONS_HEADING} does not list`
}

// The first missing piece of the schema, in one line; `undefined` for a body that meets it.
function problem_of(body: string): string | undefined {
	const park = parse(body)

	if (park.options.length === 0) return `${OPTIONS_HEADING} lists no numbered option`

	return park.options.map((option) => option_problem(option)).find(Boolean) ?? pick_problem(park)
}

// The option the recommendation names; `undefined` for no recommendation or a body off the schema.
function picked_option(body: string): ParkOption | undefined {
	const park = parse(body)
	const number = park.pick?.number

	return park.options.find((candidate) => candidate.number === number)
}

// The recommended option and its tier, or no recommendation; `undefined` for a body off the schema.
function summary_of(body: string): string | undefined {
	if (problem_of(body) !== undefined) return undefined
	const option = picked_option(body)

	if (option === undefined) return NO_PICK_WORD

	return `推奨: ${String(option.number)}（層 ${option.tier ?? ''}）`
}

function is_parents(option: ParkOption): boolean {
	return option.tier === AUTO_TIER && AUTO_PERMISSIONS.has(option.permission ?? '')
}

// The recommended option a parent with no person takes itself (joshuafolkken/kit#6738): tier A, needing
// no permission beyond the parent's. `undefined` for any other park, which stays a person's.
function auto_pick(body: string): number | undefined {
	if (problem_of(body) !== undefined) return undefined
	const option = picked_option(body)

	return option !== undefined && is_parents(option) ? option.number : undefined
}

// Why a parent may not adopt option `number` of a schema-conforming park (joshuafolkken/kit#6670):
// a park with no recommendation stays a person's, an unlisted option is no answer, and a tier C option
// stays a person's. `undefined` when the parent may adopt it.
function adopt_problem(body: string, number: number): string | undefined {
	const park = parse(body)

	if (park.pick?.number === undefined) return `the park says ${NO_PICK_WORD}, so a person decides`
	const option = park.options.find((candidate) => candidate.number === number)

	if (option === undefined) return `${OPTIONS_HEADING} lists no option ${String(number)}`

	return option.tier === PERSON_TIER
		? `option ${String(number)} is tier C, a person's to take`
		: undefined
}

const run_park_body = {
	FORMAT,
	HEADINGS: [OPTIONS_HEADING, PICK_HEADING],
	adopt_problem,
	auto_pick,
	problem_of,
	summary_of,
}

export { run_park_body }
