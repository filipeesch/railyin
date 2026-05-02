## ADDED Requirements

### Requirement: Chat autoscroll does not stutter during streaming
The chat panel's RAF-based autoscroll loop SHALL call only `scrollToBottom()` (using `scrollEl.scrollTop = scrollEl.scrollHeight`) during active streaming. `virtualizer.scrollToIndex` SHALL NOT be called on the same frame as `scrollToBottom`, as these two produce conflicting scroll targets that cause visible stutter.

#### Scenario: No stutter during token streaming
- **WHEN** an AI execution is streaming tokens into the chat
- **THEN** the chat scrolls smoothly to the bottom on each new token without jumping back and forth

#### Scenario: scrollToIndex used only for navigation
- **WHEN** the user navigates to a specific message (e.g., via a search result or external link)
- **THEN** `virtualizer.scrollToIndex` is used for that navigation jump, independently of the streaming RAF loop

### Requirement: Reasoning bubble autoscrolls while streaming
While a `ReasoningBubble` component is in its `streaming` state, the bubble's scrollable content area SHALL automatically scroll to the bottom whenever new content is appended.

#### Scenario: Reasoning bubble scrolls as content grows
- **WHEN** a reasoning bubble is streaming and new content is appended
- **THEN** the bubble's body scrolls to show the latest content without user interaction

#### Scenario: Reasoning bubble does not auto-scroll after streaming ends
- **WHEN** a reasoning bubble is not in the streaming state
- **THEN** the bubble's scroll position is not automatically changed

### Requirement: Infinite scroll sentinel triggers when already in viewport on autoScroll disable
The infinite scroll sentinel SHALL trigger a `load-older` event when `autoScroll` transitions from `true` to `false` AND the sentinel is already within the visible bounds of the scroll container. This handles the case where the `IntersectionObserver` does not fire a state-change event because intersection state did not change.

#### Scenario: load-older fires when sentinel is in viewport at autoScroll disable
- **WHEN** the user scrolls up (disabling autoScroll) and the sentinel is already within the scroll container's viewport
- **THEN** `load-older` is emitted immediately, triggering the next page of older messages to load

#### Scenario: load-older does not double-fire when sentinel crosses viewport
- **WHEN** the user scrolls up and the sentinel transitions from out-of-viewport to in-viewport
- **THEN** `load-older` is emitted once (via the IntersectionObserver), not twice
