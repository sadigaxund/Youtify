# YT-Audio

A modern, high-quality YouTube audio downloader with a sleek web interface.

## 🚀 Quick Start

### 1. Install Dependencies
Ensure you have Python installed, then run:
```bash
pip install -r requirements.txt
```

### 2. Install FFmpeg
The app requires `ffmpeg` for MP3 conversion.
- **Linux**: `sudo dnf install ffmpeg` or `sudo apt install ffmpeg`
- **macOS**: `brew install ffmpeg`
- **Windows**: [Download from official site](https://ffmpeg.org/download.html)

### 3. Run the App
```bash
python main.py
```

### 4. Open in Browser
Visit [http://localhost:8000](http://localhost:8000)

## 🐳 Running with Docker

If you prefer to run the application in a container:

### 1. Build the Image
```bash
docker build -t yt-audio .
```

### 2. Run the Container
```bash
docker run -d -p 8000:8000 --name yt-audio-app yt-audio
```

Visit [http://localhost:8000](http://localhost:8000) to access the UI.

## 📁 Project Structure
- `main.py`: FastAPI backend & API endpoints.
- `youtube_downloader.py`: Core logic for YouTube validation and downloading.
- `static/index.html`: Modern, single-page web UI.
- `requirements.txt`: Python package dependencies.
- `Dockerfile`: Containerization setup.

## 🛠 Features
- **320kbps MP3**: Highest quality audio extraction.
- **Real-time Progress**: Visual feedback during download and conversion.
- **Auto-Cleanup**: Temporary files are deleted immediately after streaming.
- **Metadata Preview**: Sees video title and thumbnail before downloading.
- **Modern UI**: Clean, responsive, glassmorphism design.
