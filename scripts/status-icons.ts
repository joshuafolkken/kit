// The icons josh prints in front of a result line (joshuafolkken/kit#1361).
//
// They were one character each, declared beside whichever command printed them — the verification
// gate, the health check, the propagation run — and that was harmless while nothing ever *read*
// them. `time-reported-failure.ts` now does: a josh check that ran inside a pipeline exits with the
// pipe's status rather than its own, so the only evidence left that it failed is the line it printed.
// A detector matching a character the emitter is free to change on its own is a detector that goes
// quiet without failing, so the character is declared once here and both ends import it.
//
// **`josh propagate`'s `✓` is still its own.** It opens its success line with `✓` where the gate and
// the health check use `✔`, and unifying those would change what a command prints in order to tidy a
// constant — a decision about output, not about single-sourcing.
//
// **The success icon is read too since joshuafolkken/kit#1374.** `josh-verdict.ts` reads the gate's
// `✔ verification gate passed` line to tell a green gate from the third-party warning bodies it
// forwards, so the pass icon is now under the same rule the failure icon has been under: declared
// once, imported by the printer and the reader alike.

const FAIL_ICON = '✗'
const PASS_ICON = '✔'

const status_icons = { FAIL_ICON, PASS_ICON }

export { status_icons }
