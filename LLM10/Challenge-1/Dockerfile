FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
COPY entrypoint.sh .
COPY templates/ templates/
COPY static/ static/

RUN chmod +x entrypoint.sh

ENV MODEL=qwen2.5:latest \
    OLLAMA_HOST=http://localhost:11434 \
    HOST=0.0.0.0 \
    PORT=8000

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]
