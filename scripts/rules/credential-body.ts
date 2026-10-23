import { file_reader } from '#scripts/lib/read-file'
import { token_shape } from '#scripts/lib/token-shape'
import { bash_triggers } from './bash-triggers'
import { direct_pr_create } from './direct-pr-create'
import { gh_api, type FieldSource } from './gh-api'
import { git_argv } from './git-argv'

// The `credential-body` row of `delivered-rules.ts`. A body kit sends is refused when it holds a
// token-shaped string (`git-gh-exec.ts`, joshuafolkken/kit#4658), but a `gh api` call a run types on
// the shell never passes through kit's code, so the same scan runs here before the call does
// (joshuafolkken/kit#4682). The shapes are `token-shape.ts`'s, read by `token_shape.holds` — the test
// `token_shape.refuse` throws on — so no second copy of a pattern exists.
//
// **The text `gh` would send, not the command line alone**: each field value, and the file a
// `-F key=@<path>` or `--input <path>` names, read as the hook sees it — a path relative to a
// directory a `cd` earlier on the line moved to is not found and reads as empty. A JSON body is scanned
// decoded, as the in-process send does.
//
// **It fires on every occurrence**, for the reason `git-force.ts` does.

// `gh` sends a typed `\n` as the two characters, so a token after it follows the letter `n` and the
// shapes' "no letter before it" guard would pass it. So the text is scanned twice — as sent, and with
// each escape read as a space — since a backslash may also sit right before the token (`\ghp_…`),
// where the second reading loses its first letter. A non-JSON file is read the same way.
const TYPED_ESCAPE = /\\./gu

function sent_text(source: FieldSource): string {
	if (source.kind === 'text') return source.value

	return token_shape.decoded(file_reader.read_if_readable(source.value) ?? '')
}

function holds_token(text: string): boolean {
	return [text, text.replaceAll(TYPED_ESCAPE, () => ' ')].some((reading) =>
		token_shape.holds(reading),
	)
}

function is_credential_segment(segment: string): boolean {
	const args = git_argv.arguments_of(segment, direct_pr_create.GH_COMMAND)

	if (args === undefined) return false

	const call = [direct_pr_create.GH_COMMAND, ...args].join(' ')

	if (!gh_api.is_gh_api(call)) return false

	return gh_api.field_sources(call).some((source) => holds_token(sent_text(source)))
}

function sends_credential(command: string): boolean {
	return direct_pr_create.has_run_segment(command, is_credential_segment)
}

const CREDENTIAL_BODY_REASON =
	'⛔ credential in a gh api body: a field value, or the file `-F key=@<path>` / `--input <path>` ' +
	'names, holds a token-shaped string (`scripts/lib/token-shape.ts`), and the call would publish it. ' +
	'Remove the credential from the body and send it again. ' +
	'**This rule fires on every occurrence, not once per run.**'

const ROW = {
	id: 'credential-body',
	is_trigger: bash_triggers.on_bash_command(sends_credential),
	reason: CREDENTIAL_BODY_REASON,
	decide: (): boolean => true,
	about: {
		title: 'Credential in a body',
		topic: '`shell-body.md`',
		fires:
			'a `gh api` call whose field value, or the file `-F key=@<path>` / `--input <path>` names, holds a token-shaped string (`token-shape.ts`). Every occurrence',
		quiet: 'a body with no credential, or a body sent through kit, which runs the same scan',
	},
}

const credential_body = { CREDENTIAL_BODY_REASON, ROW, sends_credential }

export { credential_body }
