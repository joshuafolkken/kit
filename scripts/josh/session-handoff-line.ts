import { json_value } from '#scripts/lib/json-value'
import { consultation_handoff } from '#scripts/rules/consultation-handoff'
import { run_handoff_args } from '#scripts/run/handoff/run-handoff-args'
import { time_density_hook } from '#scripts/time-runtime/time-density-hook'
import { z } from 'zod'
import { session_model_record } from './session-model-record'

// The `session-lang` prompt hook's handoff line (joshuafolkken/kit#5622): a workflow keyword typed to
// a consultation-model main line (Fable, Codex Astra) is pointed at `run:handoff` at the prompt, one
// step before `consultation-handoff` refuses the `run:entry` it would otherwise call.
//
// **Both lists are borrowed, not restated**: the keywords are `run:handoff`'s own, the model test is
// the rule's. Any other prompt — no keyword, another model, no payload — adds nothing.

const LINE_PREFIX = 'Consultation model: hand'
// `backlogrun` is handed to `josh backlogrun` whole, which takes no brief (`run-handoff-args.ts`).
const { BACKLOG_KEYWORD } = run_handoff_args
const BRIEF_ARGUMENT = ' --brief-file <brief>'

// `nullish`, as `hook-decision.ts` reads the same fields: a harness may send `null`.
const payload_schema = z.object({
	prompt: z.string().nullish(),
	transcript_path: z.string().nullish(),
	model: z.string().nullish(),
})

type PromptPayload = z.infer<typeof payload_schema>

const KEYWORD_SET: ReadonlySet<string> = new Set(run_handoff_args.KEYWORDS)

// `Fullrun`, `` `fullrun` `` and `fullrun,` are the keyword too.
function keyword_of(prompt: string): string | undefined {
	return prompt
		.toLowerCase()
		.split(/[^a-z]+/u)
		.find((token) => KEYWORD_SET.has(token))
}

// A transcript that cannot be read leaves the payload's `model` to decide. Claude Code's payload has
// none, so its first prompt — no assistant turn yet — reads the model recorded at session start
// (`session-model-record.ts`, joshuafolkken/kit#5761).
function tail_of(transcript_path: string | null | undefined): string {
	if (transcript_path === undefined || transcript_path === null) return ''

	try {
		return time_density_hook.read_tail(transcript_path)
	} catch {
		return ''
	}
}

function line_for(keyword: string): string {
	const brief = keyword === BACKLOG_KEYWORD ? '' : BRIEF_ARGUMENT

	return (
		`${LINE_PREFIX} \`${keyword}\` to a child: \`pnpm josh run:handoff ${keyword} …${brief}\`, ` +
		`not \`run:entry\` (${consultation_handoff.HANDOFF_DOC}).`
	)
}

function line_of(payload: PromptPayload): string {
	const keyword = keyword_of(payload.prompt ?? '')

	if (keyword === undefined) return ''
	const tail = tail_of(payload.transcript_path)

	const model = payload.model ?? undefined
	const recorded = session_model_record.recorded(payload.transcript_path)

	return consultation_handoff.is_consultation_main(tail, model, recorded) ? line_for(keyword) : ''
}

function handoff_line(raw_payload: string): string {
	const payload = json_value.parse_with(raw_payload, payload_schema)

	return payload === undefined ? '' : line_of(payload)
}

const session_handoff_line = {
	LINE_PREFIX,
	handoff_line,
	read_stdin: session_model_record.read_stdin,
}

export { session_handoff_line }
