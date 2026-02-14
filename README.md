
# Youtify

A modern, web-based tool for downloading high-quality audio from YouTube with advanced processing features.

## Features

- **High Quality Audio**: Downloads best audio stream and converts to MP3 (default 320kbps via pydub export).
- **Audio Processing Pipeline**: Normalize, EQ, Silence Trim, Stereo Enhance.
- **Metadata Editor**: Auto-fetches cover art, title, artist. Supports custom tags.
- **Configurable Delimiter**: Choose your separator for multiple artists/genres (e.g., `,`, `|`, `;`).
- **Docker Support**: Runs as a non-root user with PUID/PGID mapping for correct file permissions.
- **Two Modalities**:
  - **Browser Download**: Process and download directly to your device.
  - **Server Save**: Mount a volume and save files directly to your server (e.g., for Jellyfin/Nextcloud).

## Build & Run with Docker

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
