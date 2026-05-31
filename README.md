
<img width="1590" height="878" alt="image" src="https://github.com/user-attachments/assets/c454b82a-764f-4a34-bc12-95b2d42a25de" />



# Youtify

A modern, web-based tool for downloading high-quality audio from YouTube with advanced processing features.


<img width="1218" height="1399" alt="image" src="https://github.com/user-attachments/assets/b8a1806b-53cc-4e0c-9c82-b9de0ce380be" />


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

### Option 3: Chrome Extension

A Chrome extension is included that lets you download audio directly from any YouTube video page. It connects to the backend running on your machine.

#### 1. Start the Backend

The extension requires the backend server to be running. Start it using **any** of the methods above (Python or Docker):

```bash
# Simplest — browser download mode
python main.py

# Or with a save directory
python main.py --save-dir ~/Music/Youtify
```

The server must be accessible at `http://localhost:8000`.

#### 2. Load the Extension in Chrome

1. Open `chrome://extensions/` in your browser.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the `extensions/chrome/` directory from this project.

The Youtify icon will appear in your Chrome toolbar.

#### 3. Usage

1. Navigate to any YouTube video (e.g. `https://www.youtube.com/watch?v=...`).
2. Click the **Youtify extension icon** in your toolbar.
3. The popup **automatically captures the video URL** and triggers a search.
4. Adjust audio effects, edit metadata, set time range — all the same features as the web UI.
5. Click **Download** to save the MP3 to your browser's download folder.

> **Note:** A green dot in the popup header indicates the backend is connected. If it's red, make sure the server is running.
