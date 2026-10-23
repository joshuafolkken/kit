// cspell:words xoxb xoxp xapp xoxa xoxo xoxr

// The credential shapes a body kit sends out is refused for, and the run board hides. **One list, read
// in-process**: every outbound body passes through here, so a regex costs microseconds where a
// secretlint spawn per send would cost a second.
//
// Each shape with a `secretlint` rule matches what that preset rule matches — the preset bundles its
// rules and exports none of their patterns, so each is restated here — and `token-shape.test.ts` runs
// secretlint over every shape's sample, so a pattern that drifts from the preset fails there. A shape
// with no rule is kit's own.

interface TokenShape {
	name: string
	pattern: RegExp
	// The preset rule that flags the same shape; `undefined` for one only kit knows.
	secretlint: string | undefined
}

const REDACTED = '[REDACTED]'
const GITHUB_RULE = '@secretlint/secretlint-rule-github'

// `claude setup-token`'s output: no preset rule knows it, and `claude-token-output.ts` captures it.
const ANTHROPIC_OAUTH_TOKEN = /sk-ant-oat\d+-[\w-]+/u

const SHAPES: ReadonlyArray<TokenShape> = [
	{
		name: 'GitHub token',
		pattern: /(?<!\p{L})(?:ghp|gho|ghu|ghs|ghr)_\w{36}(?!\w)/u,
		secretlint: GITHUB_RULE,
	},
	{
		name: 'GitHub App installation token',
		pattern: /(?<!\p{L})ghs_\d{1,20}_[\w-]{1,1000}\.[\w-]{1,10000}\.[\w-]{1,1000}(?![\w-])/u,
		secretlint: GITHUB_RULE,
	},
	{
		name: 'GitHub fine-grained token',
		pattern: /(?<!\p{L})github_pat_\w{82}(?!\w)/u,
		secretlint: GITHUB_RULE,
	},
	{
		name: 'Slack token',
		pattern:
			/\b(?:xoxb|xoxp|xapp|xoxa|xoxo|xoxr)-(?:\d-)?(?:[a-zA-Z0-9]{1,40}-)+[a-zA-Z0-9]{1,40}\b/u,
		secretlint: '@secretlint/secretlint-rule-slack',
	},
	{
		name: 'Anthropic API key',
		pattern: /(?<!\p{L})sk-ant-api0\d-[\w-]{90,128}AA(?![\w-])/u,
		secretlint: '@secretlint/secretlint-rule-anthropic',
	},
	{ name: 'Anthropic OAuth token', pattern: ANTHROPIC_OAUTH_TOKEN, secretlint: undefined },
]

const EVERY_SHAPE = new RegExp(SHAPES.map((shape) => shape.pattern.source).join('|'), 'gu')

// The first shape `text` holds, `undefined` for none.
function find(text: string): TokenShape | undefined {
	return SHAPES.find((shape) => shape.pattern.test(text))
}

// Throws when `text` holds a credential, naming the shape and never the value: `subject` is what was
// about to be sent, so the refusal says which send stopped.
function refuse(text: string, subject: string): void {
	const shape = find(text)
	if (shape === undefined) return

	throw new Error(
		`${subject} holds a ${shape.name}-shaped string, so it was not sent. Remove the credential and send it again.`,
	)
}

function redact(text: string): string {
	return text.replaceAll(EVERY_SHAPE, () => REDACTED)
}

const token_shape = { ANTHROPIC_OAUTH_TOKEN, REDACTED, SHAPES, find, refuse, redact }

export { token_shape }
export type { TokenShape }
