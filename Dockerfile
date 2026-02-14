# Use an official Python runtime as a parent image
FROM python:3.13-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# User/Group ID for running the app (match your host volume owner)
ENV PUID=568
ENV PGID=568

# Optional: Set to a path inside the container to save files server-side
# If unset, files are streamed directly to the browser
# ENV SAVE_DIRECTORY=/music

# Set the working directory in the container
WORKDIR /app

# Install system dependencies
# ffmpeg for audio, gosu for privilege dropping, gcc/python3-dev for C extensions (audioop-lts)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    gosu \
    gcc \
    python3-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install -r requirements.txt

# Copy entrypoint script and set permissions
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on
EXPOSE 8000

# Use entrypoint to handle user setup at runtime
ENTRYPOINT ["/entrypoint.sh"]

# Command to run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]