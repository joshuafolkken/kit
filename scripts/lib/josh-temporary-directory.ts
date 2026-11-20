// The scratch directory every agent writes into — Issue / PR bodies, plans, handoffs, logs. kit's
// distributed `.gitignore` ignores it, so `josh git`, which stages every untracked non-ignored file,
// never commits what is written here. One constant, because a body reader that refuses other places
// names this one, and the writers that default to it must not drift from the place it names.
const JOSH_TMP_DIRECTORY = '.josh/tmp'

// The one place a consultation script may write: `josh scratch:run` grants Node's permission model write
// access here and nowhere else, so a script run through it cannot touch a tracked file.
const JOSH_SCRATCH_DIRECTORY = `${JOSH_TMP_DIRECTORY}/scratch`

export { JOSH_SCRATCH_DIRECTORY, JOSH_TMP_DIRECTORY }
