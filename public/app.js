(() => {
  const $ = (id) => document.getElementById(id);
  console.log('SyncWatch client initialized.');

  // ---------- State ----------
  let peer = null;
  let isHost = false;
  let roomCode = '';
  let roomPassword = '';
  let maxMembers = 8;
  let myName = '';
  let myId = 'host'; // 'host' for the host, PeerJS-assigned id for members
  const conns = new Map();     // peerId -> DataConnection (host: all members; member: just host)
  const members = new Map();   // peerId -> { name, isHost, canControl, canChat }
  let applyingRemote = false;  // guards against echoing our own remote-applied actions
  let activeSubtitles = null;  // stores active subtitle object { text, name }
  let playbackMode = 'torrent'; // 'torrent' or 'local'
  let localVideoFile = null;    // local File object selected
  let expectedFileName = '';    // expected filename of the sync session
  let lastApprovedState = { paused: true, time: 0, timestamp: Date.now() };
  let selectedAudioTrackIndex = 0; // host's selected audio track index
  let hostAudioTrackIndex = null;   // host's audio track index on member clients
  let initialSyncPending = true;    // flag set when member joins or loads a new source
  let isFullscreenActive = false;

  const player = $('player');
  const overlay = $('videoOverlay');
  const overlayText = $('overlayText');

  const code = () =>
    Array.from({ length: 6 }, () => '23456789ABCDEFGHJKMNPQRSTUVWXYZ'[Math.floor(Math.random() * 31)]).join('');

  const fmtTime = (t) => {
    t = Math.max(0, Math.floor(t || 0));
    const m = Math.floor(t / 60), s = t % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const me = () => members.get(myId) || { canControl: true, canChat: true, isHost };

  function getIceServers() {
    const saved = localStorage.getItem('sw_ice_servers');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {
        console.error('Failed to parse saved ICE servers:', e);
      }
    }
    return [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' }
    ];
  }

  // ---------- Screens ----------
  function showRoomScreen() {
    $('landing').hidden = true;
    $('room').hidden = false;
    $('peerBadge').hidden = false;
    $('myPeerIdShort').textContent = roomCode;
    $('hostControls').hidden = !isHost;
    $('permHint').hidden = !isHost;

    // Sync sidebar source controls with current playbackMode
    const hostSourceSegment = $('hostSourceSegment');
    if (hostSourceSegment) {
      hostSourceSegment.querySelectorAll('.segment-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.value === playbackMode);
      });
    }
    if ($('hostSourceSelect')) {
      $('hostSourceSelect').value = playbackMode;
      const isLocal = playbackMode === 'local';
      $('hostTorrentWrapper').hidden = isLocal;
      $('hostLocalWrapper').hidden = !isLocal;
    }

    if (!isHost) {
      hideTrackSelection();
    }
  }

  // ---------- Local torrent server ----------
  async function loadTorrentLocally(magnet) {
    playbackMode = 'torrent';
    overlay.hidden = false;
    overlayText.textContent = 'Fetching the torrent…';
    $('torrentStatus').textContent = 'Loading torrent…';
    setTrack(null);
    activeSubtitles = null;
    hideTrackSelection();
    console.log('Requesting local server to load torrent...');
    try {
      const res = await fetch('/api/torrent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ magnet }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error('Failed to load torrent:', data.error);
        overlayText.textContent = data.error || 'Could not load this torrent.';
        return;
      }
      console.log('Torrent loaded successfully! Setting video player stream source.');
      player.src = '/stream';

      const checkTracks = () => {
        if (isHost) {
          detectAndPopulateTracks();
        }
      };
      if (player.readyState >= 1) {
        checkTracks();
      }
      player.addEventListener('loadedmetadata', checkTracks, { once: true });

      startStatusPoll();
    } catch (e) {
      console.error('Connection to local server failed:', e);
      overlayText.textContent = 'Local server not reachable. Is the app still running?';
    }
  }

  // ---------- Subtitle handling ----------
  function srtToVtt(srtText) {
    let vtt = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!vtt.startsWith('WEBVTT')) {
      vtt = 'WEBVTT\n\n' + vtt;
    }
    // Replace HH:MM:SS,mmm with HH:MM:SS.mmm
    vtt = vtt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    return vtt;
  }

  function setTrack(vttContent, fileName) {
    $('customSubtitlesBtn').textContent = vttContent ? 'Hide Subs' : 'No Subs';
    let oldTrack = player.querySelector('track');
    if (oldTrack) oldTrack.remove();
    
    if (player._subUrl) {
      URL.revokeObjectURL(player._subUrl);
      player._subUrl = null;
    }

    if (isHost) {
      $('subFileName').textContent = fileName || 'No subtitle file loaded';
    }

    if (!vttContent) return;

    const blob = new Blob([vttContent], { type: 'text/vtt' });
    const url = URL.createObjectURL(blob);
    player._subUrl = url;

    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = fileName ? fileName.replace(/\.[^/.]+$/, "") : 'Subtitles';
    track.srclang = 'en';
    track.src = url;
    track.default = true;

    player.appendChild(track);

    const enableTrack = () => {
      try {
        for (let i = 0; i < player.textTracks.length; i++) {
          player.textTracks[i].mode = 'showing';
          player.textTracks[i]._syncwatchExternal = true;
        }
      } catch (e) {}
    };

    enableTrack();
    track.addEventListener('load', enableTrack);
    setTimeout(enableTrack, 100);
    setTimeout(enableTrack, 500);
  }

  function saveHostState(state) {
    if (!state) return;
    let targetTime = state.time || 0;
    if (!state.paused && state.timestamp) {
      const elapsed = (Date.now() - state.timestamp) / 1000;
      targetTime += elapsed;
    }
    lastApprovedState = {
      paused: !!state.paused,
      time: Math.max(0, targetTime),
      timestamp: Date.now()
    };
    if (state.audioTrackIndex != null) {
      hostAudioTrackIndex = state.audioTrackIndex;
    }
    console.log('Saved host state:', lastApprovedState, 'audioTrackIndex:', hostAudioTrackIndex);
  }

  function applyAudioTrack(idx) {
    if (idx == null) return;
    const audioTracks = player.audioTracks;
    if (!audioTracks || audioTracks.length <= idx) return;
    for (let i = 0; i < audioTracks.length; i++) {
      audioTracks[i].enabled = (i === idx);
    }
    console.log('Applied audio track index:', idx);
  }

  function resetMediaTracksToDefault() {
    activeSubtitles = null;
    setTrack(null);
    selectedAudioTrackIndex = 0;
    hostAudioTrackIndex = null;
    hideTrackSelection();
    if (isHost) {
      $('subFileName').textContent = 'No subtitle loaded';
    }
    console.log('Reset subtitle and audio track selections to default.');
  }

  function loadLocalFile(file) {
    console.log('Loading local video file source:', file.name);
    playbackMode = 'local';
    overlay.hidden = true;
    $('torrentStatus').textContent = `Local File: ${file.name}`;
    
    if (player._localUrl) {
      URL.revokeObjectURL(player._localUrl);
      player._localUrl = null;
    }
    
    const url = URL.createObjectURL(file);
    player._localUrl = url;
    player.src = url;
    
    // Preserve existing activeSubtitles if available (e.g. sent from host to member)
    if (activeSubtitles) {
      setTrack(activeSubtitles.text, activeSubtitles.name);
    } else {
      setTrack(null);
    }
    hideTrackSelection();

    const checkTracks = () => {
      if (isHost) {
        detectAndPopulateTracks();
      } else {
        hideTrackSelection();
        if (hostAudioTrackIndex != null) {
          applyAudioTrack(hostAudioTrackIndex);
        }
      }
    };

    if (player.readyState >= 1) {
      checkTracks();
    }
    player.addEventListener('loadedmetadata', checkTracks, { once: true });

    // Sync member playback position and subtitles as soon as video can play
    player.addEventListener('canplay', () => {
      if (!isHost && initialSyncPending) {
        initialSyncPending = false;
        let syncTime = lastApprovedState.time;
        if (!lastApprovedState.paused && lastApprovedState.timestamp) {
          const elapsed = (Date.now() - lastApprovedState.timestamp) / 1000;
          syncTime += elapsed;
        }
        console.log('Syncing newly loaded local file to host time:', syncTime, 'paused:', lastApprovedState.paused);
        applyRemote({
          type: lastApprovedState.paused ? 'pause' : 'play',
          time: Math.max(0, syncTime)
        });
        if (hostAudioTrackIndex != null) {
          applyAudioTrack(hostAudioTrackIndex);
        }
        if (activeSubtitles) {
          setTrack(activeSubtitles.text, activeSubtitles.name);
        }
      }
    }, { once: true });
  }

  // ---------- Track Selection (local files only) ----------
  // Labels/languages the browser fills in from MP4 handler metadata that are meaningless
  const JUNK_LABELS = ['soundhandler', 'videohandler', 'subtitlehandler', 'handler', 'mediahandler'];
  const JUNK_LANGS = ['und', 'zxx', ''];

  function cleanLabel(raw) {
    if (!raw) return '';
    return JUNK_LABELS.includes(raw.toLowerCase().replace(/[\s_-]/g, '')) ? '' : raw;
  }
  function cleanLang(raw) {
    if (!raw) return '';
    return JUNK_LANGS.includes(raw.toLowerCase()) ? '' : raw;
  }

  function hideTrackSelection() {
    $('trackSelectionPanel').hidden = true;
    $('audioTrackGroup').hidden = true;
    $('audioTrackSelect').innerHTML = '';
    const container = $('customAudioTrackContainer');
    if (container) container.innerHTML = '';
  }

  function formatTrackName(index, rawLabel, rawLang) {
    const label = cleanLabel(rawLabel);
    const lang = cleanLang(rawLang);
    if (label && lang) return `Track ${index + 1} — ${label} (${lang})`;
    if (label) return `Track ${index + 1} — ${label}`;
    if (lang) return `Track ${index + 1} (${lang})`;
    return `Track ${index + 1}`;
  }

  function renderCustomAudioTracks(audioTracks) {
    const container = $('customAudioTrackContainer');
    if (!container) return;
    container.innerHTML = '';

    for (let i = 0; i < audioTracks.length; i++) {
      const t = audioTracks[i];
      const name = formatTrackName(i, t.label, t.language);
      const isSelected = (i === selectedAudioTrackIndex || t.enabled);

      const card = document.createElement('div');
      card.className = 'themed-track-card' + (isSelected ? ' active' : '');
      card.dataset.index = i;
      card.innerHTML = `
        <div class="track-card-left">
          <svg class="icon track-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
          <span>${name}</span>
        </div>
        <span class="track-badge">${isSelected ? 'Active' : 'Select'}</span>
      `;

      card.addEventListener('click', () => {
        if (!isHost) return;
        selectedAudioTrackIndex = i;
        for (let j = 0; j < audioTracks.length; j++) {
          audioTracks[j].enabled = (j === i);
        }
        $('audioTrackSelect').value = String(i);
        renderCustomAudioTracks(audioTracks);
        console.log('Host switched to audio track:', i);
        relayFromHost({ type: 'audio-track', index: i }, null);
      });

      container.appendChild(card);
    }
  }

  function detectAndPopulateTracks() {
    if (!isHost) {
      hideTrackSelection();
      return;
    }

    const audioTracks = player.audioTracks;
    if (audioTracks && audioTracks.length > 0) {
      const sel = $('audioTrackSelect');
      sel.innerHTML = '';
      for (let i = 0; i < audioTracks.length; i++) {
        const t = audioTracks[i];
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = formatTrackName(i, t.label, t.language);
        if (i === selectedAudioTrackIndex || t.enabled) opt.selected = true;
        sel.appendChild(opt);
      }
      renderCustomAudioTracks(audioTracks);
      $('audioTrackGroup').hidden = false;
      $('trackSelectionPanel').hidden = false;
      console.log(`Host detected ${audioTracks.length} audio tracks.`);
    } else {
      hideTrackSelection();
    }
  }

  // Audio track switch handler (host only)
  $('audioTrackSelect').addEventListener('change', (e) => {
    if (!isHost) return;
    const audioTracks = player.audioTracks;
    if (!audioTracks) return;
    const selectedIdx = parseInt(e.target.value, 10);
    selectedAudioTrackIndex = selectedIdx;
    for (let i = 0; i < audioTracks.length; i++) {
      audioTracks[i].enabled = (i === selectedIdx);
    }
    renderCustomAudioTracks(audioTracks);
    console.log('Host switched to audio track:', selectedIdx);
    relayFromHost({ type: 'audio-track', index: selectedIdx }, null);
  });

  function showLocalFilePrompt(fileName) {
    expectedFileName = fileName;
    $('promptFileName').textContent = fileName;
    $('localFilePrompt').hidden = false;
    
    player.removeAttribute('src');
    player.load();
    overlay.hidden = false;
    overlayText.textContent = `Local file mode active. Please select: ${fileName}`;
  }

  let statusPoll = null;
  function startStatusPoll() {
    if (statusPoll) clearInterval(statusPoll);
    statusPoll = setInterval(async () => {
      try {
        const res = await fetch('/api/torrent/status');
        const s = await res.json();
        if (!s.active) return;
        const pct = Math.round(s.progress * 100);
        $('torrentStatus').textContent = `${s.name} — ${pct}% downloaded, ${s.numPeers} peers`;
        if (s.ready) overlay.hidden = true;
      } catch {}
    }, 1500);
  }

  player.addEventListener('waiting', () => { overlay.hidden = false; overlayText.textContent = 'Buffering…'; });
  player.addEventListener('playing', () => { overlay.hidden = true; });
  player.addEventListener('canplay', () => { overlay.hidden = true; });

  // ---------- Sync (video <-> peers) ----------
  function sendToHost(msg) {
    const host = conns.get('host');
    if (host && host.open) host.send(msg);
  }
  function relayFromHost(msg, exceptPeerId) {
    conns.forEach((c, id) => { if (id !== exceptPeerId && c.open) c.send(msg); });
  }

  function applyRemote(msg) {
    applyingRemote = true;
    if (msg.type === 'play') {
      lastApprovedState.paused = false;
      lastApprovedState.time = msg.time;
      player.currentTime = msg.time;
      player.play().catch(() => {});
    }
    if (msg.type === 'pause') {
      lastApprovedState.paused = true;
      lastApprovedState.time = msg.time;
      player.currentTime = msg.time;
      player.pause();
    }
    if (msg.type === 'seek') {
      lastApprovedState.time = msg.time;
      player.currentTime = msg.time;
    }
    setTimeout(() => { applyingRemote = false; }, 500);
  }

  // Snap a member's player back to the authoritative state (used when an unauthorized action is rejected)
  function forceResync(conn) {
    const msg = lastApprovedState.paused
      ? { type: 'pause', time: lastApprovedState.time }
      : { type: 'play', time: lastApprovedState.time };
    if (conn) conn.send(msg); else applyRemote(msg);
  }

  ['play', 'pause', 'seeked'].forEach((evt) => {
    player.addEventListener(evt, () => {
      if (applyingRemote) return;
      if (!me().canControl) {
        setTimeout(() => forceResync(null), 0);
        flashHint('You don\'t have permission to control playback in this room.');
        return;
      }
      lastApprovedState.paused = player.paused;
      lastApprovedState.time = player.currentTime;

      const type = evt === 'seeked' ? 'seek' : evt;
      const msg = { type, time: player.currentTime };
      if (isHost) relayFromHost(msg, null);
      else sendToHost(msg);
    });
  });

  player.addEventListener('timeupdate', () => {
    if (applyingRemote || me().canControl || (!player.paused && lastApprovedState.paused === player.paused)) {
      lastApprovedState.time = player.currentTime;
    }
  });

  player.addEventListener('contextmenu', (e) => {
    if (!me().canControl) {
      e.preventDefault();
    }
  });

  let hintTimer = null;
  function flashHint(text) {
    const el = $('torrentStatus');
    const prev = el.textContent;
    el.textContent = text;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { el.textContent = prev; }, 2500);
  }

  // ---------- Chat ----------
  function renderChatMessage({ name, text, time }) {
    const box = $('chatMessages');
    const row = document.createElement('div');
    row.className = 'chat-msg';
    const t = document.createElement('span');
    t.className = 'chat-time';
    t.textContent = `[${fmtTime(time)}]`;
    t.title = 'Jump to this point';
    t.addEventListener('click', () => attemptSeekTo(time));
    row.appendChild(t);
    row.appendChild(document.createTextNode(' '));
    const meta = document.createElement('span');
    meta.className = 'chat-name';
    meta.textContent = name + ':';
    row.appendChild(meta);
    row.appendChild(document.createTextNode(' ' + text));
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
  }

  function attemptSeekTo(time) {
    if (!me().canControl) { flashHint('You don\'t have permission to control playback in this room.'); return; }
    player.currentTime = time;
    const msg = { type: 'seek', time };
    if (isHost) relayFromHost(msg, null); else sendToHost(msg);
  }

  function updatePermissionsUI() {
    const allowed = me().canChat;
    $('chatInput').disabled = !allowed;
    $('chatForm').querySelector('button').disabled = !allowed;
    $('chatDisabledNote').hidden = allowed;

    const allowedControl = me().canControl;
    if (allowedControl) {
      player.setAttribute('controls', 'true');
      $('customPlayerControls').hidden = true;
    } else {
      player.removeAttribute('controls');
      $('customPlayerControls').hidden = false;
      if (document.fullscreenElement === player) {
        document.exitFullscreen().then(() => {
          $('videoPlayerContainer').requestFullscreen().catch(() => {});
        }).catch(() => {});
      }
    }
  }

  $('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('chatInput');
    const text = input.value.trim();
    if (!text || !me().canChat) return;
    const msg = { type: 'chat', name: myName, text, time: player.currentTime || 0 };
    renderChatMessage(msg);
    if (isHost) relayFromHost(msg, null); else sendToHost(msg);
    input.value = '';
  });

  // ---------- Members UI ----------
  function renderMembers() {
    const list = $('memberList');
    list.innerHTML = '';
    members.forEach((m, id) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="dot"></span>`;
      const label = document.createElement('span');
      label.textContent = m.name;
      li.appendChild(label);

      if (m.isHost) {
        const tag = document.createElement('span');
        tag.className = 'tag'; tag.textContent = 'host';
        li.appendChild(tag);
      } else if (isHost) {
        const btns = document.createElement('span');
        btns.className = 'perm-btns';

        const ctrlBtn = document.createElement('button');
        ctrlBtn.type = 'button';
        ctrlBtn.className = 'perm-btn' + (m.canControl ? ' active' : ' off');
        ctrlBtn.title = m.canControl ? 'Can control playback (tap to revoke)' : 'Cannot control playback (tap to allow)';
        ctrlBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>';
        ctrlBtn.addEventListener('click', () => togglePermission(id, 'canControl'));
        btns.appendChild(ctrlBtn);

        const chatBtn = document.createElement('button');
        chatBtn.type = 'button';
        chatBtn.className = 'perm-btn' + (m.canChat ? ' active' : ' off');
        chatBtn.title = m.canChat ? 'Can chat (tap to mute)' : 'Muted (tap to allow)';
        chatBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';
        chatBtn.addEventListener('click', () => togglePermission(id, 'canChat'));
        btns.appendChild(chatBtn);

        li.appendChild(btns);
      } else {
        const tag = document.createElement('span');
        tag.className = 'tag';
        const statusStr = [m.canControl ? '' : 'no control', m.canChat ? '' : 'muted'].filter(Boolean).join(' · ');
        tag.textContent = statusStr ? `guest · ${statusStr}` : 'guest';
        li.appendChild(tag);
      }
      list.appendChild(li);
    });
    $('memberCount').textContent = `(${members.size}/${maxMembers})`;
    updatePermissionsUI();
  }

  function togglePermission(peerId, field) {
    const m = members.get(peerId);
    if (!m) return;
    m[field] = !m[field];
    renderMembers();
    broadcastMemberList();
  }

  function broadcastMemberList() {
    const list = [...members.entries()].map(([peerId, m]) => ({ peerId, ...m }));
    relayFromHost({ type: 'members', list }, null);
  }

  // ---------- Host flow ----------
  function createRoom() {
    myName = $('createName').value.trim();
    const rname = $('roomName').value.trim() || 'Untitled room';
    const magnet = $('magnetLink').value.trim();
    maxMembers = parseInt($('maxMembers').value, 10);
    roomPassword = $('roomPassword').value;

    if (!myName) return setHint('createHint', 'Enter your name.', true);
    if (playbackMode === 'local') {
      if (!localVideoFile) return setHint('createHint', 'Please choose a local video file.', true);
    } else {
      if (!magnet) return setHint('createHint', 'Paste a magnet link.', true);
    }

    roomCode = code();
    isHost = true;
    myId = 'host';
    setHint('createHint', 'Opening room…', false);
    console.log('Creating room: sw-' + roomCode);

    peer = new Peer(`sw-${roomCode}`, {
      debug: 1,
      config: { iceServers: getIceServers() }
    });

    peer.on('open', () => {
      console.log('Room created successfully. Peer ID: sw-' + roomCode);
      members.set('host', { name: myName, isHost: true, canControl: true, canChat: true });
      $('roomTitle').textContent = rname;
      showRoomScreen();
      renderMembers();
      if (playbackMode === 'local') {
        loadLocalFile(localVideoFile);
      } else {
        loadTorrentLocally(magnet);
      }
    });

    peer.on('connection', (conn) => {
      console.log('Received connection request from member:', conn.peer);
      conn.on('data', (msg) => handleHostMessage(conn, msg));
      conn.on('close', () => {
        console.log('Member disconnected:', conn.peer);
        conns.delete(conn.peer);
        members.delete(conn.peer);
        renderMembers();
        broadcastMemberList();
      });
    });

    peer.on('error', (err) => {
      console.error('PeerJS error:', err);
      setHint('createHint', friendlyPeerError(err), true);
    });
  }

  function handleHostMessage(conn, msg) {
    if (msg.type === 'join') {
      if (members.size >= maxMembers) {
        conn.send({ type: 'rejected', reason: 'Room is full.' });
        setTimeout(() => conn.close(), 200);
        return;
      }
      if (roomPassword && msg.password !== roomPassword) {
        conn.send({ type: 'rejected', reason: 'Wrong password.' });
        setTimeout(() => conn.close(), 200);
        return;
      }
      conns.set(conn.peer, conn);
      members.set(conn.peer, { name: msg.name, isHost: false, canControl: true, canChat: true });
      conn.send({
        type: 'joined',
        peerId: conn.peer,
        roomTitle: $('roomTitle').textContent,
        members: [...members.entries()].map(([peerId, m]) => ({ peerId, ...m })),
        magnet: playbackMode === 'torrent' ? $('magnetLink').value.trim() : null,
        playbackMode: playbackMode,
        expectedFileName: expectedFileName,
        subtitles: activeSubtitles,
        hostState: {
          paused: player.paused,
          time: player.currentTime || 0,
          timestamp: Date.now(),
          audioTrackIndex: selectedAudioTrackIndex
        }
      });
      broadcastMemberList();
      renderMembers();
      return;
    }

    if (['play', 'pause', 'seek'].includes(msg.type)) {
      const sender = members.get(conn.peer);
      if (!sender || !sender.canControl) { forceResync(conn); return; }
      applyRemote(msg);
      relayFromHost(msg, conn.peer);
      return;
    }

    if (msg.type === 'chat') {
      const sender = members.get(conn.peer);
      if (!sender || !sender.canChat) return; // silently dropped
      renderChatMessage(msg);
      relayFromHost(msg, conn.peer);
    }
  }

  // ---------- Member flow ----------
  function joinRoom() {
    myName = $('joinName').value.trim();
    const inputCode = $('joinCode').value.trim().toUpperCase().replace(/^SW-/, '');
    const password = $('joinPassword').value;

    if (!myName) return setHint('joinHint', 'Enter your name.', true);
    if (!inputCode) return setHint('joinHint', 'Enter the room code.', true);

    isHost = false;
    roomCode = inputCode;
    setHint('joinHint', 'Connecting…', false);
    console.log('Attempting to join room: sw-' + roomCode);

    peer = new Peer({
      debug: 1,
      config: { iceServers: getIceServers() }
    });

    peer.on('open', (id) => {
      console.log('Connected to PeerJS server. Member Peer ID: ' + id);
      myId = id;
      const conn = peer.connect(`sw-${roomCode}`, { reliable: true });
      conns.set('host', conn);

      conn.on('open', () => {
        console.log('Connection established with host sw-' + roomCode + '. Sending join request...');
        conn.send({ type: 'join', name: myName, password });
      });

      conn.on('data', (msg) => {
        if (msg.type === 'rejected') {
          console.warn('Host rejected join request:', msg.reason);
          setHint('joinHint', msg.reason, true);
          conn.close();
          return;
        }
        if (msg.type === 'joined') {
          console.log('Join request accepted by host! Syncing room state...');
          myId = msg.peerId;
          rebuildMembers(msg.members);
          $('roomTitle').textContent = msg.roomTitle;
          showRoomScreen();
          renderMembers();
          
          playbackMode = msg.playbackMode || 'torrent';
          expectedFileName = msg.expectedFileName || '';
          initialSyncPending = true;

          if (msg.subtitles) {
            console.log('Received active subtitles from host:', msg.subtitles.name);
            activeSubtitles = msg.subtitles;
          }

          if (msg.hostState) {
            saveHostState(msg.hostState);
          }

          if (playbackMode === 'local') {
            console.log('Room is in local video file mode. Expected file:', expectedFileName);
            showLocalFilePrompt(expectedFileName);
          } else {
            console.log('Room is in torrent mode.');
            $('localFilePrompt').hidden = true;
            if (msg.magnet) {
              console.log('Loading torrent from host magnet link...');
              loadTorrentLocally(msg.magnet).then(() => {
                if (activeSubtitles) {
                  console.log('Applying subtitles for torrent mode...');
                  setTrack(activeSubtitles.text, activeSubtitles.name);
                }
              });
            }
          }
          return;
        }
        if (msg.type === 'members') {
          rebuildMembers(msg.list);
          renderMembers();
          return;
        }
        if (['play', 'pause', 'seek'].includes(msg.type)) {
          applyRemote(msg);
          return;
        }
        if (msg.type === 'chat') {
          renderChatMessage(msg);
          return;
        }
        if (msg.type === 'subtitles') {
          activeSubtitles = msg.subtitles;
          if (msg.subtitles) {
            setTrack(msg.subtitles.text, msg.subtitles.name);
          } else {
            setTrack(null);
          }
          return;
        }
        if (msg.type === 'audio-track') {
          hostAudioTrackIndex = msg.index;
          applyAudioTrack(msg.index);
          return;
        }
        if (msg.type === 'source-change') {
          playbackMode = msg.playbackMode;
          expectedFileName = msg.expectedFileName || '';
          initialSyncPending = true;
          if (msg.subtitles) {
            activeSubtitles = msg.subtitles;
          } else {
            resetMediaTracksToDefault();
          }
          if (msg.hostState) {
            saveHostState(msg.hostState);
          }
          if (playbackMode === 'local') {
            showLocalFilePrompt(expectedFileName);
          } else {
            $('localFilePrompt').hidden = true;
            if (msg.magnet) {
              loadTorrentLocally(msg.magnet).then(() => {
                if (activeSubtitles) {
                  setTrack(activeSubtitles.text, activeSubtitles.name);
                }
              });
            }
          }
          return;
        }
        if (msg.type === 'host-left') {
          player.pause();
          $('hostLeftModal').hidden = false;
          return;
        }
        if (msg.type === 'reload') {
          loadTorrentLocally(msg.magnet);
        }
      });

      conn.on('close', () => {
        setHint('joinHint', 'Disconnected from host.', true);
        if (!isHost) {
          player.pause();
          $('hostLeftModal').hidden = false;
        }
      });
    });

    peer.on('error', (err) => setHint('joinHint', friendlyPeerError(err), true));
  }

  function rebuildMembers(list) {
    members.clear();
    list.forEach(({ peerId, ...m }) => members.set(peerId, m));
  }

  function friendlyPeerError(err) {
    if (String(err.type) === 'peer-unavailable') return 'Room not found. Check the code and try again.';
    return 'Connection error: ' + (err.type || err.message || 'unknown');
  }

  function setHint(id, text, isError) {
    const el = $(id);
    el.textContent = text;
    el.classList.toggle('error', !!isError);
  }

  // ---------- Wiring ----------
  $('createRoomBtn').addEventListener('click', createRoom);
  $('joinRoomBtn').addEventListener('click', joinRoom);

  $('loadTorrentBtn').addEventListener('click', () => {
    const magnet = $('newMagnet').value.trim();
    if (!magnet) return;
    playbackMode = 'torrent';
    resetMediaTracksToDefault();
    loadTorrentLocally(magnet);
    relayFromHost({
      type: 'source-change',
      playbackMode: 'torrent',
      magnet: magnet,
      subtitles: null,
      hostState: {
        paused: true,
        time: 0,
        timestamp: Date.now(),
        audioTrackIndex: 0
      }
    }, null);
  });

  $('uploadSubBtn').addEventListener('click', () => {
    $('subFileInput').click();
  });

  $('subFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      let text = evt.target.result;
      if (file.name.toLowerCase().endsWith('.srt')) {
        text = srtToVtt(text);
      }
      
      activeSubtitles = { text, name: file.name };
      setTrack(text, file.name);

      // Broadcast subtitles to all active members
      relayFromHost({ type: 'subtitles', subtitles: activeSubtitles }, null);
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // Room Mode Select (Landing)
  $('roomModeSelect').addEventListener('change', (e) => {
    playbackMode = e.target.value;
    const isLocal = playbackMode === 'local';
    $('torrentInputWrapper').hidden = isLocal;
    $('localInputWrapper').hidden = !isLocal;
  });

  $('chooseLocalBtn').addEventListener('click', () => {
    $('localVideoInput').click();
  });

  $('localVideoInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.name.toLowerCase().endsWith('.mkv')) {
      alert('MKV files are not supported due to browser audio codec limitations. Please select an MP4 or WebM file.');
      e.target.value = '';
      return;
    }
    localVideoFile = file;
    expectedFileName = file.name;
    $('localFileNameLanding').textContent = file.name;
  });

  // Member local file selection
  $('chooseMemberLocalBtn').addEventListener('click', () => {
    $('memberLocalInput').click();
  });

  $('memberLocalInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.name.toLowerCase().endsWith('.mkv')) {
      alert('MKV files are not supported due to browser audio codec limitations. Please select an MP4 or WebM file.');
      e.target.value = '';
      return;
    }
    localVideoFile = file;
    initialSyncPending = true;
    loadLocalFile(file);
    $('localFilePrompt').hidden = true;
  });

  // Host controls source changing (only toggles UI input fields without resetting active playback)
  $('hostSourceSelect').addEventListener('change', (e) => {
    const mode = e.target.value;
    const isLocal = mode === 'local';
    $('hostTorrentWrapper').hidden = isLocal;
    $('hostLocalWrapper').hidden = !isLocal;
  });

  $('chooseHostLocalBtn').addEventListener('click', () => {
    $('hostLocalInput').click();
  });

  $('hostLocalInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.name.toLowerCase().endsWith('.mkv')) {
      alert('MKV files are not supported due to browser audio codec limitations. Please select an MP4 or WebM file.');
      e.target.value = '';
      return;
    }
    resetMediaTracksToDefault();
    localVideoFile = file;
    expectedFileName = file.name;
    $('hostLocalFileName').textContent = file.name;
    loadLocalFile(file);

    // Broadcast change to all members
    relayFromHost({
      type: 'source-change',
      playbackMode: 'local',
      expectedFileName: file.name,
      subtitles: null,
      hostState: {
        paused: true,
        time: 0,
        timestamp: Date.now(),
        audioTrackIndex: 0
      }
    }, null);
  });

  $('customSubtitlesBtn').addEventListener('click', () => {
    const track = player.textTracks[0];
    if (track) {
      const active = track.mode === 'showing';
      track.mode = active ? 'hidden' : 'showing';
      $('customSubtitlesBtn').textContent = active ? 'Show Subs' : 'Hide Subs';
    } else {
      flashHint('No subtitles loaded.');
    }
  });

  $('customMuteBtn').addEventListener('click', () => {
    player.muted = !player.muted;
    $('customMuteBtn').textContent = player.muted ? 'Unmute' : 'Mute';
  });

  $('customFullscreenBtn').addEventListener('click', () => {
    if (!document.fullscreenElement) {
      $('videoPlayerContainer').requestFullscreen().catch((err) => {
        console.error('Fullscreen error:', err);
      });
    } else {
      document.exitFullscreen();
    }
  });

  // Track mouse movement to auto-hide custom controls after inactivity
  let mouseTimer = null;
  const playerContainer = $('videoPlayerContainer');
  const showControlsTemporarily = () => {
    playerContainer.classList.add('mouse-moving');
    clearTimeout(mouseTimer);
    mouseTimer = setTimeout(() => {
      playerContainer.classList.remove('mouse-moving');
    }, 2500);
  };

  playerContainer.addEventListener('mousemove', showControlsTemporarily);
  playerContainer.addEventListener('mouseenter', showControlsTemporarily);
  playerContainer.addEventListener('mouseleave', () => {
    clearTimeout(mouseTimer);
    playerContainer.classList.remove('mouse-moving');
  });

  // Intercept and redirect native player fullscreen events to the container
  document.addEventListener('fullscreenchange', () => {
    const el = document.fullscreenElement;
    if (!el) {
      isFullscreenActive = false;
      return;
    }
    
    if (el === player) {
      if (isFullscreenActive) {
        document.exitFullscreen().catch(() => {});
        isFullscreenActive = false;
        return;
      }
      if (me().canControl) {
        isFullscreenActive = false;
        return;
      }
      document.exitFullscreen().catch(() => {});
    } else if (el === $('videoPlayerContainer')) {
      isFullscreenActive = true;
    }
  });

  $('shareBtn').addEventListener('click', async () => {
    const text = `Join my SyncWatch room!\nCode: ${roomCode}${roomPassword ? '\n(password protected — ask me for it)' : ''}`;
    try {
      await navigator.clipboard.writeText(text);
      $('shareBtn').textContent = 'Copied!';
      setTimeout(() => ($('shareBtn').textContent = 'Copy invite'), 1500);
    } catch {
      alert(text);
    }
  });

  // Load saved ICE Servers config into textarea on load
  const savedIce = localStorage.getItem('sw_ice_servers');
  if (savedIce) {
    $('iceServersInput').value = savedIce;
  }

  $('saveIceBtn').addEventListener('click', () => {
    const val = $('iceServersInput').value.trim();
    if (!val) {
      localStorage.removeItem('sw_ice_servers');
      $('iceSaveHint').textContent = 'Configuration reset to default STUN servers.';
      $('iceSaveHint').classList.remove('error');
      return;
    }
    try {
      const parsed = JSON.parse(val);
      if (!Array.isArray(parsed)) {
        throw new Error('Must be a JSON Array');
      }
      localStorage.setItem('sw_ice_servers', JSON.stringify(parsed, null, 2));
      $('iceSaveHint').textContent = 'Configuration saved successfully!';
      $('iceSaveHint').classList.remove('error');
    } catch (e) {
      $('iceSaveHint').textContent = 'Invalid JSON Array: ' + e.message;
      $('iceSaveHint').classList.add('error');
    }
  });

  // ---------- Page Refresh & Reload Protection ----------
  let userIsLeavingIntentional = false;

  // Block keyboard refresh shortcuts (F5, Ctrl+R, Cmd+R, Ctrl+F5) across all keyboard layouts (Arabic, etc.)
  window.addEventListener('keydown', (e) => {
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    const isRKey = e.code === 'KeyR' || e.keyCode === 82 || (e.key && e.key.toLowerCase() === 'r') || e.key === 'ق';
    const isF5Key = e.key === 'F5' || e.code === 'F5' || e.keyCode === 116;
    const isRefreshKey = isF5Key || (isCtrlOrCmd && isRKey);

    if (isRefreshKey) {
      const isRoomActive = !$('room').hidden;
      if (isRoomActive) {
        e.preventDefault();
        e.stopPropagation();
        console.warn('SyncWatch blocked page refresh shortcut during an active session.');
      }
    }
  }, true);

  // ---------- Host Disconnect Broadcast ----------
  function handleHostLeave() {
    if (isHost) {
      console.log('Host leaving: broadcasting disconnect to all members...');
      conns.forEach((c) => {
        try {
          c.send({ type: 'host-left' });
          c.close();
        } catch (err) {}
      });
      conns.clear();
      if (peer) {
        try { peer.destroy(); } catch (err) {}
      }
    }
  }

  // Prompt confirmation dialog if user attempts to refresh, close, or navigate away
  window.addEventListener('beforeunload', (e) => {
    if (isHost && !userIsLeavingIntentional) {
      handleHostLeave();
    }
    if (userIsLeavingIntentional) return;
    const isRoomActive = !$('room').hidden;
    if (isRoomActive) {
      e.preventDefault();
      e.returnValue = 'Are you sure you want to leave or reload this SyncWatch room? Your active session will be disconnected.';
      return e.returnValue;
    }
  });

  // ---------- Custom Leave Room Modal ----------
  const hideLeaveModal = () => {
    $('leaveModal').hidden = true;
  };

  const showLeaveModal = () => {
    $('leaveModal').hidden = false;
  };

  $('leaveBtn').addEventListener('click', showLeaveModal);
  $('cancelLeaveBtn').addEventListener('click', hideLeaveModal);

  $('confirmLeaveBtn').addEventListener('click', () => {
    userIsLeavingIntentional = true;
    if (isHost) {
      handleHostLeave();
    }
    window.location.reload();
  });

  $('hostLeftOkBtn').addEventListener('click', () => {
    userIsLeavingIntentional = true;
    window.location.reload();
  });

  // Close modal when clicking outside on overlay background
  $('leaveModal').addEventListener('click', (e) => {
    if (e.target === $('leaveModal')) {
      hideLeaveModal();
    }
  });

  // ---------- Custom Themed UI Controls Handlers ----------
  
  // Landing source card clicks
  document.querySelectorAll('#landingSourceCards .source-card').forEach((card) => {
    card.addEventListener('click', () => {
      document.querySelectorAll('#landingSourceCards .source-card').forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
      const val = card.dataset.value;
      const sel = $('roomModeSelect');
      if (sel && sel.value !== val) {
        sel.value = val;
        sel.dispatchEvent(new Event('change'));
      }
    });
  });

  // Host source segmented control clicks
  document.querySelectorAll('#hostSourceSegment .segment-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#hostSourceSegment .segment-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const val = btn.dataset.value;
      const sel = $('hostSourceSelect');
      if (sel && sel.value !== val) {
        sel.value = val;
        sel.dispatchEvent(new Event('change'));
      }
    });
  });

  // Max members custom dropdown
  const maxWrapper = $('maxMembersCustom');
  const maxBtn = $('maxMembersBtn');
  const maxMenu = $('maxMembersMenu');
  const maxLabel = $('maxMembersValLabel');

  if (maxBtn && maxMenu && maxWrapper) {
    maxBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isClosed = maxMenu.hidden;
      maxMenu.hidden = !isClosed;
      maxWrapper.classList.toggle('open', isClosed);
    });

    maxMenu.querySelectorAll('.themed-option').forEach((opt) => {
      opt.addEventListener('click', () => {
        const val = opt.dataset.value;
        maxMenu.querySelectorAll('.themed-option').forEach((o) => o.classList.remove('active'));
        opt.classList.add('active');
        if (maxLabel) maxLabel.textContent = `${val} Members`;
        const sel = $('maxMembers');
        if (sel) {
          sel.value = val;
          sel.dispatchEvent(new Event('change'));
        }
        maxMenu.hidden = true;
        maxWrapper.classList.remove('open');
      });
    });

    document.addEventListener('click', (e) => {
      if (!maxWrapper.contains(e.target)) {
        maxMenu.hidden = true;
        maxWrapper.classList.remove('open');
      }
    });
  }
})();
