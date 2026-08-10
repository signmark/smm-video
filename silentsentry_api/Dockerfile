FROM python:3.11-slim

# Install ffmpeg
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install FastAPI, Uvicorn, Numpy, Multipart
RUN pip install --no-cache-dir fastapi uvicorn numpy python-multipart

# Copy the engine and web application
COPY silentsentry.py /app/silentsentry.py
COPY app.py /app/app.py

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
