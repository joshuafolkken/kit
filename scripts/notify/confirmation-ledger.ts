import { existsSync } from 'node:fs'
import { readdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { hook_context, type HookContext } from '#scripts/hooks/hook-context'
import { hook_ledger } from '#scripts/hooks/hook-ledger'
import type { HumanStopKey } from '#scripts/issue/issue-human-stops'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// Every confirmation a run sends a person, one JSON line each: the reason key, the Issue, when it was
// asked and — once the person's next prompt arrives — when it was answered (joshuafolkken/kit#7889).
//
// **It lives in the common git directory beside `hook-ledger`, not in a lane's ledger**: confirmations
// are also sent outside a lane (a consult session, a headless `backlogrun`).
//
// **The send's opt-in never gates this line**: a confirmation that reached nobody still happened.

const LEDGER_DIRECTORY = 'confirmation-ledger'
const TEMPORARY_SUFFIX = '.tmp'
const CONFIRMATION_TYPE = 'confirmation'
const DEFAULT_REASON: HumanStopKey = 'needs-decision'

// The read side takes any reason text: a key retired from the registry still reads back.
const entry_schema = z.object({
	reason: z.string(),
	issue: z.string().optional(),
	checkout: z.string(),
	asked_at: z.string(),
	answered_at: z.string().optional(),
})

type ConfirmationEntry = z.infer<typeof entry_schema>

interface ConfirmationAsked {
	reason: HumanStopKey
	// The Issue as the caller names it (`7889`, `owner/repo#7889`).
	issue?: string | undefined
}

function ledger_directory(): string | undefined {
	return hook_ledger.directory_of(LEDGER_DIRECTORY, hook_context.from_process())
}

function entry_of(asked: ConfirmationAsked, checkout: string, now: Date): ConfirmationEntry {
	const issue = asked.issue === undefined ? {} : { issue: asked.issue }

	return { reason: asked.reason, ...issue, checkout, asked_at: now.toISOString() }
}

// **Counting never fails the confirmation**: a line that could not be written leaves the send as it was.
async function record(
	asked: ConfirmationAsked,
	directory: string | undefined = ledger_directory(),
	context: HookContext = hook_context.from_process(),
): Promise<void> {
	if (directory === undefined) return

	try {
		const entry = entry_of(asked, context.cwd, new Date())

		await hook_ledger.append_line(entry, entry.asked_at, directory)
	} catch {
		// The ledger only counts; the confirmation goes on without it.
	}
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

// Broken lines are skipped, so one torn write never hides the rest of the day.
function entries_in(text: string): Array<ConfirmationEntry> {
	return text.split('\n').flatMap((line) => json_value.parse_with(line, entry_schema) ?? [])
}

async function read(directory: string, since: Date): Promise<Array<ConfirmationEntry>> {
	const files = await day_files(directory)
	const texts = await Promise.all(files.map(async (file) => await readFile(file, 'utf8')))

	return texts
		.flatMap((text) => entries_in(text))
		.filter((entry) => new Date(entry.asked_at) >= since)
}

function is_open(
	entry: ConfirmationEntry | undefined,
	checkout: string,
): entry is ConfirmationEntry {
	return entry !== undefined && entry.answered_at === undefined && entry.checkout === checkout
}

// One line closed, or left exactly as it was — a broken line included.
function closed_line(line: string, checkout: string, answered_at: string): string {
	const entry = json_value.parse_with(line, entry_schema)

	return is_open(entry, checkout) ? JSON.stringify({ ...entry, answered_at }) : line
}

// The file is rewritten through a rename, so a reader never sees half of it; only a file holding an
// open line of this checkout is rewritten at all.
async function answer_file(file: string, checkout: string, answered_at: string): Promise<number> {
	const text = await readFile(file, 'utf8')
	const lines = text.split('\n')
	const closed = lines.map((line) => closed_line(line, checkout, answered_at))
	const count = closed.filter((line, index) => line !== lines[index]).length
	if (count === 0) return 0
	const temporary = `${file}${TEMPORARY_SUFFIX}`

	await writeFile(temporary, closed.join('\n'))
	await rename(temporary, file)

	return count
}

// The person's next prompt answers every confirmation this checkout left open; the count is returned.
async function answer(
	directory: string | undefined = ledger_directory(),
	context: HookContext = hook_context.from_process(),
	now: Date = new Date(),
): Promise<number> {
	if (directory === undefined) return 0
	const files = await day_files(directory)
	const counts = await Promise.all(
		files.map(async (file) => await answer_file(file, context.cwd, now.toISOString())),
	)

	return counts.reduce((total, count) => total + count, 0)
}

const confirmation_ledger = {
	answer,
	read,
	record,
	record_sent,
}

export { confirmation_ledger }
export type { ConfirmationAsked, ConfirmationEntry }
