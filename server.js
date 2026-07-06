const express = require('express');
const path = require('path');
const WebTorrent = require('webtorrent');
const fs = require('fs');

const app = express();
const client = new WebTorrent();

const PORT = process.env.PORT || 4173;

let currentTorrent = null; // the active torrent for this local instance
let currentFile = null;    // the chosen video file inside it
let completedFile = null;   // metadata for the completed file on disk
const VIDEO_EXT = ['.mp4', '.webm', '.mov', '.m4v'];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Add / switch to a new torrent by magnet link or .torrent URL
app.post('/api/torrent', (req, res) => {
  const { magnet } = req.body || {};
  if (!magnet || typeof magnet !== 'string') {
    return res.status(400).json({ error: 'Missing magnet link' });
  }

  const startNewTorrent = () => {
    completedFile = null;
    client.add(magnet, { path: path.join(__dirname, 'downloads') }, (torrent) => {
      currentTorrent = torrent;
      currentFile = torrent.files
        .slice()
        .sort((a, b) => b.length - a.length)
        .find((f) => VIDEO_EXT.some((ext) => f.name.toLowerCase().endsWith(ext)));

      if (!currentFile) {
        return res.status(422).json({ error: 'No playable video file found in this torrent' });
      }

      // Deprioritize everything except the file we're playing
      torrent.files.forEach((f) => { if (f !== currentFile) f.deselect(); });
      currentFile.select();

      torrent.on('done', () => {
        console.log('Torrent download complete. Stopping torrent seeding...');
        completedFile = {
          name: currentFile.name,
          length: currentFile.length,
          localPath: path.join(torrent.path, currentFile.path)
        };
        client.remove(torrent.infoHash, { destroyStore: false }, () => {
          currentTorrent = null;
          currentFile = null;
          console.log('WebTorrent client seeding stopped. Streaming source shifted to disk:', completedFile.localPath);
        });
      });

      res.json({
        ok: true,
        name: currentFile.name,
        size: currentFile.length,
        infoHash: torrent.infoHash,
      });
    });
  };

  if (currentTorrent) {
    client.remove(currentTorrent.infoHash, { destroyStore: false }, () => {
      currentTorrent = null;
      currentFile = null;
      completedFile = null;
      startNewTorrent();
    });
  } else {
    completedFile = null;
    startNewTorrent();
  }
});

app.get('/api/torrent/status', (req, res) => {
  if (completedFile) {
    return res.json({
      active: true,
      name: completedFile.name,
      progress: 1,
      downloadSpeed: 0,
      numPeers: 0,
      ready: true,
    });
  }
  if (!currentTorrent || !currentFile) return res.json({ active: false });
  res.json({
    active: true,
    name: currentFile.name,
    progress: currentTorrent.progress,
    downloadSpeed: currentTorrent.downloadSpeed,
    numPeers: currentTorrent.numPeers,
    ready: currentTorrent.progress > 0,
  });
});

// Range-request video streaming so <video> seeking works
app.get('/stream', (req, res) => {
  const activeFile = completedFile || currentFile;
  if (!activeFile) return res.status(404).send('No active torrent');

  const range = req.headers.range;
  const fileSize = activeFile.length;

  const ext = activeFile.name.toLowerCase();
  const mime = ext.endsWith('.webm') || ext.endsWith('.mkv') ? 'video/webm'
    : 'video/mp4';

  const createStream = (options) => {
    if (completedFile) {
      return fs.createReadStream(completedFile.localPath, options);
    } else {
      return currentFile.createReadStream(options);
    }
  };

  if (!range) {
    res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': mime });
    const stream = createStream();
    
    stream.on('error', (err) => {
      console.error('Stream error:', err.message);
    });
    
    res.on('close', () => {
      stream.destroy();
    });

    stream.pipe(res);
    return;
  }

  const parts = range.replace(/bytes=/, '').split('-');
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
  const chunkSize = end - start + 1;

  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': chunkSize,
    'Content-Type': mime,
  });

  const stream = createStream({ start, end });
  
  stream.on('error', (err) => {
    console.error('Stream error:', err.message);
  });
  
  res.on('close', () => {
    stream.destroy();
  });

  stream.pipe(res);
});

app.listen(PORT, () => {
  console.log(`\nSyncWatch is running: http://localhost:${PORT}\n`);
});
