# YT-Audio: High-Quality YouTube Audio Downloader

A lightweight, modern web application to download and stream high-quality (320kbps) MP3 audio from YouTube URLs.

## 🚀 Features
- **320kbps MP3**: Highest quality audio extraction using `yt-dlp` and `ffmpeg`.
- **Sleek Web UI**: Glassmorphism design with real-time download progress.
- **Instant Preview**: Fetches video title and thumbnail automatically.
- **Auto-Cleanup**: Temporary files are deleted immediately after download.

## 🐳 Quick Start

Run the container using:
```bash
docker run -d -p 8000:8000 --name yt-audio sakhund/yt-audio
```

Then visit `http://localhost:8000` in your browser.

## 🔧 Environment Variables
The application runs on port `8000` by default. No additional configuration is required.

## 📄 License
MIT License
