// The pure `cost_transcript` unit fixtures shared between its two suites, split out when the
// lane-direction tests grew the main file past its line limit (joshuafolkken/kit#2236). A second copy
// of the slug-shaped working directory or the assistant usage line would let the two suites drift on
// what they exercise — the same seam `cost-cli-fixture.ts` was cut along. Only pure declarations live
// here: `no-top-level-side-effects` forbids a module from creating its temporary roots at import, so
// each test file owns its own absent-path scaffolding.

const CWD = '/Users/someone/Development/kit'
const ASSISTANT = 'assistant'

function usage_line(request_id: string, output_tokens: number): string {
	return JSON.stringify({
		type: ASSISTANT,
		requestId: request_id,
		gitBranch: 'main',
		message: { model: 'claude-opus-5', usage: { input_tokens: 1, output_tokens } },
	})
}

const cost_transcript_fixture = { CWD, ASSISTANT, usage_line }

export { cost_transcript_fixture }
