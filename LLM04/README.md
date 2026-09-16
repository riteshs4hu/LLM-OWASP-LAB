# [LLM04 - Data and Model Poisoning](https://riteshs4hu.gitbook.io/infosec-notes/artificial-intelligence/owasp-top-10-llm/llm04-data-and-model-poisoning)

Data and Model Poisoning occurs when an attacker manipulates the data, training material, or knowledge sources used by an AI system, causing the model to produce incorrect, biased, or attacker-controlled results.

### Challenge

* [RAG Document Poisoning](Challenge-1)

### Requirements

No tool calling required - any general chat model works. The retriever uses the `nomic-embed-text:latest` embedding model where it is available and falls back to an in-process TF-IDF vectoriser where it is not.
