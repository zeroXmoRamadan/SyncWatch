# SyncWatch - Real-Time Synchronized Torrent & Local Video Player

[![Node.js](https://img.shields.io/badge/Node.js-18+-green)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.19-blue)](https://expressjs.com/)
[![WebTorrent](https://img.shields.io/badge/WebTorrent-1.9-red)](https://webtorrent.io/)
[![PeerJS](https://img.shields.io/badge/PeerJS-1.5-orange)](https://peerjs.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Overview

**SyncWatch** is a production-ready, peer-to-peer real-time synchronized video playback platform. It enables multiple users to watch videos in perfect synchronization (play, pause, seek) directly in their web browser, using either a BitTorrent magnet link or a synchronized local video file, without relying on a central media relay server.

### Key Features

- **Synchronized Playback (WebRTC)** — Real-time synchronization of play, pause, and seek events directly between members' browsers using PeerJS and WebRTC.
- **Dual Playback Modes** — Stream video files directly from the BitTorrent network while downloading, or sync a local video file (bypasses torrent streaming entirely with zero server overhead).
- **Auto-Stop Seeding (100% Download)** — The backend server automatically stops seeding and terminates peer connections as soon as the torrent download reaches 100%, shifting transparently to local disk streaming to conserve upload bandwidth.
- **P2P Subtitle Sharing** — Support for SRT and VTT subtitles uploaded by the host. SRT files are converted on-the-fly to WebVTT and broadcasted directly to all room members via PeerJS data streams.
- **Host Controls Protection** — The room creator has full administrative controls, including the ability to toggle playback permissions (allow/deny members from controlling playback) and chat permissions.
- **Cinematic Controls Overlay** — Custom glassmorphism buttons (Mute, Subtitles, Fullscreen) overlaying the video player that auto-fade after 2 seconds of mouse inactivity.
- **Fluid Subtitle Sizing** — Netflix-style custom translucent subtitle cues without dark bounding box backdrops, using 4-directional outline text shadows, scaling proportionally across any screen size.
- **Advanced WebRTC Traversal** — Configurable custom STUN/TURN servers (e.g. from Metered.ca or self-hosted COTURN) to traverse strict firewalls and symmetric NATs, saved locally in `localStorage`.

---

## Quick Start

### Prerequisites

- **Node.js** 18+ ([Download](https://nodejs.org/))
- **npm** 9+ (comes with Node.js)

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/zeroXmoRamadan/syncwatch.git
   cd syncwatch
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

   > 💡 **Note:** Keep the terminal window open while you use the app — closing it stops your local video streaming server.

---

## Project Structure

```
syncwatch/
├── README.md              # Project documentation
├── server.js              # Express video streaming & WebTorrent download server
├── package.json           # Dependencies and scripts
├── downloads/             # Directory where downloaded torrents are stored
└── public/
    ├── index.html         # User Interface layout and components
    ├── style.css          # Visual styling, glassmorphic themes, responsive grids
    └── app.js             # Client-side WebRTC signaling, player sync, and event handlers
```

---

## API Routes

The backend server exposes the following HTTP endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/torrent` | POST | Swaps current active torrent session with a new magnet link |
| `/api/torrent/status` | GET | Returns download progress, peer count, speed, and status |
| `/stream` | GET | Streams video files from active WebTorrent or local disk using range-requests |

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

**Built with ❤️ by SyncWatch developers.**
