import { markdown_section } from '#scripts/issue/markdown-section'
import { run_park_approval, type ApprovalRange, type ParkApproval } from './run-park-approval'
import { run_park_fold } from './run-park-fold'
import { run_park_permission } from './run-park-permission'
import { run_park_serial } from './run-park-serial'

// The `run:park` body schema (joshuafolkken/kit#6669): numbered options under the options heading,
// each with its tier and the permission taking it needs, and one recommendation line naming the
// option the child recommends, or no recommendation with why. A child parks because it lacks the
// permission to take its own recommendation, so the parent reads it instead of rebuilding the choice.
//
// **The one parser of the schema**: `run:park` refuses a body `problem_of` names, and a reader of a
// park comment summarizes it through `summary_of` — `run:board`'s park rows (joshuafolkken/kit#6688).
//
// An option that is a size approval carries its range in three more lines (`run-park-approval.ts`); a
// filing option the parked Issue waits on carries its order reason (`run-park-serial.ts`).

interface ParkOption {
	number: number
	tier?: string | undefined
	permission?: string | undefined
	approval?: ParkApproval | undefined
	order_reason?: string | undefined
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
const { AUTO_PERMISSION, PARENT_PERMISSION, FILING_COMMAND, CLOSE_COMMAND, FOLD_COMMAND } =
	run_park_permission
const PARENT_ACTION_NOTE = ' · 親の操作'
const PARENT_COMMANDS = [FILING_COMMAND, CLOSE_COMMAND, FOLD_COMMAND] as const

const FORMAT = [
	'Park body schema:',
	OPTIONS_HEADING,
	'1. <option>',
	TIER_LINE,
	...run_park_permission.schema_lines(),
	'2. <option>',
	TIER_LINE,
	'   - 必要な権限: …',
	run_park_serial.schema_line(),
	'   (a size-approval option adds all three:)',
	...run_park_approval.schema_lines(),
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

	return {
		...option,
		tier: tier_of(option, line),
		permission: permission_of(option, line),
		approval: run_park_approval.with_line(option.approval, line),
		order_reason: option.order_reason ?? run_park_serial.reason_of(line),
	}
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

function is_parent_action(option: ParkOption | undefined): boolean {
	return option?.permission?.startsWith(PARENT_PERMISSION) === true
}

function names_command(option: ParkOption | undefined, command: string): boolean {
	return option?.permission?.includes(command) === true
}

// A filing or closing option written as anything but the parent's: adopting it would requeue with
// nothing filed or closed.
function command_problem(option: ParkOption, name: string): string | undefined {
	if (is_parent_action(option)) return undefined
	const command = PARENT_COMMANDS.find((candidate) => names_command(option, candidate))

	if (command === undefined) return undefined

	return `${name} names ${command}, which a child cannot run; write "- 必要な権限: ${PARENT_PERMISSION}（${command} …）"`
}

function option_problem(option: ParkOption): string | undefined {
	const name = `option ${String(option.number)}`

	if (option.tier === undefined) return `${name} has no "- 層: A|B|C" line`
	if (option.permission === undefined) return `${name} has no "- 必要な権限: …" line`

	return command_problem(option, name) ?? run_park_approval.problem_of(option.approval, name)
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

// The first missing piece of the schema's structure, in one line; `undefined` for a body that meets it.
function shape_problem(park: ParkBody): string | undefined {
	if (park.options.length === 0) return `${OPTIONS_HEADING} lists no numbered option`

	return park.options.map((option) => option_problem(option)).find(Boolean) ?? pick_problem(park)
}

// Whether adopting `option` leaves the parked Issue waiting on the Issue it files: a filing that
// neither closes nor folds it (`backlog-triage-adopt.ts` blocks it by the filed Issue).
function waits_on(option: ParkOption | undefined): boolean {
	if (!is_parent_action(option) || !names_command(option, FILING_COMMAND)) return false

	return !names_command(option, CLOSE_COMMAND) && !names_command(option, FOLD_COMMAND)
}

// A filing the parked Issue waits on naming no order kind (joshuafolkken/kit#8661): `run:park` refuses
// it while the child can still add the line, so an adopt never meets it.
function serial_problem(park: ParkBody): string | undefined {
	return park.options
		.map((option) => run_park_serial.problem_of(option, waits_on(option)))
		.find(Boolean)
}

function permission_problem(park: ParkBody): string | undefined {
	return park.options
		.map((option) =>
			run_park_permission.problem_of(`option ${String(option.number)}`, option.permission ?? ''),
		)
		.find(Boolean)
}

// The first problem of a body, structure first, then a permission off the vocabulary
// (joshuafolkken/kit#7818): what `run:park` refuses and an adopt refuses to take. `undefined` for none.
function problem_of(body: string): string | undefined {
	const park = parse(body)

	return shape_problem(park) ?? permission_problem(park) ?? serial_problem(park)
}

// Whether `body` meets the schema's structure — a park, even one whose permission `problem_of` names.
// A reader picks the latest park by this, so a newer park off the vocabulary is refused, never read past
// to an older one (joshuafolkken/kit#7818).
function is_park(body: string): boolean {
	return shape_problem(parse(body)) === undefined
}

// The option the recommendation names; `undefined` for no recommendation or a body off the schema.
function picked_option(body: string): ParkOption | undefined {
	const park = parse(body)
	const number = park.pick?.number

	return park.options.find((candidate) => candidate.number === number)
}

// The recommended option and its tier, or no recommendation; `undefined` for a body off the schema's
// structure. A park written before the permission vocabulary (joshuafolkken/kit#7818) still reads as a
// stop on the board, though `problem_of` names its permission.
function summary_of(body: string): string | undefined {
	if (!is_park(body)) return undefined
	const option = picked_option(body)

	if (option === undefined) return NO_PICK_WORD
	const note = is_parent_action(option) ? PARENT_ACTION_NOTE : ''

	return `推奨: ${String(option.number)}（層 ${option.tier ?? ''}${note}）`
}

// Whether option `number` needs the parent's own action before the lane may resume.
function parent_action(body: string, number: number): boolean {
	return is_parent_action(parse(body).options.find((candidate) => candidate.number === number))
}

function option_at(body: string, number: number): ParkOption | undefined {
	return parse(body).options.find((candidate) => candidate.number === number)
}

function parent_command(body: string, number: number, command: string): boolean {
	const option = option_at(body, number)

	return is_parent_action(option) && names_command(option, command)
}

// The permission option `number` carries, as written on its permission line; `undefined` for none.
function permission_of_option(body: string, number: number): string | undefined {
	return option_at(body, number)?.permission
}

function permissions_of(body: string): ReadonlyArray<string | undefined> {
	return parse(body).options.map((option) => option.permission)
}

// Whether option `number` is the parent's filing of an Issue the child then waits on.
function filing_action(body: string, number: number): boolean {
	return parent_command(body, number, FILING_COMMAND)
}

// Whether option `number` closes the Issue without implementing (joshuafolkken/kit#7805).
function close_action(body: string, number: number): boolean {
	return parent_command(body, number, CLOSE_COMMAND)
}

// Whether option `number` ships this Issue in another Issue's pull request (joshuafolkken/kit#7985).
function fold_action(body: string, number: number): boolean {
	return parent_command(body, number, FOLD_COMMAND)
}

// The Issue a fold option names after `--into`; `undefined` for no fold option or one naming none.
function fold_target(body: string, number: number): string | undefined {
	if (!fold_action(body, number)) return undefined

	return run_park_fold.into_of(permission_of_option(body, number))
}

// Whether adopting option `number` needs `--done`: a parent action the adopt does not take itself.
// A closing or folding option is taken by the adopt; one that also files still needs the filed Issue named.
function done_needed(body: string, number: number): boolean {
	if (filing_action(body, number)) return true
	const is_taken = close_action(body, number) || fold_action(body, number)

	return parent_action(body, number) && !is_taken
}

function is_parents(option: ParkOption): boolean {
	return option.tier === AUTO_TIER && option.permission === AUTO_PERMISSION
}

// The recommended option a parent with no person takes itself (joshuafolkken/kit#6738): tier A, needing
// no permission at all. An option needing the parent's own action is not taken by adopting it, so it
// waits for `backlog:triage --adopt --done` (joshuafolkken/kit#7001). `undefined` for any other park.
function auto_pick(body: string): number | undefined {
	if (problem_of(body) !== undefined) return undefined
	const option = picked_option(body)

	return option !== undefined && is_parents(option) ? option.number : undefined
}

// Why a parent may not adopt option `number` of a schema-conforming park (joshuafolkken/kit#6670):
// a park with no recommendation stays a person's, an unlisted option is no answer, a tier C option
// stays a person's, and a filing naming no order kind is a serial carve-off (joshuafolkken/kit#8661).
// `undefined` when the parent may adopt it.
function adopt_problem(body: string, number: number): string | undefined {
	const park = parse(body)

	if (park.pick?.number === undefined) return `the park says ${NO_PICK_WORD}, so a person decides`
	const option = park.options.find((candidate) => candidate.number === number)

	if (option === undefined) return `${OPTIONS_HEADING} lists no option ${String(number)}`
	if (option.tier === PERSON_TIER) return `option ${String(number)} is tier C, a person's to take`

	return run_park_serial.problem_of(option, waits_on(option))
}

// The recommended option a parent may adopt (`adopt_problem` passes it) — what `backlog:triage --pass`
// prints an `--adopt` line for (joshuafolkken/kit#6777). `undefined` for no pick or a tier C pick.
function adoptable_pick(body: string): number | undefined {
	const number = picked_option(body)?.number

	return number !== undefined && adopt_problem(body, number) === undefined ? number : undefined
}

interface DefaultPick {
	number: number
	over: ReadonlyArray<number>
}

// Reversible and the narrowest change: no tier C, no permission, no size approval widening the lane.
function is_narrowest(option: ParkOption): boolean {
	const { tier, permission, approval } = option

	return tier !== PERSON_TIER && permission === AUTO_PERMISSION && approval === undefined
}

// The options of a park with no recommendation; none for a recommended park or a body off the schema.
function unpicked_options(body: string): ReadonlyArray<ParkOption> {
	const park = parse(body)

	return problem_of(body) === undefined && park.pick?.number === undefined ? park.options : []
}

// The option a parent takes for a park with no recommendation (joshuafolkken/kit#7077): the first
// listed reversible option with the smallest change, and the options it was taken over. `undefined`
// for a recommended park, a body off the schema, or one whose every option a person must take.
function default_pick(body: string): DefaultPick | undefined {
	const options = unpicked_options(body)
	const number = options.find((option) => is_narrowest(option))?.number
	const over = options.map((option) => option.number).filter((other) => other !== number)

	return number === undefined ? undefined : { number, over }
}

// The size-approval range option `number` carries; `undefined` for an option that is no size approval.
function approval_range(body: string, number: number): ApprovalRange | undefined {
	const option = parse(body).options.find((candidate) => candidate.number === number)

	return run_park_approval.is_complete(option?.approval) ? option.approval : undefined
}

const run_park_body = {
	FORMAT,
	HEADINGS: [OPTIONS_HEADING, PICK_HEADING],
	adopt_problem,
	adoptable_pick,
	approval_range,
	auto_pick,
	close_action,
	default_pick,
	done_needed,
	filing_action,
	fold_action,
	fold_target,
	is_park,
	parent_action,
	permission_of: permission_of_option,
	permissions_of,
	problem_of,
	summary_of,
}

export type { DefaultPick }
export { run_park_body }

export { type ApprovalRange } from './run-park-approval'
