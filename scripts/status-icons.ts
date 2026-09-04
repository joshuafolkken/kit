// The icons josh prints in front of a result line (joshuafolkken/kit#1361).
//
// They were one character each, declared beside whichever command printed them — the verification
// gate, the health check, the propagation run — and that was harmless while nothing ever *read*
// them. `time-reported-failure.ts` now does: a josh check that ran inside a pipeline exits with the
// pipe's status rather than its own, so the only evidence left that it failed is the line it printed.
// A detector matching a character the emitter is free to change on its own is a detector that goes
// quiet without failing, so the character is declared once here and both ends import it.
//
// **Only the failure icon is shared.** `josh propagate` opens its success line with `✓` where the
// gate uses `✔`, and unifying those would change what two commands print in order to tidy a
// constant — a decision about output, not about single-sourcing. Nothing reads the success icon.

const FAIL_ICON = '✗'

const status_icons = { FAIL_ICON }

export { status_icons }
