# SyncWatch — Real-Time Synchronized Torrent & Local Video Player

![SyncWatch Banner](public/SyncWatch-banner.jpg)

[![Node.js](https://img.shields.io/badge/Node.js-18+-green)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.19-blue)](https://expressjs.com/)
[![WebTorrent](https://img.shields.io/badge/WebTorrent-1.9-red)](https://webtorrent.io/)
[![PeerJS](https://img.shields.io/badge/PeerJS-1.5-orange)](https://peerjs.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Overview

**SyncWatch** is a production-ready, peer-to-peer real-time synchronized video playback platform. It enables multiple users to watch videos in perfect frame-accurate synchronization (play, pause, seek) directly in their web browser, using either a BitTorrent magnet link or a synchronized local video file, without relying on a central media relay server.

---

## Key Features

- **Synchronized Playback (WebRTC)** — Real-time frame-accurate synchronization of play, pause, and seek events directly between members' browsers using PeerJS and WebRTC data channels.
- **Custom-Themed UI Controls** — Modern dark-glass controls for Playback Source selection (interactive cards on landing, segmented toggle in room), Max Members custom dropdown popover with group capacity tags (`Duo`, `Small Group`, `Max Default`), and themed Audio Track cards with active status badges.
- **Dual Playback Modes** — Stream video files directly from the BitTorrent network while downloading, or sync a local video file (bypasses torrent streaming entirely with zero server overhead).
- **Playback Retention on Source Toggle** — Toggling source modes in the sidebar updates input options without interrupting active video playback. Video playback only reloads when a new torrent magnet is loaded or a new file is chosen.
- **Multi-Track Audio Support (Torrent & Local)** — Detects and renders multi-track audio options for both local video files and WebTorrent streams inside Host Controls. Selections are broadcasted in real time to all room members.
- **3-Panel Centered Room Layout** — Modern 3-column obsidian interface featuring a left-side Room Chat (`310px`), a centered Video Stage, and a right-side Sidebar (`320px`) for Members & Host Controls.
- **Inactivity Controls & Cursor Auto-Hide** — Floating player controls (Subtitles toggle, Mute, Fullscreen) and mouse cursor automatically fade out after 2.5 seconds of mouse inactivity.
- **Multilingual Refresh Protection & Admin Disconnect** — Intercepts `F5` / `Ctrl+R` / `Cmd+R` refresh shortcuts across all keyboard languages (English, Arabic, Cyrillic, etc.) using physical key codes, provides a custom themed "Leave Room" confirmation modal, and automatically disconnects all guests with a "Room Closed" dialog if the host leaves.
- **P2P Subtitle Sharing & Joining Member Sync** — Supports `.srt` and `.vtt` subtitle files uploaded by the host. Subtitles and elapsed video time are automatically synchronized for members joining ongoing rooms.
- **Auto-Stop Seeding (100% Download)** — The backend server automatically stops seeding and terminates peer connections as soon as a torrent download reaches 100%, shifting transparently to local disk streaming to conserve upload bandwidth.
- **Advanced WebRTC Traversal & Z-Index Layering** — Configurable custom STUN/TURN servers (e.g. from Metered.ca or self-hosted COTURN) to traverse strict firewalls and symmetric NATs, saved locally in `localStorage`. Elevated dropdown popovers float cleanly over the WebRTC accordion.

---

## Quick Start

### Prerequisites

- **Node.js** 18+ ([Download](https://nodejs.org/))
- **npm** 9+ (comes with Node.js)

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/zeroXmoRamadan/SyncWatch.git
   cd SyncWatch
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Start the application**

   ```bash
   npm start
   ```

   The app runs on: `http://localhost:4173`

   > 💡 **Note:** Keep the terminal window open while watching — closing it stops your local video streaming server.

   > ⚠️ **Audio Track Switching:** The `audioTracks` API is natively supported in Safari. In Chrome/Edge, enable `chrome://flags/#enable-experimental-web-platform-features`. In non-supporting browsers, the audio track panel hides gracefully.

---

## Project Structure

```
SyncWatch/
├── README.md              # Project documentation (Markdown)
├── README.txt             # Plain text run instructions
├── server.js              # Express video streaming & WebTorrent download server
├── package.json           # Dependencies and scripts
├── downloads/             # Directory where downloaded torrents are stored
└── public/
    ├── favicon.ico        # High-resolution ICO favicon
    ├── favicon.png        # PNG icon asset & header logo image
    ├── SyncWatch-logo-icon.png  # Brand logo source image
    ├── SyncWatch-banner.jpg  # Banner image for GitHub repo.
    ├── index.html         # User Interface 3-panel layout and modal dialogs
    ├── style.css          # Visual styling, glassmorphic obsidian theme, responsive layout
    └── app.js             # WebRTC signaling, custom controls, player sync, and refresh protection
```

---

## API Routes

The backend server exposes the following HTTP endpoints:

| Endpoint | Method | Description |
| ---------- | -------- | ------------- |
| `/api/torrent` | POST | Swaps current active torrent session with a new magnet link |
| `/api/torrent/status` | GET | Returns download progress, peer count, speed, and status |
| `/stream` | GET | Streams video files from active WebTorrent or local disk using HTTP range-requests |

---

## WebRTC Settings & NAT Traversal

Direct browser-to-browser connections rely on NAT Traversal.

- **STUN**: Used to find public IP addresses. SyncWatch uses Google's public STUN servers by default, which works on standard home routers.
- **TURN**: Relays connection traffic when STUN hole punching fails (common on symmetric NATs, mobile hotspots, corporate networks).
- You can configure custom TURN servers (like [Metered.ca](https://www.metered.ca/)) in the **Advanced WebRTC Settings** panel at the bottom of the landing page:

```json
[
  {
    "urls": "stun:stun.relay.metered.ca:80"
  },
  {
    "urls": "turn:global.relay.metered.ca:80",
    "username": "your-username",
    "credential": "your-password"
  }
]
```

---

## License

MIT License — Open source and free to use.

---

**Built with ❤️ by Mohamed Ramadan.**
