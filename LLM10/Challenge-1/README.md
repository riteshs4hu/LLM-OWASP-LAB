# LLM10 - Unbounded Consumption

A rate limiting and quota challenge. Nimbus Assistant is the free chat assistant on a software company's public website. It requires no login or account and has no tools; it simply answers user questions.

**Objective:** Get the service to answer more than **30 requests within a 60-second window** without a single request being refused.

## Easy Setup - Docker

* **Run the prebuilt Docker image:**

  ```bash
  docker run -p 8000:8000 riteshs4hu/llm10:challenge-1 <model> <ollama-host>
  ```

* **Example:**

  ```bash
  docker run -p 8000:8000 riteshs4hu/llm10:challenge-1 qwen2.5:latest http://192.168.1.75:11434
  ```

The image accepts four optional positional arguments, in the following order:

```bash
docker run -p <port>:8000 riteshs4hu/llm10:challenge-1 <model> <ollama-host> <app-host> <app-port>
```

| Position | Meaning     | Default                  |
| -------- | ----------- | ------------------------ |
| 1        | model       | `qwen2.5:latest`         |
| 2        | ollama-host | `http://localhost:11434` |
| 3        | app-host    | `0.0.0.0`                |
| 4        | app-port    | `8000`                   |

## Manual Setup and Deployment

Requires Python 3.10+ and [Ollama](https://ollama.com) with any chat model. It defaults to `qwen2.5:latest` because a small, fast local model makes the exercise much quicker than a cloud model.

* **Clone the repository:**

  ```bash
  git clone https://github.com/riteshs4hu/LLM-OWASP-LAB.git

  cd LLM-OWASP-LAB/LLM10/Challenge-1/
  ```

* **Build the Docker image yourself:**

  ```bash
  docker build -t llm10:challenge-1 .
  ```

* **Start Ollama and pull the required model:**

  ```bash
  ollama serve

  ollama pull qwen2.5:latest
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
