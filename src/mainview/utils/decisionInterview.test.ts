import { describe, it, expect } from "vitest";
import type { ConversationMessage } from "../../shared/rpc-types";
import {
  computeResizeHeight,
  episodeKey,
  hasUserMessageAfterPrompt,
  isDismissedEpisode,
  isInterviewStale,
  latestPromptId,
  migrateDismissalKey,
} from "./decisionInterview";

function makeMsg(id: number, conversationId: number, type: ConversationMessage["type"], content = `msg-${id}`): ConversationMessage {
  return {
    id,
    taskId: null,
    conversationId,
    type,
    role: type === "assistant" ? "assistant" : null,
    content,
    metadata: null,
    createdAt: new Date().toISOString(),
  };
}

function makePrompt(id: number, conversationId = 1): ConversationMessage {
  return makeMsg(id, conversationId, "decision_request_prompt", JSON.stringify({ questions: [] }));
}

function makeUser(id: number, conversationId = 1): ConversationMessage {
  return makeMsg(id, conversationId, "user", "A: answer");
}

describe("latestPromptId", () => {
  it("returns null when the conversation has no decision_request_prompt", () => {
    expect(latestPromptId([makeMsg(1, 1, "assistant"), makeMsg(2, 1, "user")], 1)).toBeNull();
  });

  it("returns the single prompt id", () => {
    expect(latestPromptId([makePrompt(10)], 1)).toBe(10);
  });

  it("returns the LAST prompt id when multiple exist", () => {
    expect(latestPromptId([makePrompt(10), makePrompt(20)], 1)).toBe(20);
  });

  it("ignores prompts from other conversations", () => {
    expect(latestPromptId([makePrompt(10, 2), makePrompt(11, 1)], 1)).toBe(11);
  });
});

describe("hasUserMessageAfterPrompt", () => {
  it("true when a user message exists with id greater than the prompt id", () => {
    expect(hasUserMessageAfterPrompt([makePrompt(10), makeUser(11)], 1, 10)).toBe(true);
  });

  it("false when the only user message is before the prompt (early-submit race data)", () => {
    expect(hasUserMessageAfterPrompt([makeUser(9), makePrompt(10)], 1, 10)).toBe(false);
  });

  it("false when there is no user message", () => {
    expect(hasUserMessageAfterPrompt([makePrompt(10), makeMsg(11, 1, "assistant")], 1, 10)).toBe(false);
  });

  it("false when the user message belongs to another conversation", () => {
    expect(hasUserMessageAfterPrompt([makePrompt(10, 1), makeUser(11, 2)], 1, 10)).toBe(false);
  });
});

describe("isInterviewStale", () => {
  it("false when no persisted prompt exists", () => {
    expect(isInterviewStale("idle", false, false)).toBe(false);
    expect(isInterviewStale("waiting_user", false, false)).toBe(false);
  });

  it("false while the conversation is waiting_user or running", () => {
    expect(isInterviewStale("waiting_user", false, true)).toBe(false);
    expect(isInterviewStale("running", false, true)).toBe(false);
  });

  it("false while live pages are streaming (episode in progress)", () => {
    expect(isInterviewStale("running", true, true)).toBe(false);
    expect(isInterviewStale("idle", true, true)).toBe(false);
  });

  it("true once the conversation moved past a persisted interview with no live pages", () => {
    for (const state of ["idle", "completed", "failed", "cancelled", "archived", null]) {
      expect(isInterviewStale(state, false, true)).toBe(true);
    }
  });
});

describe("episodeKey", () => {
  it("live execution wins over persisted prompt", () => {
    expect(episodeKey(5, 100)).toBe("exec:5");
  });

  it("falls back to the prompt id when no live execution", () => {
    expect(episodeKey(null, 100)).toBe("prompt:100");
  });

  it("null when neither a live execution nor a prompt exists", () => {
    expect(episodeKey(null, null)).toBeNull();
  });
});

describe("isDismissedEpisode", () => {
  it("true when the stored key matches the current key", () => {
    expect(isDismissedEpisode("prompt:100", "prompt:100")).toBe(true);
  });

  it("false when the keys differ (new episode)", () => {
    expect(isDismissedEpisode("prompt:100", "prompt:200")).toBe(false);
  });

  it("false when either side is null", () => {
    expect(isDismissedEpisode(null, "prompt:100")).toBe(false);
    expect(isDismissedEpisode("prompt:100", null)).toBe(false);
  });
});

describe("migrateDismissalKey", () => {
  it("migrates an exec-keyed dismissal to the prompt key at terminal reconcile", () => {
    expect(migrateDismissalKey("exec:5", 5, 100)).toBe("prompt:100");
  });

  it("leaves the key unchanged when it does not match the live execution", () => {
    expect(migrateDismissalKey("exec:9", 5, 100)).toBe("exec:9");
  });

  it("leaves a prompt-keyed dismissal unchanged", () => {
    expect(migrateDismissalKey("prompt:100", 5, 100)).toBe("prompt:100");
  });

  it("returns null when nothing is stored", () => {
    expect(migrateDismissalKey(null, 5, 100)).toBeNull();
  });
});

describe("computeResizeHeight", () => {
  const MIN = 120;
  const MAX = 500;

  it("grows when dragged UP (negative delta)", () => {
    expect(computeResizeHeight(320, -120, MIN, MAX)).toBe(440);
  });

  it("shrinks when dragged DOWN (positive delta)", () => {
    expect(computeResizeHeight(320, 120, MIN, MAX)).toBe(200);
  });

  it("clamps at the minimum height", () => {
    expect(computeResizeHeight(320, 1000, MIN, MAX)).toBe(MIN);
  });

  it("clamps at the maximum height", () => {
    expect(computeResizeHeight(320, -1000, MIN, MAX)).toBe(MAX);
  });

  it("returns the same height when there is no movement", () => {
    expect(computeResizeHeight(320, 0, MIN, MAX)).toBe(320);
  });
});
