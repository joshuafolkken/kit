import { git_checkpoint } from '#scripts/git/git-checkpoint'
import { USAGE_ERROR_EXIT_CODE } from '#scripts/josh/josh-composite-arguments'
import { unasked_filing } from '#scripts/rules/unasked-filing'

// `josh producer:brief <name>` — the standing part of a no-filing producer's brief. The main line
// wrote it free-hand and, on 2026-11-28, wrote its own wish to run the tests into it; the command is
// now the one place that part is written, and only a quote worded as the person's request for the
// tests now lifts the deferral. The wording is checked, not who wrote it.
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const QUOTE_FLAG = '--tests-now-quote'
const USAGE = `usage: pnpm josh producer:brief <name> [${QUOTE_FLAG} "<the user's words>"]`
const REFUSAL =
	`josh producer:brief: ${QUOTE_FLAG} does not carry the user's own request for the tests and the ` +
	'gate now (「テストと gate も」, "tests and the gate too") — pass their words bare. The main ' +
	"line's own wish is not a request; without one, the tests, the gate and the review wait for the finish."
const DEFERRED: ReadonlyArray<string> = [
	'- Do not run the tests, `pnpm josh gate` or the pre-commit review: they wait for the finish. Build the change and check it by running it.',
	'- A deferred test or its artifact (a golden, a snapshot) that is red or cannot run → report it as a finish item; do not fix it now.',
]

interface BriefRequest {
	name: string
	quote: string | undefined
}

// Nothing after the name, or the flag with its one value.
function is_quote_part(rest: ReadonlyArray<string>): boolean {
	if (rest.length === 0) return true
	const [flag, ...values] = rest

	return flag === QUOTE_FLAG && values.length === 1
}

function request_of(argv: ReadonlyArray<string>): BriefRequest | undefined {
	const [name = '', ...rest] = argv
	if (!git_checkpoint.is_name(name) || !is_quote_part(rest)) return undefined

	return { name, quote: rest.at(1) }
}

function is_accepted(quote: string | undefined): boolean {
	return quote === undefined || unasked_filing.is_tests_now(quote)
}

function tests_now(quote: string): ReadonlyArray<string> {
	const words = quote.trim().replaceAll(/\s+/gu, ' ')

	return [
		`- The user asked for the tests and the gate now: "${words}". Run the tests and \`pnpm josh gate\`; the pre-commit review still waits for the finish.`,
	]
}

function brief(request: BriefRequest): string {
	const { name, quote } = request

	return [
		'Producer brief — standing part. Append the goal and the investigation conclusion.',
		`branch: wip/${name}`,
		'- This branch carries every no-filing request of the session; a new branch only on the user’s instruction.',
		`- Start, checkpoint (\`pnpm josh git:checkpoint ${name} "<what>"\`) and reply as \`.claude/agents/producer.md\` states ("Checkpoint your own work branch", "Reply with").`,
		...(quote === undefined ? DEFERRED : tests_now(quote)),
		'- Never push, merge or open a pull request. A hook refuses a step → take the route its message names, else stop that step and report its exact text.',
	].join('\n')
}

function failed(message: string, exit_code: number): number {
	console.error(message)

	return exit_code
}

function run(argv: ReadonlyArray<string>): number {
	const request = request_of(argv)
	if (request === undefined) return failed(USAGE, USAGE_ERROR_EXIT_CODE)
	if (!is_accepted(request.quote)) return failed(REFUSAL, FAILURE_EXIT_CODE)

	console.info(brief(request))

	return SUCCESS_EXIT_CODE
}

const producer_brief = { run }

export { producer_brief }
