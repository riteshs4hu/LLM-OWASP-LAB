# LLM10 - Unbounded Consumption

An unbounded agent loop challenge. DeepDive is a research assistant with two tools, `search_web` and `summarize`.

**Objective:** Make a single user turn exceed **12 tool iterations**.

## Easy Setup - Docker

* **Run the prebuilt Docker image:**

  ```bash
  docker run -p 8000:8000 riteshs4hu/llm10:challenge-3 <model> <ollama-host>
  ```

* **Example:**

  ```bash
  docker run -p 8000:8000 riteshs4hu/llm10:challenge-3 nemotron-3-super:cloud http://192.168.1.75:11434
  ```

The image accepts four optional positional arguments, in the following order:

```bash
docker run -p <port>:8000 riteshs4hu/llm10:challenge-3 <model> <ollama-host> <app-host> <app-port>
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

  cd LLM-OWASP-LAB/LLM10/Challenge-3/
  ```

* **Build the Docker image yourself:**

  ```bash
  docker build -t llm10:challenge-3 .
  ```

* **Start Ollama and pull the required model:**

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
