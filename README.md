# OWASP LLM Top 10 Labs

A collection of intentionally vulnerable AI/LLM applications for learning LLM security through hands-on labs.

The goal of this project is to cover the vulnerabilities from the OWASP Top 10 for LLM Applications with practical challenges that you can run locally and test yourself.

Each challenge is self-contained and comes with its own application, setup instructions, and README.

## Before You Start

If you're new to AI or LLMs, I recommend going through the basics before starting the labs.

- [AI & LLM Fundamentals](https://riteshs4hu.gitbook.io/infosec-notes/artificial-intelligence)

- [OWASP Top 10 for LLM Applications](https://riteshs4hu.gitbook.io/infosec-notes/artificial-intelligence/owasp-top-10-llm)

## Lab Setup

### Install Ollama

- [Setup Guide](https://riteshs4hu.gitbook.io/infosec-notes/artificial-intelligence/ai-agents/ollama)

### Choose a Model

The model you need depends on the challenge. 

For labs that use tools, you need an Ollama model that supports Tool Calling:

- Tool Calling Models: https://ollama.com/search?c=tools

If your system isn't powerful enough to run models locally, you can also use Ollama Cloud Models:

- Cloud Models: https://ollama.com/search?c=cloud&o=newest

###  Run a Lab

Each challenge runs the same way. Clone the repository, enter a challenge directory, and start it:

- Clone the repo
    ```bash
    git clone https://github.com/riteshs4hu/LLM-OWASP-LAB.git
    ```
- Nagivate to the Challenge
    ```
    cd LLM-OWASP-LAB/LLM01/Challenge-1/
    ```
- Install the dependance
    ```
    pip install -r requirements.txt
    ```
- Start the server
    ```
    python app.py
    ```
    Then open http://localhost:8000


- Every challenge is also published as a Docker image:

    ```bash
    docker run -p 8000:8000 riteshs4hu/llm01:challenge-1
    ```

- Each image accepts four optional positional arguments, in order:

    ```bash
    docker run -p <port>:8000 riteshs4hu/llm01:challenge-1 <model> <ollama-host> <app-host> <app-port>
    ```

    | Position | Meaning | Default |
    | -------- | ------- | ------- |
    | 1 | model | `nemotron-3-ultra:cloud` |
    | 2 | ollama-host | `http://localhost:11434` |
    | 3 | app-host | `0.0.0.0` |
    | 4 | app-port | `8000` |

The same values can be supplied as environment variables (`MODEL`, `OLLAMA_HOST`, `HOST`, `PORT`). Each challenge README lists any additional settings it supports.


### Challenges 

| Status | ID | Vulnerability | Challenges |
|---------|----|---------------|------------|
| ✅ | LLM01 | Prompt Injection | 3 |
| ✅ | LLM02 | Sensitive Information Disclosure | 3 |
| ⏳ | LLM03 | Supply Chain | - |
| ✅ | LLM04 | Data and Model Poisoning | 1 |
| ✅ | LLM05 | Improper Output Handling | 2 |
| ✅ | LLM06 | Excessive Agency | 2 |
| ✅ | LLM07 | System Prompt Leakage | 3 |
| ✅ | LLM08 | Vector and Embedding Weaknesses | 1 |
| ⏳ | LLM09 | Misinformation (Hallucinations) | - |
| ✅ | LLM10 | Unbounded Consumption | 3 |


## Contributing

Contributions, suggestions, bug reports, and improvements are welcome.

If you'd like to improve an existing lab or add a new challenge, feel free to open an Issue or Pull Request.

For a new challenge, you can start from [`Template/`](Template). It holds a runnable challenge template.

## Support

If you find the labs useful, consider giving the repository a **⭐ Star**.

More challenges and improvements are planned.

Happy Learning! 🚀