# Orchestrator task queue

This branch is never merged. The orchestrator writes one file per agent: tasks/agent-a.md ... tasks/agent-d.md.

Each file starts with:

    task-id: <unique id>
    status: ready | idle

then a line `---`, then the full task prompt.

Agents poll this branch with git only, run a task whose task-id they have not done yet, and put their full report in the body of their final commit message on their work branch.
