# [LLM05 - Insecure Output Handling](https://riteshs4hu.gitbook.io/infosec-notes/artificial-intelligence/owasp-top-10-llm/llm05-insecure-output-handling)

Insecure Output Handling occurs when an LLM's output is passed to another component or interpreter without proper validation, sanitization, or encoding, allowing attacker-controlled content to trigger unintended actions.

### Challenges

* [DevDB Copilot](Challenge-1)

* [AI Support Chat](Challenge-2)

### Requirements

Challenge 1 requires a **tool-calling-capable** model. Challenge 2 does not - the model is only ever asked to write a reply.
