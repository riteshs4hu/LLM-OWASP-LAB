# LLM04 - Data and Model Poisoning

Nimbus Software's internal knowledge base answers employee questions about company policy by retrieving matching passages from indexed documents, providing them to the model as context, and showing which document the answer came from. It ships with four approved documents — `refund-policy.txt`, `employee-handbook.txt`, `password-policy.pdf`, and `vpn-guide.pdf`.

**Objective:** Get the assistant to answer a policy question using a document that contradicts the approved policy and cite that document as its source.

Documents are managed through the admin console at `/admin`, which uses the lab-provided credentials `admin` / `RAGAdmin@123`. These credentials are intentionally provided and are not part of the vulnerability being tested. Uploads and deletions do not affect answers until the manual **Update RAG** button is pressed, which chunks all documents, regenerates embeddings, and rebuilds the vector index.

## Easy Setup - Docker

* **Run the prebuilt Docker image:**

  ```bash
  docker run -p 8000:8000 -e MODEL=<model> -e OLLAMA_HOST=<ollama-host> -e EMBED_MODEL=<embed-model> riteshs4hu/llm04:challenge-1
  ```

* **Example:**

  ```bash
  docker run -p 8000:8000 -e MODEL=nemotron-3-super:cloud -e OLLAMA_HOST=http://192.168.1.75:11434 -e EMBED_MODEL=nomic-embed-text:latest riteshs4hu/llm04:challenge-1
  ```

The image accepts five optional positional arguments, in the following order:

```bash
docker run -p <port>:8000 riteshs4hu/llm04:challenge-1 <model> <ollama-host> <app-host> <app-port> <embed-model>
```

| Position | Meaning     | Default                  |
| -------- | ----------- | ------------------------ |
| 1        | model       | `nemotron-3-ultra:cloud` |
| 2        | ollama-host | `http://localhost:11434` |
| 3        | app-host    | `0.0.0.0`                |
| 4        | app-port    | `8000`                   |
| 5        | embed-model | `nomic-embed-text`       |

## Manual Setup and Deployment

Requires Python 3.10+ and [Ollama](https://ollama.com) with a chat model and embedding model. The `data/` directory containing the four seed documents must be located next to `app.py`. You can override its location using the `DATA_DIR` environment variable.

* **Clone the repository:**

  ```bash
  git clone https://github.com/riteshs4hu/LLM-OWASP-LAB.git

  cd LLM-OWASP-LAB/LLM04/Challenge-1/
  ```

* **Build the Docker image yourself:**

  ```bash
  docker build -t llm04:challenge-1 .
  ```

* **Start Ollama and pull the required models:**

  ```bash
  ollama serve

  ollama pull nemotron-3-ultra:cloud

  ollama pull nomic-embed-text
  ```

* **Install the required libraries and start the lab:**

  ```bash
  pip install -r requirements.txt

  python app.py
  ```

  The application binds to `0.0.0.0:8000` by default. Open http://localhost:8000 in your browser.

* **Override the model, embedding model, Ollama host, bind address, or port using environment variables:**

  ```bash
  MODEL=llama3.1 EMBED_MODEL=bge-m3 OLLAMA_HOST=http://your-host:11434 HOST=0.0.0.0 PORT=5000 python app.py
  ```
