
# Youtify

A modern, web-based tool for downloading high-quality audio from YouTube with advanced processing features.


[![IMAGE ALT TEXT HERE](https://img.youtube.com/vi/C3CCQu8Uuhc/0.jpg)](https://www.youtube.com/watch?v=C3CCQu8Uuhc)



## Features

- **High Quality Audio**: Downloads best audio stream and converts to MP3 (default 320kbps via pydub export).
- **Audio Processing Pipeline**: Normalize, EQ, Silence Trim, Stereo Enhance.
- **Metadata Editor**: Auto-fetches cover art, title, artist. Supports custom tags.
- **Configurable Delimiter**: Choose your separator for multiple artists/genres (e.g., `,`, `|`, `;`).
- **Docker Support**: Runs as a non-root user with PUID/PGID mapping for correct file permissions.
- **Two Modalities**:
  - **Browser Download**: Process and download directly to your device.
  - **Server Save**: Mount a volume and save files directly to your server (e.g., for Jellyfin/Nextcloud).

## Installation

### Option 1: Run with Python

1. **Install Prerequisites**
   Ensure you have Python 3.11+ and FFmpeg installed:
   ```bash
   # Linux (Ubuntu/Debian)
   sudo apt install ffmpeg python3-pip
   # Linux (Fedora)
   sudo dnf install ffmpeg python3-pip

   # macOS
   brew install ffmpeg
   ```

2. **Install Dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Run the App**
   ```bash
   python main.py
   ```

   **Options:**
   - `--save-dir "/path/to/downloads"`: Save files to a specific directory on the server.
   - `SAVE_DIRECTORY="/path"`: Alternative using environment variables.

   *Example:*
   ```bash
   # Run with a save directory
   python main.py --save-dir ~/Music/Youtify
   ```
   *Note: If no directory is set, the app defaults to **Browser Download Mode**.*

   The server will start at `http://localhost:8000`.

### Option 2: Build & Run with Docker

Build the image:
```bash
docker build -t youtify .
```

Run the container (Server Save Mode):
```bash
# Replace /path/to/music with your host's music directory
# PUID/PGID ensures files are owned by your user, not root
docker run -d \
  --name youtify \
  -p 8000:8000 \
  -v /path/to/music:/music \
  -e SAVE_DIRECTORY=/music \
  -e PUID=$(id -u) \
  -e PGID=$(id -g) \
  youtify
```

Run the container (Browser Mode):
```bash
docker run -d \
  --name youtify \
  -p 8000:8000 \
  youtify
```

Access the UI at `http://localhost:8000`.
