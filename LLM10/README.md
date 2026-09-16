# [LLM10 - Unbounded Consumption](https://riteshs4hu.gitbook.io/infosec-notes/artificial-intelligence/owasp-top-10-llm/llm10-unbounded-consumption)

Unbounded Consumption occurs when an LLM application allows excessive or uncontrolled use of computational resources, such as repeated requests, large inputs, expensive processing, or uncontrolled agent execution, without sufficient limits or safeguards.

### Challenges

* [Nimbus Assistant](Challenge-1)

* [DocuChat](Challenge-2)

* [DeepDive Research Agent](Challenge-3)

### Requirements

Challenge 3 requires a **tool-calling-capable** model and outbound internet access for its live search tool. Challenges 1 and 2 need neither - any chat model will work, and a small, fast model is better for Challenge 1.
