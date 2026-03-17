# Review Workflow

## Standard Process for Every Work Order

```
1. Claude Code picks up WO → sets status: in_progress
2. Claude Code writes migration/code files
3. Claude Code runs agent technical review (automated)
4. Claude Code fixes any issues found
5. Claude Code generates WO-X_review_context.md in /reviews/
6. Claude Code sets status: in_review
7. You open Claude Cowork → final review (see below)
8. You set status: completed (or flag issues back to Claude Code)
```

## How to Run a Final Review in Claude Cowork

1. Open the Claude Cowork desktop app
2. Connect it to your `Functional Medicine` folder
3. Use this prompt template:

---

**Cowork Prompt Template:**

> Please do a final review of [WO-X].
> Read the file `reviews/WO-X_review_context.md` for the full scope, requirements, and acceptance criteria checklist.
> Then read the migration files listed in that document.
> Work through every checkbox in the acceptance criteria.
> Give me a final PASS or FAIL verdict with any items that need attention.

---

## Review Context Files

| File | Work Order | Status |
|------|-----------|--------|
| `reviews/WO-1_review_context.md` | WO-1: Enum Types & Core Tables | in_review |
| `reviews/WO-2_review_context.md` | WO-2: Pharmacy Adapter Tables | in_review |

## Marking Complete

Once Cowork gives a PASS verdict:
- Update the work order status to `completed` in the Software Factory
- Or ask Claude Code to do it: "Mark WO-X as completed"
