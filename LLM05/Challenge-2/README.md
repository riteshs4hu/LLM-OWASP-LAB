# LLM05 - Improper Output Handling

An "AI support assistant" chat widget displays the assistant's responses directly in the chat window without properly handling potentially unsafe content.

**Objective:** Get a payload into an assistant reply, click it in the chat window, and observe it execute in the browser.

## Easy Setup - Docker

* **Run the prebuilt Docker image:**

  ```bash
  docker run -d -p 8000:8000 riteshs4hu/llm05:challenge-2 <model> <ollama-host>
  ```

* **Example:**

  ```bash
  docker run -p 8000:8000 riteshs4hu/llm05:challenge-2 nemotron-3-ultra:cloud http://192.168.1.7:11434
  ```

The image accepts four optional positional arguments, in the following order:

```bash id="v3g7zn"
docker run -p <port>:8000 riteshs4hu/llm05:challenge-2 <model> <ollama-host> <app-host> <app-port>
```

| Position | Meaning     | Default                  |
| -------- | ----------- | ------------------------ |
| 1        | model       | `nemotron-3-ultra:cloud` |
| 2        | ollama-host | `http://localhost:11434` |
| 3        | app-host    | `0.0.0.0`                |
| 4        | app-port    | `8000`                   |

## Manual Setup and Deployment

Requires Python 3.10+ and [Ollama](https://ollama.com) with any chat model. Tool calling is not required. Supported models include `nemotron-3-ultra:cloud`, `llama3.1`, `qwen2.5`, and `mistral-nemo`.

* **Clone the repository:**

  ```bash
  git clone https://github.com/riteshs4hu/LLM-OWASP-LAB.git

  cd LLM-OWASP-LAB/LLM05/Challenge-2/
  ```

* **Build the Docker image yourself:**

  ```bash
  docker build -t llm05:challenge-2 .
  ```

* **Start Ollama and pull a model:**

  ```bash
  ollama serve

  ollama pull nemotron-3-ultra:cloud
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
