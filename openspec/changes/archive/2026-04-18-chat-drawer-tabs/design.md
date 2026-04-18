## Context

The `TaskDetailDrawer` is the primary task interaction surface. Its current layout uses a two-column body: a scrollable conversation timeline on the left and a fixed metadata sidebar on the right. The sidebar contains workflow state, execution info, branch/worktree details, session notes, and "Move to" transition buttons.

This layout has two friction points:
1. The sidebar consumes ~30% of drawer width from the conversation, which is the primary use case.
2. Navigation/action controls (workflow transitions, launch buttons) are scattered — sidebar for transitions, a separate `launch-bar` div for Run/Tools, header for edit/delete.

The goal is to consolidate controls into one persistent toolbar row and free the full drawer width for conversation.

## Goals / Non-Goals

**Goals:**
- Give the conversation timeline full drawer width
- Introduce a Chat / Info tab switcher for progressive disclosure of task metadata
- Unify all task action controls (workflow, terminal, run, tools) in one toolbar row
- Surface task description as a readable markdown document in the Info tab
- Remove session notes from the UI (no longer useful as user-facing info)
- Move the edit-description action to the Info tab, contextually near the description

**Non-Goals:**
- Persisting the selected tab across sessions or tasks (always opens on Chat)
- Redesigning the chat input area, model selector, or context gauge
- Changing the changed files panel or todo panel behaviour
- Modifying the board view or task card

## Decisions

### D1: Toolbar row layout — tabs left, action cluster right

```
[💬 Chat] [ℹ Info]   [in-progress ▾] [⌨] [▶ Run ▾] [⚙ ▾]
```

The tab switcher anchors left; the action cluster (workflow select + terminal + run + tools) anchors right. This mirrors common IDE patterns (tabs left, actions right) and allows the toolbar to scale gracefully when there are few or many launch entries.

**Alternatives considered:**
- Tabs in a separate row below toolbar: adds visual weight and height for no gain
- Navigation arrows (← →) instead of select: implied linear ordering doesn't match non-linear boards

### D2: Workflow navigation as a Select dropdown showing current state

The workflow state indicator becomes a `<Select>` component populated with all board columns. The currently active column is the selected value. Choosing another column triggers the transition.

This replaces three things at once: the side panel "Move to" buttons, the exec state tag in the header, and the separate workflow state label. One widget, full context.

**Alternatives considered:**
- Keep "Move to" buttons in side panel / Info tab: buries a frequent action behind a tab switch
- Clickable pill in header: not discoverable, no clear affordance for action

### D3: Info tab composition

```
PROJECT
  Board · <name>  ·  <project-key>

WORKTREE
  Branch   <branch-name>
  Path     <worktree-path>
  Status   <worktree-status>

DESCRIPTION                          [✏ Edit]
┌──────────────────────────────────────────┐
│  <task description rendered as markdown> │
└──────────────────────────────────────────┘
```

Session notes removed. Execution stats (retry count, execution count) removed from the Info tab — the exec state badge in the header is sufficient signal.

### D4: Edit button moves to Info tab

The `[✏ Edit]` button currently lives in the drawer header. Moving it inline to the Description section in the Info tab is more contextual — you see the content, you edit the content. The header stays clean.

**No edit button in header** when on Chat tab — if the user wants to edit, they switch to Info.

### D5: Terminal button in toolbar

A `[⌨ Terminal]` button opens a terminal at the task's worktree path. It sits between the workflow select and the Run button. This groups it with the other "launch something" actions and avoids adding it to the Info tab where it would feel buried.

If no worktree path is set, the terminal button is hidden (same pattern as LaunchButtons hiding when no profiles are configured).

## Risks / Trade-offs

- **Edit discoverability**: Moving `[✏ Edit]` out of the header may confuse existing users who muscle-memory it. Mitigation: tooltip on the Info tab label, and the pencil icon is in a natural position next to Description.
- **Workflow select vs. exec badge**: The exec tag (`●running`) stays in the header; the workflow column lives in the select. These are different dimensions (execution lifecycle vs. board position) and should remain visually separate.
- **Toolbar crowding on narrow drawers**: With 5 controls in the right cluster, very narrow drawers may clip labels. Mitigation: workflow select truncates label, run/tools can be icon-only at small sizes (LaunchButtons already has a `cardMode` for this).

## Open Questions

- Should the terminal button be part of `LaunchButtons` (new prop) or a standalone button rendered directly in the toolbar?
- Should the workflow select be disabled while a task is `running`? (Currently transitions are not blocked server-side during execution.)
