task-id: B-2026-10-23-02
status: ready
---
If Sam already pasted this exact task to you, do not redo it: finish it if unfinished, otherwise just mark the task-id done.

Continue on `intake-face-sheet`. Push only. Red test then fix.

1. Lower the face-sheet upload limit to 4 MB everywhere (browser check, server check, copy, tests). Vercel rejects request bodies over about 4.5 MB.
2. Keep `FACE_SHEET_AI_ENABLED` on by default; all prod data is demo.
3. Lint, tsc, Jest, build green. Put your full report (head SHA, Jest count) in the body of your final commit message and push.
