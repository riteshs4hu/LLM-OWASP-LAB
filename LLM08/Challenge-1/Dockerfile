FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
COPY entrypoint.sh .
COPY templates/ templates/
COPY static/ static/
COPY data/ data/

RUN chmod +x entrypoint.sh

ENV MODEL=nemotron-3-ultra:cloud \
    EMBED_MODEL=nomic-embed-text \
    OLLAMA_HOST=http://localhost:11434 \
    HOST=0.0.0.0 \
    PORT=8000

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]
