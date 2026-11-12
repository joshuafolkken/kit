import { execSync } from 'node:child_process'
import { gh_author_association } from '#scripts/gh/gh-author-association'
import { error_text } from '#scripts/lib/error-message'
import { baseline_measure } from './baseline-measure'
import { measure_declaration } from './measure-declaration'
import { session_cite } from './session-cite'
import { trusted_measure_source, type MeasureSource } from './trusted-measure-source'

// Shell measurements require a trusted author and editor. Execute only an explicit declaration in
// that verified snapshot, and log its provenance before invoking the shell, even if it fails.
// One command's budget — the same minute `josh-harness.ts` gives one command it spawns. A measurement
// is a count or a digest that answers in seconds, so a command still running after a minute is stuck,
// and without a bound it would hold the whole re-measurement open with nothing printed.
const MEASURE_TIMEOUT_MS = 60_000

interface TrustedBody {
	kind: 'trusted'
	body: string
	issue: string
	author: string
	editor: string
}

type BodyRead = TrustedBody | { kind: 'refused'; reason: string }
type CommandRun = { kind: 'ok'; output: string } | { kind: 'failed'; message: string }

function declared_commands(body: string): Array<string> {
	const baselines = baseline_measure.parse_baselines(body).map((baseline) => baseline.command)
	const declaration = measure_declaration.parse(body)
	const premises = measure_declaration.premises(body).map((premise) => premise.command)
	const declared = declaration === undefined ? [] : [declaration.command]

	return [...baselines, ...declared, ...premises]
}

// The command's stdout, trimmed, or the message a failing or timed-out command threw.
function audit(command: string, source: TrustedBody): void {
	console.error(
		JSON.stringify({
			event: 'trusted-measure',
			issue: source.issue,
			author: source.author,
			editor: source.editor,
			command,
		}),
	)
}

function run_command(command: string, source: TrustedBody): CommandRun {
	if (!declared_commands(source.body).includes(command)) {
		return { kind: 'failed', message: 'command is not declared in the verified issue body' }
	}

	audit(command, source)

	try {
		return {
			kind: 'ok',
			output: execSync(command, { encoding: 'utf8', timeout: MEASURE_TIMEOUT_MS }).trim(),
		}
	} catch (error) {
		return { kind: 'failed', message: error_text.message_of(error) }
	}
}

// The run as one printable value: a failure is spelled in place of the output.
function text_of(run: CommandRun): string {
	return run.kind === 'ok' ? run.output : `(command failed: ${run.message})`
}

function is_unedited(source: MeasureSource): boolean {
	return source.lastEditedAt === null && source.editor === null
}

async function trusted_editor(source: MeasureSource): Promise<string | undefined> {
	if (is_unedited(source)) return source.author?.login

	const login = source.editor?.login
	const is_trusted = await gh_author_association.is_trusted({ login, association: 'COLLABORATOR' })

	return is_trusted ? login : undefined
}

async function trusted_author(issue: MeasureSource): Promise<string | undefined> {
	const login = issue.author?.login

	if (login === undefined) return undefined

	const is_trusted = await gh_author_association.is_trusted({
		login,
		association: issue.authorAssociation,
	})

	return is_trusted ? login : undefined
}

// The body, only when its author can write to the repository. A read that fails is refused as well:
// an unknown author is not a trusted one.
async function read_trusted_body(issue_number: string): Promise<BodyRead> {
	const issue = await trusted_measure_source.read(issue_number)

	if (issue === undefined) {
		return { kind: 'refused', reason: `could not read issue ${session_cite.issue(issue_number)}` }
	}

	const author = await trusted_author(issue)

	if (author === undefined) {
		return {
			kind: 'refused',
			reason: `refusing ${session_cite.issue(issue_number)}: untrusted author (${issue.authorAssociation})`,
		}
	}

	const editor = await trusted_editor(issue)

	return editor === undefined
		? {
				kind: 'refused',
				reason: `refusing ${session_cite.issue(issue_number)}: untrusted or unknown last editor`,
			}
		: { kind: 'trusted', body: issue.body, issue: issue_number, author, editor }
}

const trusted_measure = { read_trusted_body, run_command, text_of }

export type { BodyRead, CommandRun, TrustedBody }
export { trusted_measure }
