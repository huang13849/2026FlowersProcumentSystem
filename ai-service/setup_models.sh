#!/bin/bash
# Wait for ollama to be ready, then pull models

echo "Waiting for Ollama to start..."
for i in $(seq 1 30); do
  if curl -s http://localhost:11434/api/tags >/dev/null 2>&1; then
    echo "Ollama is ready!"
    break
  fi
  echo "  attempt $i/30..."
  sleep 10
done

if ! curl -s http://localhost:11434/api/tags >/dev/null 2>&1; then
  echo "Ollama did not start within 5 minutes"
  exit 1
fi

echo "Pulling text model: qwen2.5:7b..."
ollama pull qwen2.5:7b
echo "Text model ready"

echo "Pulling vision model: llava:7b..."
ollama pull llava:7b
echo "Vision model ready"

echo "All models ready!"
