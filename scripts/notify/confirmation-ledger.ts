import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { hook_context, type HookContext } from '#scripts/hooks/hook-context'
import { hook_ledger } from '#scripts/hooks/hook-ledger'
import type { HumanStopKey } from '#scripts/issue/issue-human-stops'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// Every confirmation a run sends a person, one JSON line each: the reason key, the Issue, when it was
// asked and the checkout it was asked from (joshuafolkken/kit#7889). A person's prompt appends an
// answer line for its checkout; `read` closes each confirmation at the first answer after it.
//
// **Append-only, never rewritten**: every lane shares a day file, so a rewrite would race a concurrent
// append; an appended line cannot, and the prompt hook pays one write rather than a read of the ledger.
//
// **It lives in the common git directory beside `hook-ledger`, not in a lane's ledger**: confirmations
// are also sent outside a lane (a consult session, a headless `backlogrun`).
//
// **The send's opt-in never gates this line**: a confirmation that reached nobody still happened.

const LEDGER_DIRECTORY = 'confirmation-ledger'
const CONFIRMATION_TYPE = 'confirmation'
const DEFAULT_REASON: HumanStopKey = 'needs-decision'

// The read side takes any reason text: a key retired from the registry still reads back.
const asked_schema = z.object({
	reason: z.string(),
	issue: z.string().optional(),
	checkout: z.string(),
	asked_at: z.string(),
})

const answer_schema = z.object({ checkout: z.string(), answered_at: z.string() })

type AskedLine = z.infer<typeof asked_schema>
type AnswerLine = z.infer<typeof answer_schema>

interface ConfirmationEntry extends AskedLine {
	answered_at?: string
}

interface ConfirmationAsked {
	reason: HumanStopKey
	// The Issue as the caller names it (`7889`, `owner/repo#7889`).
	issue?: string | undefined
}

function ledger_directory(): string | undefined {
	return hook_ledger.directory_of(LEDGER_DIRECTORY, hook_context.from_process())
}

function asked_line(asked: ConfirmationAsked, checkout: string, now: Date): AskedLine {
	const issue = asked.issue === undefined ? {} : { issue: asked.issue }

	return { reason: asked.reason, ...issue, checkout, asked_at: now.toISOString() }
}

// **Counting never fails its caller**: a line that could not be written leaves the confirmation, or
// the prompt, as it was.
async function append(line: object, at: string, directory: string | undefined): Promise<void> {
	if (directory === undefined) return

	try {
		await hook_ledger.append_line(line, at, directory)
	} catch {
		// The ledger only counts; the caller goes on without it.
	}
}

async function record(
	asked: ConfirmationAsked,
	directory: string | undefined = ledger_directory(),
	context: HookContext = hook_context.from_process(),
): Promise<void> {
	const line = asked_line(asked, context.cwd, new Date())

	await append(line, line.asked_at, directory)
}

interface SentInput {
	task_type: string
	reason?: HumanStopKey | undefined
	issue?: string | undefined
}

// `telegram_notify.send`'s one call: only a confirmation is recorded, and one that names no reason is
// a question the person decides.
async function record_sent(
	input: SentInput,
	directory: string | undefined = ledger_directory(),
	context: HookContext = hook_context.from_process(),
): Promise<void> {
	if (input.task_type !== CONFIRMATION_TYPE) return

	await record({ reason: input.reason ?? DEFAULT_REASON, issue: input.issue }, directory, context)
}

async function day_files(directory: string): Promise<Array<string>> {
	if (!existsSync(directory)) return []
	const names = await readdir(directory)

	return names
		.filter((name) => name.endsWith(hook_ledger.LEDGER_EXTENSION))
		.map((name) => path.join(directory, name))
}

async function ledger_lines(directory: string): Promise<Array<string>> {
	const files = await day_files(directory)
	const texts = await Promise.all(files.map(async (file) => await readFile(file, 'utf8')))

	return texts.flatMap((text) => text.split('\n'))
}

// The first answer from the confirmation's checkout at or after it was asked.
function first_answer(asked: AskedLine, answers: Array<AnswerLine>): string | undefined {
	return answers
		.filter((line) => line.checkout === asked.checkout && line.answered_at >= asked.asked_at)
		.map((line) => line.answered_at)
		.toSorted((left, right) => left.localeCompare(right))[0]
}

function entry_of(asked: AskedLine, answers: Array<AnswerLine>): ConfirmationEntry {
	const answered_at = first_answer(asked, answers)

	return answered_at === undefined ? asked : { ...asked, answered_at }
}

// Broken lines are skipped, so one torn write never hides the rest of the day.
async function read(directory: string, since: Date): Promise<Array<ConfirmationEntry>> {
	const lines = await ledger_lines(directory)
	const answers = lines.flatMap((line) => json_value.parse_with(line, answer_schema) ?? [])

	return lines
		.flatMap((line) => json_value.parse_with(line, asked_schema) ?? [])
		.filter((asked) => new Date(asked.asked_at) >= since)
		.map((asked) => entry_of(asked, answers))
}

// The person's prompt answers every confirmation its checkout left open.
async function answer(
	directory: string | undefined = ledger_directory(),
	context: HookContext = hook_context.from_process(),
	now: Date = new Date(),
): Promise<void> {
	const answered_at = now.toISOString()

	await append({ checkout: context.cwd, answered_at }, answered_at, directory)
}

const confirmation_ledger = {
	answer,
	read,
	record,
	record_sent,
}

export { confirmation_ledger }
export type { ConfirmationAsked, ConfirmationEntry }
