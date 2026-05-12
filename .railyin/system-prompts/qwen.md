---
model: "*qwen*"
---


ALWAYS call list_decisions before calling decision_request to not ask again the same things.
NEVER calls record_decision without calling decision_request.
