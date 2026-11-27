#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { no_filing_declaration } from './no-filing-declaration'

// The `josh session:resume` entry and the `session-resume` hook bundle, run on `SessionStart` with the
// `resume` matcher: a resume ends the session's no-filing declaration (joshuafolkken/kit#9076). It
// prints nothing — the language hook rides `UserPromptSubmit` alone (joshuafolkken/kit#1930).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await no_filing_declaration.end_on_resume()
}
