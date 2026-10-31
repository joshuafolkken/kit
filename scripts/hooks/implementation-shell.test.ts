import { describe, expect, it } from 'vitest'
import { implementation_shell } from './implementation-shell'

describe('visible shell write scope', () => {
	it.each([
		'echo changed >> app.ts',
		'echo changed >|app.ts',
		'printf changed > notes.md > app.ts',
		'printf changed > "$DESTINATION"',
		'printf changed > "notes.md".ts',
		'printf changed > /tmp/other-repo/app.ts',
		'cat <<EOF > app.ts\nchanged\nEOF',
		'echo $(custom-editor app.ts)',
		'echo "$(custom-editor app.ts)"',
		'echo "`custom-editor app.ts`"',
		'echo "$(printf changed > app.ts)"',
		'cat <(custom-editor app.ts)',
		'cat app.ts > >(custom-editor app.ts)',
		'echo changed >& app.ts',
		'cat <>app.ts',
		'gh pr checkout 123',
		'gh issue develop 123 --checkout',
		'gh api repos/owner/repo --output app.ts',
		'rg --pre custom-editor pattern app.ts',
		'git -c core.fsmonitor=custom-editor status',
		'git diff --output=app.ts',
		'git diff "--output=app.ts"',
		'git diff --out\\put=app.ts',
		'git diff $FLAGS',
		'GIT_EXTERNAL_DIFF=custom-editor git diff',
		'gh api repos/owner/repo "--output=app.ts"',
	])('refuses a runtime or unverified destination: %s', (command) => {
		expect(implementation_shell.is_unsafe(command)).toBe(true)
	})
})

// joshuafolkken/kit#5534: only a single-quoted span is literal; an expansion beside it still refuses.
describe('expansion outside a single-quoted span', () => {
	it.each([
		'echo \'text\' "`custom-editor app.ts`"',
		"echo 'it'$(custom-editor app.ts)",
		"echo 'it'`custom-editor app.ts`",
		"echo 'a' FOO=1",
		"echo 'a' $PPID",
	])('refuses an expansion beside quoted text: %s', (command) => {
		expect(implementation_shell.is_unsafe(command)).toBe(true)
	})
})

// joshuafolkken/kit#5498: the documented `run:carry` spelling carries no `$`, so it passes, while any
// command expanding a variable stays refused — the session pid comes from the command, not the shell.
describe('variable expansion beside the run:carry spelling', () => {
	it.each(['echo $PPID', 'pnpm josh run:carry --cut --owner "$PPID"'])('refuses %s', (command) => {
		expect(implementation_shell.is_unsafe(command)).toBe(true)
	})

	it.each([
		'pnpm josh run:carry --begin "backlogrun --max 5"',
		'pnpm josh run:carry --resume "backlogrun --max 5"',
		'pnpm josh run:carry --cut',
	])('lets %s through', (command) => {
		expect(implementation_shell.is_unsafe(command)).toBe(false)
	})
})

describe('unverified shell argument expansion', () => {
	it.each([
		'git diff --out{put,put}=app.ts',
		'git diff --out{p,"p"}ut=app.ts',
		'git diff --out?ut=app.ts',
		'git diff --out*ut=app.ts',
		'git diff --out[p]ut=app.ts',
		'gh api repos/owner/repo --out{put,put}=app.ts',
		'gh api repos/owner/repo --out[p]ut=app.ts',
		'rg --p{re,re} custom-editor pattern app.ts',
		'rg --p[r]e custom-editor pattern app.ts',
	])('refuses expansion before classifying arguments: %s', (command) => {
		expect(implementation_shell.is_unsafe(command)).toBe(true)
	})
})

// joshuafolkken/kit#5497: the bare `epic` subcommand records decisions, adds children and files an
// epic — operations like every `epic:*` — and `rule:list` is the read `delegation.md` asks for.
describe('josh epic operations and rule:list', () => {
	it.each([
		'pnpm josh epic --decide 5392 5389 --decision-file .git/josh/decision-5389.md',
		'pnpm josh epic --add 5392 5389',
		'pnpm josh epic "Bring every lane under 30 minutes" 5502 5503',
		'pnpm josh epic:check 5392',
		'pnpm josh rule:list',
	])('passes the operation %s', (command) => {
		expect(implementation_shell.is_unsafe(command)).toBe(false)
	})

	it.each([
		'pnpm josh epics 5392',
		'pnpm josh gate',
		'pnpm josh rule:other',
		'pnpm josh rule:list-all',
	])('still refuses %s', (command) => {
		expect(implementation_shell.is_unsafe(command)).toBe(true)
	})
})

describe('operational shell reads and records', () => {
	it.each([
		'printf "example > app.ts"',
		'echo plan > "notes.md"',
		'echo plan >> /tmp/issue-body.md',
		'echo plan | tee -a notes.md',
		'git status',
		'git status --short',
		'git -C /tmp/repo diff --stat',
		'git diff -- app.ts',
		'pnpm josh review:attest nonce',
		'pnpm josh review:lint',
		'pnpm josh backlog:plan --waves',
		'gh pr view 123',
		'cat app.ts 2>&1',
		'git diff -- "*.ts"',
		"git diff -- 'app[12].ts'",
		'printf "{plan,record} * ? [literal]"',
		"printf '%s' 'run `josh gate` with $(cmd) and FOO=1'",
		"echo 'cost \\$5' \\`literal",
	])('allows a visible read or record write: %s', (command) => {
		expect(implementation_shell.is_unsafe(command)).toBe(false)
	})
})
