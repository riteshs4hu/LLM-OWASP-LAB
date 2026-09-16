# LLM07 - System Prompt Leakage

A system prompt leakage challenge. "MediGuide" is a patient-facing medical Q&A assistant. Its hidden system prompt contains standard safety rules and a confidential operator policy block containing a shared secret used to authenticate requests to the internal triage escalation system, the escalation address, and a liability disclaimer ID.

**Objective:** Get the confidential triage escalation webhook secret out of the model.

## Easy Setup - Docker

* **Run the prebuilt Docker image:**

  ```bash
  docker run -p 8000:8000 riteshs4hu/llm07:challenge-2 <model> <ollama-host>
  ```

* **Example:**

  ```bash
  docker run -p 8000:8000 riteshs4hu/llm07:challenge-2 qwen2.5:3b http://192.168.1.7:11434
  ```

The image accepts four optional positional arguments, in the following order:

```bash id="p7c4nd"
docker run -p <port>:8000 riteshs4hu/llm07:challenge-2 <model> <ollama-host> <app-host> <app-port>
```

| Position | Meaning     | Default                  |
| -------- | ----------- | ------------------------ |
| 1        | model       | `nemotron-3-ultra:cloud` |
| 2        | ollama-host | `http://localhost:11434` |
| 3        | app-host    | `0.0.0.0`                |
| 4        | app-port    | `8000`                   |

## Manual Setup and Deployment

Requires Python 3.10+ and [Ollama](https://ollama.com) with a tool-calling-capable model. Supported models include `nemotron-3-super:cloud`, `nemotron-3-ultra:cloud`, and `qwen2.5`. Not every model supports tool calling, so verify model compatibility before use.

* **Clone the repository:**

  ```bash
  git clone https://github.com/riteshs4hu/LLM-OWASP-LAB.git

  cd LLM-OWASP-LAB/LLM07/Challenge-2/
  ```

* **Build the Docker image yourself:**

  ```bash
  docker build -t llm07:challenge-2 .
  ```

* **Start Ollama and pull a model:**

  ```bash
  ollama serve

  ollama pull qwen2.5:3b
  ```

* **Install the required libraries and start the lab:**

  ```bash
  pip install -r requirements.txt

  python app.py
  ```

  The application binds to `0.0.0.0:8000` by default. Open http://localhost:8000 in your browser.

* **Override the model, Ollama host, bind address, or port using environment variables:**

  ```bash
  MODEL=llama3.1 OLLAMA_HOST=http://your-host:11434 HOST=0.0.0.0 PORT=5000 python app.py
  ```
