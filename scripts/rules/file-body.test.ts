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

// joshuafolkken/kit#3155: the write shapes lane transcripts showed slipping past the first-line read.
describe('file_body.carries_a_file_body — refuses past the first line', () => {
	it.each([
		[
			'a python heredoc opened after a cd line',
			"cd /lane\npython3 - <<'PY'\nopen(p, 'w').write(s)\nPY",
		],
		['a path-object write_text', "python3 - <<'PY'\nPath(p).write_text(s)\nPY"],
		['a node heredoc that writes', "node - <<'JS'\nfs.writeFileSync(p, s)\nJS"],
		[
			'a heredoc creating a script that writes',
			"cat > /tmp/scratch/edit.py <<'EOF'\nopen(p, 'w').write(s)\nEOF",
		],
		['an in-place perl on a later line', "cd /lane\nperl -0pi -e 's/a/b/' CLAUDE.md"],
	])('refuses %s', (_label, command) => {
		expect(file_body.carries_a_file_body(command, is_absent)).toBe(true)
	})

	it('refuses an existing-file rewrite on a later line', () => {
		expect(
			file_body.carries_a_file_body("cd /lane\ncat > CLAUDE.md <<'EOF'\nx\nEOF", is_present),
		).toBe(true)
	})
})

describe('file_body.carries_a_file_body — stays silent past the first line', () => {
	it.each([
		[
			'a read-only python heredoc after a cd line',
			"cd /lane\npython3 - <<'PY'\nprint(open(p).read())\nPY",
		],
		['a heredoc creating a read-only script', "cat > /tmp/scratch/scan.py <<'EOF'\nprint(1)\nEOF"],
		[
			'a heredoc creating a non-script file that quotes a write',
			"cat > /tmp/scratch/notes.md <<'EOF'\nopen(p, 'w').write(s)\nEOF",
		],
		[
			'a body line that only names an interpreter',
			"cat > notes.md <<'EOF'\nperl -0pi -e 's/a/b/' x\nEOF",
		],
		[
			'a read-only python heredoc beside a notes heredoc that quotes a write',
			"python3 - <<'PY'\nprint(1)\nPY\ncat > notes.md <<'EOF'\nopen(p, 'w').write(s)\nEOF",
		],
		[
			'a read-only script heredoc followed by a message naming a write call',
			"cat > /tmp/scratch/scan.py <<'EOF'\nprint(1)\nEOF\ngit commit -m 'use writeFile('",
		],
		['a here-string followed by a later line', "python3 - <<< 'print(1)'\nopen(p, 'w').write(s)"],
	])('allows %s', (_label, command) => {
		expect(file_body.carries_a_file_body(command, is_absent)).toBe(false)
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
		'Write tool',
		'fires on every occurrence',
	])('carries %j', (marker) => {
		expect(file_body.FILE_BODY_REASON).toContain(marker)
	})
})
