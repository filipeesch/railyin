# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: board-project-badge.spec.ts >> Board project badge >> PB-1: task card shows project key badge when task has a projectKey
- Location: e2e/ui/board-project-badge.spec.ts:5:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-task-id]').locator('.task-card__project-badge, [data-testid="project-badge"]')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('[data-task-id]').locator('.task-card__project-badge, [data-testid="project-badge"]')

```

# Page snapshot

```yaml
- generic [ref=e4]:
  - generic [ref=e5]:
    - generic [ref=e6]:
      - button "Test Workspace" [ref=e8] [cursor=pointer]:
        - generic [ref=e9]: Test Workspace
      - generic [ref=e10] [cursor=pointer]:
        - combobox "Test Board" [ref=e11]
        - img [ref=e13]
      - button "Edit workflow" [ref=e15] [cursor=pointer]:
        - generic [ref=e16]: 
    - generic [ref=e17]:
      - button "Switch to dark mode" [ref=e18] [cursor=pointer]:
        - generic [ref=e19]: 
      - button "Settings" [ref=e20] [cursor=pointer]:
        - generic [ref=e21]: 
      - button "Chat sessions" [ref=e22] [cursor=pointer]:
        - generic [ref=e23]: 
  - generic [ref=e24]:
    - generic [ref=e25]:
      - generic [ref=e26]:
        - generic [ref=e27]: Backlog
        - generic [ref=e28]: "1"
      - button "New Task" [ref=e30] [cursor=pointer]:
        - generic [ref=e31]: 
        - generic [ref=e32]: New Task
      - generic [ref=e34]:
        - generic [ref=e36]: Task 1
        - generic [ref=e39]: Idle
    - generic [ref=e41]:
      - generic [ref=e42]: Plan
      - generic [ref=e43]: "0"
    - generic [ref=e46]:
      - generic [ref=e47]: In Progress
      - generic [ref=e48]: "0"
    - generic [ref=e51]:
      - generic [ref=e52]: In Review
      - generic [ref=e53]: "0"
    - generic [ref=e56]:
      - generic [ref=e57]: Done
      - generic [ref=e58]: "0"
  - generic [ref=e61] [cursor=pointer]:
    - generic [ref=e62]: Terminal
    - generic [ref=e63]: "Ctrl+`"
```

# Test source

```ts
  1  | import { test, expect } from "./fixtures";
  2  | import { navigateToBoard } from "./fixtures/board-helpers";
  3  | 
  4  | test.describe("Board project badge", () => {
  5  |     test("PB-1: task card shows project key badge when task has a projectKey", async ({ page }) => {
  6  |         test.fail(); // Known gap: TaskCard.vue does not render projectKey as a badge
  7  | 
  8  |         await navigateToBoard(page);
  9  | 
  10 |         // The default task has projectKey: "test-project" (from makeTask defaults).
  11 |         // A correctly implemented card would render a project badge element.
  12 |         await expect(
  13 |             page.locator("[data-task-id]").locator('.task-card__project-badge, [data-testid="project-badge"]'),
> 14 |         ).toBeVisible();
     |           ^ Error: expect(locator).toBeVisible() failed
  15 |     });
  16 | });
  17 | 
```