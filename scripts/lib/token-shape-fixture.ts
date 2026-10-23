// cspell:words xoxb

// One sample of every shape `token-shape.ts` knows, by the shape's name. Each is assembled at run
// time, so no source file holds a literal credential for the secretlint scan to flag.

interface TokenSample {
	name: string
	sample: string
}

const GITHUB_TOKEN_LENGTH = 36
const GITHUB_PAT_LENGTH = 82
const ANTHROPIC_KEY_BODY_LENGTH = 93
const OAUTH_BODY_LENGTH = 80
// Short enough that `ghs_` plus the App ID and first part stays under the classic shape's 36.
const JWT_PART_LENGTH = 20

const TOKEN_SAMPLES: ReadonlyArray<TokenSample> = [
	{ name: 'GitHub token', sample: `ghp_${'a'.repeat(GITHUB_TOKEN_LENGTH)}` },
	{
		name: 'GitHub App installation token',
		sample: `ghs_12345678_${['e', 'f', 'g'].map((part) => part.repeat(JWT_PART_LENGTH)).join('.')}`,
	},
	{ name: 'GitHub fine-grained token', sample: `github_pat_${'b'.repeat(GITHUB_PAT_LENGTH)}` },
	{
		name: 'Slack token',
		sample: ['xoxb', '1234567890', '1234567890', 'abcdefghijABCDEFGHIJabcd'].join('-'),
	},
	{
		name: 'Anthropic API key',
		sample: `sk-ant-api03-${'c'.repeat(ANTHROPIC_KEY_BODY_LENGTH)}AA`,
	},
	{ name: 'Anthropic OAuth token', sample: `sk-ant-oat01-${'d'.repeat(OAUTH_BODY_LENGTH)}` },
]

function sample_of(name: string): string {
	const found = TOKEN_SAMPLES.find((entry) => entry.name === name)
	if (found === undefined) throw new Error(`No sample for the ${name} shape.`)

	return found.sample
}

const token_shape_fixture = { TOKEN_SAMPLES, sample_of }

export { token_shape_fixture }
