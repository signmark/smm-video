FROM python:3.11-slim
WORKDIR /app
COPY app.py .
COPY templates/ templates/
RUN pip install --no-cache-dir fastapi uvicorn psycopg2-binary docker
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
