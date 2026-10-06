# Glossary

The words kit's guides use for its workflow, each in a sentence or two with the page that explains it. The agent's own definitions live in the rules kit ships; this page is for the person running the agent.

- **Issue workflow keywords** — `kickoff`, `halfrun`, `prrun`, `fullrun` and `backlogrun`, typed to the agent rather than run in a terminal. Each takes an Issue (`#N`) or a new request (`new`) a different distance, from a posted plan to a merged pull request. → [Run Issues with the workflow keywords](./how-to/run-issues.md)
- **gate** — the verification gate, `pnpm josh gate`: format, lint, type checks, spelling and tests in one command. A change is not done until it passes. → [Fix a failing gate or CI](./how-to/fix-gate-and-ci.md)
- **profile** — how much of kit a project receives. `full` is for Node projects and gets the whole workflow; `basic` gets short AI rules plus formatting, Git and editor settings. → [Switch profile](./how-to/switch-profile.md)
- **`auto-ok`** — the approval label. The agent works unattended only on Issues a person gave this label, or Issues under an epic that carries it. → [Labels and run states](./labels-and-run-states.md)
- **epic** — an Issue that tracks other Issues (its children) and the order they depend on each other in. A request too big for one change is split into an epic and its children. → [Run the backlog](./how-to/run-backlog.md)
- **lane** — a separate working copy (a git worktree) that `backlogrun` gives each Issue it runs in parallel, so two Issues never write into the same files. → [Run the backlog](./how-to/run-backlog.md)
- **park** — what `backlogrun` does with an Issue that needs a person's decision: it labels it `needs-decision`, leaves it for you and moves on to the next one. → [Recover a stopped run](./how-to/recover-a-run.md)
- **hold** — the record that one run owns a working tree, so a second run cannot commit onto its branch. A run that stopped can leave one behind. → [Recover a stopped run](./how-to/recover-a-run.md)
- **sync** — `pnpm josh sync`, which refreshes the rules and files kit manages in a project after kit is updated. → [sync.md](./sync.md)
