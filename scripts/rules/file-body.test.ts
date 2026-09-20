import { describe, expect, it } from 'vitest'
import { file_body } from './file-body'

// joshuafolkken/kit#2120, group 3: a file's new body carried inline. The existence check is injected so
// the suite controls the one branch `file-edits.md` names — whether the redirect target already exists —
// without touching the real filesystem.

const is_present = (): boolean => true
const is_absent = (): boolean => false

describe('file_body.carries_a_file_body — refuses', () => {
	it('refuses a heredoc rewrite of an existing file', () => {
		expect(
			file_body.carries_a_file_body("cat > CLAUDE.md <<'EOF'\nnew body\nEOF", is_present),
		).toBe(true)
	})

	it('refuses a tee heredoc to an existing file', () => {
		expect(file_body.carries_a_file_body("tee CLAUDE.md <<'EOF'\nnew body\nEOF", is_present)).toBe(
			true,
		)
	})

	it('refuses a python heredoc that writes back', () => {
		const command = "python3 - <<'PY'\nopen('CLAUDE.md', 'w').write(x)\nPY"

		expect(file_body.carries_a_file_body(command, is_absent)).toBe(true)
	})

	it('refuses a node -e write', () => {
		const command = "node -e \"require('fs').writeFileSync('x.ts', body)\""

		expect(file_body.carries_a_file_body(command, is_absent)).toBe(true)
	})

	it('refuses an in-place perl', () => {
		expect(file_body.carries_a_file_body("perl -0pi -e 's/old/new/' CLAUDE.md", is_absent)).toBe(
			true,
		)
	})
})

describe('file_body.carries_a_file_body — is silent', () => {
	it('allows creating a new file with a heredoc', () => {
		expect(file_body.carries_a_file_body("cat > new-file.ts <<'EOF'\nbody\nEOF", is_absent)).toBe(
			false,
		)
	})

	it('allows a read-only heredoc', () => {
		expect(file_body.carries_a_file_body("cat <<'EOF'\njust reading\nEOF", is_present)).toBe(false)
	})

	it('allows a compute-only python heredoc', () => {
		expect(file_body.carries_a_file_body("python3 - <<'PY'\nprint(2 + 2)\nPY", is_absent)).toBe(
			false,
		)
	})

	it('allows a short sed -i', () => {
		expect(file_body.carries_a_file_body("sed -i '' 's/a/b/' CLAUDE.md", is_present)).toBe(false)
	})

	it('allows a redirect extract with no heredoc', () => {
		expect(file_body.carries_a_file_body('grep foo CLAUDE.md > out.txt', is_present)).toBe(false)
	})
})

describe('file_body.FILE_BODY_REASON', () => {
	it.each([
		'file body in a shell command',
		'Edit tool',
		'file-edits.md',
		'--body-file <path>',
		'fires on every occurrence',
	])('carries %j', (marker) => {
		expect(file_body.FILE_BODY_REASON).toContain(marker)
	})
})
