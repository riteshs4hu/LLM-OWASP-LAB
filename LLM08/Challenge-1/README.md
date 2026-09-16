# LLM08 - Vector and Embedding Weaknesses

A multi-tenant RAG assistant is shared by two organisations — Tenant A, Northwind Systems, and Tenant B, Vertex Retail. Each tenant has its own users and documents, and the admin console correctly scopes document management. However, all tenant documents are embedded into a shared vector store. When a user asks a question, it is embedded and compared against all documents, the top three chunks are added to the prompt, and the tenant associated with each chunk is not used as a query filter.

**Objective:** Determine whether a user signed in to one tenant can get the assistant to retrieve and expose a document belonging to the other tenant.

Lab credentials are provided and are not part of the vulnerability being tested. Guessing credentials is not the objective.

Tenant users are available at `/login`:

```text
alice / TenantA@123     Tenant A - Northwind Systems
bob   / TenantB@123     Tenant B - Vertex Retail
```

Tenant administration is available at `/admin`:

```text
admin / RAGAdmin@123
```

## Easy Setup - Docker

* **Run the prebuilt Docker image:**

  ```bash
  docker run -p 8000:8000 -e MODEL=<model> -e OLLAMA_HOST=<ollama-host> -e EMBED_MODEL=<embed-model> riteshs4hu/llm08:challenge-1
  ```

* **Example:**

  ```bash
  docker run -p 8000:8000 -e MODEL=nemotron-3-super:cloud -e OLLAMA_HOST=http://192.168.1.75:11434 -e EMBED_MODEL=nomic-embed-text:latest riteshs4hu/llm08:challenge-1
  ```

The image accepts five optional positional arguments, in the following order:

```bash
docker run -p <port>:8000 riteshs4hu/llm08:challenge-1 <model> <ollama-host> <app-host> <app-port> <embed-model>
```

| Position | Meaning     | Default                  |
| -------- | ----------- | ------------------------ |
| 1        | model       | `nemotron-3-ultra:cloud` |
| 2        | ollama-host | `http://localhost:11434` |
| 3        | app-host    | `0.0.0.0`                |
| 4        | app-port    | `8000`                   |
| 5        | embed-model | `nomic-embed-text`       |

## Manual Setup and Deployment

Requires Python 3.10+ and [Ollama](https://ollama.com) with any chat model. Tool calling is not required. The `nomic-embed-text` model is recommended for embeddings. If it is unavailable, the application falls back to an in-process TF-IDF vectorizer, displays the fallback status in the sidebar, and continues to work.

* **Clone the repository:**

  ```bash
  git clone https://github.com/riteshs4hu/LLM-OWASP-LAB.git

  cd LLM-OWASP-LAB/LLM08/Challenge-1/
  ```

* **Build the Docker image yourself:**

  ```bash
  docker build -t llm08:challenge-1 .
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
