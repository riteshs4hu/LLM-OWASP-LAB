# [LLM02 – Sensitive Information Disclosure](https://riteshs4hu.gitbook.io/infosec-notes/artificial-intelligence/owasp-top-10-llm/llm02-sensitive-information-disclosure)

Sensitive Information Disclosure occurs when an LLM application unintentionally exposes confidential, private, or otherwise sensitive information through its responses, context, prompts, conversation history, or connected data sources.

### Challenges

* [Customer Support Chatbot](Challenge-1)

* [DevHelp Chatbot](Challenge-2)

* [Customer Support Assistant](Challenge-3)

### Requirements

Challenges 1 and 2 run on any general chat model - no tool calling needed. Challenge 3 requires a **tool-calling-capable** model. Challenge 1 is calibrated for a smaller model and `app.py` defaults to `qwen2.5:3b`.
