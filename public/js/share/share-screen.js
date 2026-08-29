/**
 * share/share-screen.js
 * Full live share-screen + WebRTC AV + presence/content sync.
 * Installed once from map.js after the MapLibre map exists.
 */
(function (global) {
  'use strict';

  var Mahp = global.Mahp || (global.Mahp = {});
  Mahp.share = Mahp.share || {};

  function install(host) {
    if (!host || typeof host.getMap !== 'function') {
      throw new Error('Mahp.share.screen.install requires host.getMap');
    }
    if (Mahp.share.screen && Mahp.share.screen._installed) {
      return Mahp.share.screen;
    }

    var api = Mahp.share.screen || {};

    // ---------- Share Screen (collaborative view of a map region) ----------
    // Draw a polyline/rectangle area, name it, get a link. Participants share
    // location and see each other + drawings inside the screen in near-realtime
    // via polling. Dev can configure max duration and marker size via /api/config
    // and share-screen settings on the server.
    let shareScreenMode = false; // drawing the screen outline
    let shareScreenCoords = [];
    let activeShareScreen = null; // { id, name, geometry, expiresAt, isOwner }
    let shareScreenWs = null;
    let shareScreenUserMarkers = {}; // userId -> Marker
    let shareScreenRemoteSourceId = 'share-screen-remote';
    let shareScreenOutlineSourceId = 'share-screen-outline';
    let shareScreenConfig = { maxDurationMinutes: 120, userIconSize: 28, pollMs: 2500 };
    let shareScreenParticipants = []; // last known users for panel
    let shareScreenFullscreen = false;

    // WebRTC AV for share screen
    let ssLocalStream = null;
    let ssPeers = new Map(); // userId -> RTCPeerConnection
    let ssMicMuted = false;
    let ssVideoOff = false;
    let ssHostForcedMute = false; // creator forced this client muted
    let ssRemoteAv = new Map(); // userId -> { audioMuted, videoOff }
    let ssInCall = false; // voice/video call active (independent of share-screen membership)
    let ssRemoteStreams = new Map(); // userId -> MediaStream (survive panel re-renders)
    let ssHostMutedUsers = new Set(); // owner-side: users force-muted by host
    // Floating video overlays: uid -> { el, uid, name }
    let ssVideoOverlays = new Map();
    let ssOverlayZ = 40;
    // Peers we've seen on the call — keep tiles/overlays alive through network drops
    let ssKnownCallPeers = new Map(); // uid -> { name }
    let ssPeerStale = new Set(); // uids currently without a live stream (show spinner)
    // STUN + free public TURN (Open Relay Project / Metered)
    // TURN is required for many mobile & restrictive networks where pure STUN fails.
    const SS_RTC_CONFIG = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:openrelay.metered.ca:80' },
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        {
          urls: 'turn:openrelay.metered.ca:443',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        {
          urls: 'turn:openrelay.metered.ca:443?transport=tcp',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        },
        {
          urls: 'turns:openrelay.metered.ca:443',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        }
      ],
      iceCandidatePoolSize: 4
    };

    function updateShareScreenNavBadge() {
      const btn = document.querySelector('.sidebar-nav .nav-item[data-action="sharescreen"]');
      if (!btn) return;
      btn.classList.toggle('ss-active', !!activeShareScreen);
      let badge = btn.querySelector('.ss-badge');
      const n = shareScreenParticipants.length;
      if (activeShareScreen && n > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'ss-badge';
          btn.appendChild(badge);
        }
        badge.textContent = String(n);
      } else if (badge) {
        badge.remove();
      }
    }

    function updateSsAvControlsUi() {
      const micBtn = document.getElementById('ss-btn-mic');
      const camBtn = document.getElementById('ss-btn-cam');
      if (micBtn) {
        const muted = ssMicMuted || ssHostForcedMute;
        micBtn.classList.toggle('muted', muted);
        micBtn.title = ssHostForcedMute ? 'Muted by host' : (ssMicMuted ? 'Unmute microphone' : 'Mute microphone');
        micBtn.innerHTML = muted ? '<i class="fa-solid fa-microphone-slash"></i>' : '<i class="fa-solid fa-microphone"></i>';
        micBtn.disabled = !!ssHostForcedMute;
      }
      if (camBtn) {
        camBtn.classList.toggle('muted', ssVideoOff);
        camBtn.title = ssVideoOff ? 'Turn camera on' : 'Turn camera off';
        camBtn.innerHTML = ssVideoOff ? '<i class="fa-solid fa-video-slash"></i>' : '<i class="fa-solid fa-video"></i>';
      }
    }

    function ensureSsAvExpandBtn(tile, uid, name) {
      if (tile.querySelector('.ss-av-expand')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ss-av-expand';
      btn.title = 'Open larger video overlay';
      btn.setAttribute('aria-label', 'Open larger video overlay');
      btn.innerHTML = '<i class="fa-solid fa-up-right-and-down-left-from-center"></i>';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openSsVideoOverlay(uid, name || (uid === '__local__' ? 'You' : 'User'));
      });
      tile.appendChild(btn);
    }

    function tileSpinnerHtml() {
      return '<div class="ss-av-stale" aria-hidden="true"><div class="ss-av-spinner"></div><span>Reconnecting…</span></div>';
    }

    function ensureSsAvTileShell(grid, uid, isLocal) {
      const safeId = String(uid).replace(/"/g, '');
      let tile = grid.querySelector('[data-uid="' + safeId + '"]');
      if (!tile) {
        tile = document.createElement('div');
        tile.className = 'ss-av-tile';
        tile.dataset.uid = uid;
        tile.innerHTML =
          (isLocal
            ? '<video playsinline autoplay muted></video>'
            : '<video playsinline autoplay></video>') +
          tileSpinnerHtml() +
          '<div class="ss-av-tile-meta"><span class="ss-av-name"></span><span class="ss-av-flags"></span></div>';
        if (isLocal) grid.prepend(tile);
        else grid.appendChild(tile);
      } else if (!tile.querySelector('.ss-av-stale')) {
        tile.insertAdjacentHTML('beforeend', tileSpinnerHtml());
      }
      return tile;
    }

    function setSsTileStale(tile, stale) {
      if (!tile) return;
      tile.classList.toggle('is-stale', !!stale);
    }

    function renderSsAvGrid() {
      const grid = document.getElementById('ss-av-grid');
      if (!grid || !ssInCall) return;
      const me = host.getUserId();
      const myName = host.getUserDisplayName() || 'You';

      // Local tile
      const localTile = ensureSsAvTileShell(grid, '__local__', true);
      ensureSsAvExpandBtn(localTile, '__local__', myName);
      const localVid = localTile.querySelector('video');
      if (localVid && ssLocalStream && localVid.srcObject !== ssLocalStream) {
        localVid.srcObject = ssLocalStream;
      }
      localTile.classList.toggle('cam-off', ssVideoOff);
      setSsTileStale(localTile, false);
      const localNameEl = localTile.querySelector('.ss-av-name');
      if (localNameEl) localNameEl.textContent = myName === 'You' ? 'You' : myName + ' · you';
      const flags = localTile.querySelector('.ss-av-flags');
      if (flags) {
        flags.innerHTML =
          (ssMicMuted || ssHostForcedMute ? '<i class="fa-solid fa-microphone-slash"></i>' : '') +
          (ssVideoOff ? '<i class="fa-solid fa-video-slash"></i>' : '');
      }
      syncSsVideoOverlayStream('__local__', ssLocalStream, myName, ssVideoOff, false);

      // Build set of remote uids to show: current participants + known call peers + open overlays
      const remoteIds = new Set();
      (shareScreenParticipants || []).forEach(u => {
        if (u && u.userId && u.userId !== me) {
          remoteIds.add(u.userId);
          const nm = u.name || 'User';
          ssKnownCallPeers.set(u.userId, { name: nm });
        }
      });
      ssKnownCallPeers.forEach((_, uid) => {
        if (uid !== me && uid !== '__local__') remoteIds.add(uid);
      });
      ssVideoOverlays.forEach((_, uid) => {
        if (uid !== '__local__') remoteIds.add(uid);
      });
      ssRemoteStreams.forEach((_, uid) => remoteIds.add(uid));

      const seen = new Set(['__local__']);
      remoteIds.forEach(uid => {
        seen.add(uid);
        const known = ssKnownCallPeers.get(uid) || {};
        const participant = (shareScreenParticipants || []).find(p => p.userId === uid);
        const displayName = (participant && participant.name) || known.name || 'User';
        ssKnownCallPeers.set(uid, { name: displayName });

        const tile = ensureSsAvTileShell(grid, uid, false);
        ensureSsAvExpandBtn(tile, uid, displayName);
        const nameEl = tile.querySelector('.ss-av-name');
        if (nameEl) nameEl.textContent = displayName;
        const av = ssRemoteAv.get(uid) || {};
        tile.classList.toggle('cam-off', !!av.videoOff);
        const rFlags = tile.querySelector('.ss-av-flags');
        if (rFlags) {
          rFlags.innerHTML =
            (av.audioMuted ? '<i class="fa-solid fa-microphone-slash"></i>' : '') +
            (av.videoOff ? '<i class="fa-solid fa-video-slash"></i>' : '');
        }
        const stream = ssRemoteStreams.get(uid);
        const stale = ssPeerStale.has(uid) || !stream;
        setSsTileStale(tile, stale);
        const vid = tile.querySelector('video');
        if (vid && stream && vid.srcObject !== stream) {
          vid.srcObject = stream;
          vid.play().catch(() => {});
        }
        // Keep last frame if stream gone — do not clear srcObject
        syncSsVideoOverlayStream(uid, stream, displayName, !!av.videoOff, stale);
      });

      // Only remove tiles for peers we never tracked on this call (not known / no overlay)
      [...grid.querySelectorAll('.ss-av-tile')].forEach(tile => {
        const uid = tile.dataset.uid;
        if (!seen.has(uid)) tile.remove();
      });
    }

    function attachRemoteStream(userId, stream) {
      if (stream) {
        ssRemoteStreams.set(userId, stream);
        ssPeerStale.delete(userId);
        const p = (shareScreenParticipants || []).find(x => x.userId === userId);
        ssKnownCallPeers.set(userId, { name: (p && p.name) || (ssKnownCallPeers.get(userId) || {}).name || 'User' });
      }
      renderSsAvGrid();
    }

    function markSsPeerStale(userId) {
      if (!userId || userId === '__local__') return;
      ssPeerStale.add(userId);
      // Keep last MediaStream reference so video can show last frame; mark UI stale
      renderSsAvGrid();
    }

    function getSsStreamForUid(uid) {
      if (uid === '__local__') return ssLocalStream;
      return ssRemoteStreams.get(uid) || null;
    }

    function syncSsVideoOverlayStream(uid, stream, name, camOff, stale) {
      const entry = ssVideoOverlays.get(uid);
      if (!entry || !entry.el) return;
      const vid = entry.el.querySelector('video');
      if (vid && stream && vid.srcObject !== stream) {
        vid.srcObject = stream;
        vid.play().catch(() => {});
      }
      if (name) {
        const title = entry.el.querySelector('.ss-voverlay-title');
        if (title) title.textContent = name;
      }
      entry.el.classList.toggle('cam-off', !!camOff);
      entry.el.classList.toggle('is-stale', !!stale);
    }

    function openSsVideoOverlay(uid, name) {
      if (!ssInCall) return;
      if (ssVideoOverlays.has(uid)) {
        const existing = ssVideoOverlays.get(uid);
        if (existing && existing.el) {
          ssOverlayZ += 1;
          existing.el.style.zIndex = String(ssOverlayZ);
          existing.el.classList.add('ss-voverlay-flash');
          setTimeout(() => existing.el.classList.remove('ss-voverlay-flash'), 350);
        }
        return;
      }
      const stream = getSsStreamForUid(uid);
      const isLocal = uid === '__local__';
      const vw = Math.max(320, Math.round(window.innerWidth * 0.5));
      const vh = Math.max(240, Math.round(window.innerHeight * 0.5));
      const left = Math.max(12, Math.round((window.innerWidth - vw) / 2) + (ssVideoOverlays.size % 4) * 28);
      const top = Math.max(12, Math.round((window.innerHeight - vh) / 2) + (ssVideoOverlays.size % 4) * 28);

      const el = document.createElement('div');
      el.className = 'ss-voverlay';
      el.dataset.uid = uid;
      el.style.width = vw + 'px';
      el.style.height = vh + 'px';
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      el.style.zIndex = String(++ssOverlayZ);
      el.innerHTML =
        '<div class="ss-voverlay-header">' +
          '<span class="ss-voverlay-title"></span>' +
          '<button type="button" class="ss-voverlay-close" title="Close" aria-label="Close">' +
            '<i class="fa-solid fa-xmark"></i>' +
          '</button>' +
        '</div>' +
        '<div class="ss-voverlay-body">' +
          '<video playsinline autoplay' + (isLocal ? ' muted' : '') + '></video>' +
          '<div class="ss-voverlay-camoff"><i class="fa-solid fa-video-slash"></i></div>' +
          '<div class="ss-voverlay-stale"><div class="ss-av-spinner"></div><span>Reconnecting…</span></div>' +
        '</div>' +
        '<div class="ss-voverlay-resize" title="Drag to resize"></div>';

      const titleEl = el.querySelector('.ss-voverlay-title');
      if (titleEl) titleEl.textContent = name || (isLocal ? 'You' : 'User');

      const vid = el.querySelector('video');
      if (vid && stream) {
        vid.srcObject = stream;
        vid.play().catch(() => {});
      }

      const camOff = isLocal
        ? ssVideoOff
        : !!(ssRemoteAv.get(uid) || {}).videoOff;
      el.classList.toggle('cam-off', camOff);
      const stale = !isLocal && (ssPeerStale.has(uid) || !stream);
      el.classList.toggle('is-stale', stale);

      el.querySelector('.ss-voverlay-close').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeSsVideoOverlay(uid);
      });

      // Bring to front on interaction
      el.addEventListener('pointerdown', () => {
        ssOverlayZ += 1;
        el.style.zIndex = String(ssOverlayZ);
      });

      // Drag by header
      const header = el.querySelector('.ss-voverlay-header');
      let drag = null;
      header.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('.ss-voverlay-close')) return;
        e.preventDefault();
        header.setPointerCapture(e.pointerId);
        drag = {
          startX: e.clientX,
          startY: e.clientY,
          origLeft: el.offsetLeft,
          origTop: el.offsetTop
        };
      });
      header.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        let nl = drag.origLeft + dx;
        let nt = drag.origTop + dy;
        const maxL = window.innerWidth - 80;
        const maxT = window.innerHeight - 40;
        nl = Math.max(-el.offsetWidth + 80, Math.min(maxL, nl));
        nt = Math.max(0, Math.min(maxT, nt));
        el.style.left = nl + 'px';
        el.style.top = nt + 'px';
      });
      const endDrag = () => { drag = null; };
      header.addEventListener('pointerup', endDrag);
      header.addEventListener('pointercancel', endDrag);

      // Resize from bottom-right handle
      const handle = el.querySelector('.ss-voverlay-resize');
      let resize = null;
      handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        handle.setPointerCapture(e.pointerId);
        resize = {
          startX: e.clientX,
          startY: e.clientY,
          origW: el.offsetWidth,
          origH: el.offsetHeight
        };
      });
      handle.addEventListener('pointermove', (e) => {
        if (!resize) return;
        const dx = e.clientX - resize.startX;
        const dy = e.clientY - resize.startY;
        const minW = 220;
        const minH = 160;
        const maxW = Math.max(minW, window.innerWidth - el.offsetLeft - 8);
        const maxH = Math.max(minH, window.innerHeight - el.offsetTop - 8);
        el.style.width = Math.max(minW, Math.min(maxW, resize.origW + dx)) + 'px';
        el.style.height = Math.max(minH, Math.min(maxH, resize.origH + dy)) + 'px';
      });
      const endResize = () => { resize = null; };
      handle.addEventListener('pointerup', endResize);
      handle.addEventListener('pointercancel', endResize);

      document.body.appendChild(el);
      ssVideoOverlays.set(uid, { el, uid, name: name || (isLocal ? 'You' : 'User') });
    }

    function closeSsVideoOverlay(uid) {
      const entry = ssVideoOverlays.get(uid);
      if (!entry) return;
      if (entry.el) {
        const vid = entry.el.querySelector('video');
        if (vid) {
          try { vid.srcObject = null; } catch (_) {}
        }
        entry.el.remove();
      }
      ssVideoOverlays.delete(uid);
    }

    function closeAllSsVideoOverlays() {
      [...ssVideoOverlays.keys()].forEach(closeSsVideoOverlay);
    }

    async function startSsLocalMedia() {
      if (ssLocalStream) {
        ssInCall = true;
        return ssLocalStream;
      }
      try {
        ssLocalStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: 'user' }
        });
      } catch (e) {
        try {
          ssLocalStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          ssVideoOff = true;
        } catch (e2) {
          host.showInfo('Microphone/camera permission is needed for voice & video.');
          ssInCall = false;
          return null;
        }
      }
      ssInCall = true;
      applySsTrackState();
      renderSsAvGrid();
      return ssLocalStream;
    }

    /** Join or rejoin voice/video without affecting share-screen membership */
    async function joinSsCall() {
      if (!activeShareScreen) return;
      if (!host.hasFeature('share_screen_av')) {
        host.showInfo('Voice & video is not enabled for this API key.');
        return;
      }
      const stream = await startSsLocalMedia();
      if (!stream) return;
      ssInCall = true;
      broadcastSsAvState();
      syncSsPeersFromParticipants();
      if (host.getActiveNavAction() === 'sharescreen') renderShareScreenPanel();
      else {
        updateSsAvControlsUi();
        renderSsAvGrid();
      }
    }

    /**
     * End voice/video only. Stay on the share screen (map + drawings still shared).
     * User can rejoin call later via Join call.
     */
    function endSsCall() {
      if (ssLocalStream) {
        ssLocalStream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
        ssLocalStream = null;
      }
      ssPeers.forEach(pc => { try { pc.close(); } catch (_) {} });
      ssPeers.clear();
      ssRemoteStreams.clear();
      ssKnownCallPeers.clear();
      ssPeerStale.clear();
      closeAllSsVideoOverlays();
      // Keep ssRemoteAv for UI hints; clear mic/cam local flags for a clean rejoin
      ssMicMuted = false;
      ssVideoOff = false;
      // Host forced mute still applies if host hasn't released
      ssInCall = false;
      broadcastSsAvState();
      if (host.getActiveNavAction() === 'sharescreen') renderShareScreenPanel();
    }

    function applySsTrackState() {
      if (!ssLocalStream) return;
      ssLocalStream.getAudioTracks().forEach(t => {
        t.enabled = !(ssMicMuted || ssHostForcedMute);
      });
      ssLocalStream.getVideoTracks().forEach(t => {
        t.enabled = !ssVideoOff;
      });
      updateSsAvControlsUi();
      renderSsAvGrid();
      broadcastSsAvState();
    }

    function toggleSsMic() {
      if (!ssInCall) return;
      if (ssHostForcedMute) {
        host.showInfo('Your microphone was muted by the session host.');
        return;
      }
      ssMicMuted = !ssMicMuted;
      applySsTrackState();
    }

    function toggleSsCam() {
      if (!ssInCall) return;
      ssVideoOff = !ssVideoOff;
      applySsTrackState();
    }

    function broadcastSsAvState() {
      if (!shareScreenWs || shareScreenWs.readyState !== 1) return;
      try {
        shareScreenWs.send(JSON.stringify({
          type: 'av-state',
          from: host.getUserId(),
          userId: host.getUserId(),
          audioMuted: !ssInCall || !!(ssMicMuted || ssHostForcedMute),
          videoOff: !ssInCall || !!ssVideoOff,
          inCall: !!ssInCall
        }));
      } catch (_) {}
    }

    function stopSsLocalMedia() {
      endSsCall();
      ssHostForcedMute = false;
      ssRemoteAv.clear();
      ssInCall = false;
    }

    function ssSendSignal(to, data) {
      if (!shareScreenWs || shareScreenWs.readyState !== 1) return;
      try {
        shareScreenWs.send(JSON.stringify({
          type: 'signal',
          to,
          from: host.getUserId(),
          data
        }));
      } catch (_) {}
    }

    async function ensureSsPeer(remoteId, polite) {
      if (!remoteId || remoteId === host.getUserId()) return null;
      if (!ssInCall) return null;
      if (ssPeers.has(remoteId)) return ssPeers.get(remoteId);
      await startSsLocalMedia();
      if (!ssLocalStream) return null;
      const pc = new RTCPeerConnection(SS_RTC_CONFIG);
      ssPeers.set(remoteId, pc);
      if (ssLocalStream) {
        ssLocalStream.getTracks().forEach(track => pc.addTrack(track, ssLocalStream));
      }
      pc.onicecandidate = (ev) => {
        if (ev.candidate) ssSendSignal(remoteId, { ice: ev.candidate });
      };
      pc.ontrack = (ev) => {
        const stream = ev.streams && ev.streams[0];
        if (stream) attachRemoteStream(remoteId, stream);
      };
      pc._ssIceRestarted = false;
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === 'failed' && !pc._ssIceRestarted && ssInCall && ssPeers.get(remoteId) === pc) {
          // One ICE restart attempt (helps after network changes / flaky TURN)
          pc._ssIceRestarted = true;
          pc.createOffer({ iceRestart: true })
            .then(offer => pc.setLocalDescription(offer))
            .then(() => ssSendSignal(remoteId, { sdp: pc.localDescription }))
            .catch(e => console.warn('SS ICE restart failed', e));
          return;
        }
        if (state === 'failed' || state === 'closed') {
          try { pc.close(); } catch (_) {}
          if (ssPeers.get(remoteId) === pc) {
            ssPeers.delete(remoteId);
            // Keep last stream frame + overlay/tile; show reconnecting spinner
            markSsPeerStale(remoteId);
          }
        } else if (state === 'connected' || state === 'connecting') {
          ssPeerStale.delete(remoteId);
          renderSsAvGrid();
        }
      };
      if (polite) {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          ssSendSignal(remoteId, { sdp: pc.localDescription });
        } catch (e) {
          console.warn('SS offer failed', e);
        }
      }
      return pc;
    }

    async function handleSsSignal(msg) {
      const from = msg.from;
      if (!from || from === host.getUserId()) return;
      if (!ssInCall) return; // ignore AV signaling while not on a call
      const data = msg.data || {};
      let pc = ssPeers.get(from);
      if (!pc) {
        // Incoming offer — we answer (not polite initiator)
        pc = await ensureSsPeer(from, false);
      }
      if (!pc) return;
      try {
        if (data.sdp) {
          const desc = data.sdp;
          await pc.setRemoteDescription(desc);
          if (desc.type === 'offer') {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ssSendSignal(from, { sdp: pc.localDescription });
          }
        } else if (data.ice) {
          try { await pc.addIceCandidate(data.ice); } catch (_) {}
        }
      } catch (e) {
        console.warn('SS signal error', e);
      }
    }

    function syncSsPeersFromParticipants() {
      if (!ssInCall) return;
      const me = host.getUserId();
      const ids = (shareScreenParticipants || []).map(u => u.userId).filter(id => id && id !== me);
      [...ssPeers.keys()].forEach(id => {
        if (!ids.includes(id)) {
          try { ssPeers.get(id).close(); } catch (_) {}
          ssPeers.delete(id);
          ssRemoteStreams.delete(id);
        }
      });
      ids.forEach(id => {
        if (ssPeers.has(id)) return;
        const polite = me < id;
        ensureSsPeer(id, polite);
      });
      renderSsAvGrid();
    }

    function hostForceMute(targetUserId, muted) {
      if (!activeShareScreen || !activeShareScreen.isOwner) return;
      if (!shareScreenWs || shareScreenWs.readyState !== 1) return;
      if (muted) ssHostMutedUsers.add(targetUserId);
      else ssHostMutedUsers.delete(targetUserId);
      const av = ssRemoteAv.get(targetUserId) || {};
      ssRemoteAv.set(targetUserId, { ...av, audioMuted: !!muted, hostForced: !!muted });
      try {
        shareScreenWs.send(JSON.stringify({
          type: 'force-mute',
          from: host.getUserId(),
          targetUserId,
          muted: !!muted
        }));
      } catch (_) {}
      if (host.getActiveNavAction() === 'sharescreen') renderShareScreenPanel();
    }

    function hostForceMuteAll(muted) {
      if (!activeShareScreen || !activeShareScreen.isOwner) return;
      if (!shareScreenWs || shareScreenWs.readyState !== 1) return;
      const me = host.getUserId();
      (shareScreenParticipants || []).forEach(u => {
        if (!u || u.userId === me) return;
        if (muted) ssHostMutedUsers.add(u.userId);
        else ssHostMutedUsers.delete(u.userId);
        const av = ssRemoteAv.get(u.userId) || {};
        ssRemoteAv.set(u.userId, { ...av, audioMuted: !!muted, hostForced: !!muted });
      });
      try {
        shareScreenWs.send(JSON.stringify({
          type: 'force-mute-all',
          from: host.getUserId(),
          muted: !!muted
        }));
      } catch (_) {}
      if (host.getActiveNavAction() === 'sharescreen') renderShareScreenPanel();
    }

    function renderShareScreenPanel() {
      const active = activeShareScreen;
      const canCreate = host.hasFeature('share_screen_create');
      let html = '';
      if (active) {
        const link = window.location.origin + '/?screen=' + encodeURIComponent(active.id);
        const exp = active.expiresAt ? new Date(active.expiresAt).toLocaleString() : '—';
        const me = host.getUserId();
        const participants = shareScreenParticipants || [];
        html += '<div class="ss-panel">';

        // Voice/video card — top of the panel (above Live session title)
        html += '<div class="ss-av-card">';
        if (ssInCall) {
          html +=
            '<div class="ss-av-card-head">' +
              '<span class="ss-av-card-title"><i class="fa-solid fa-phone"></i> On call</span>' +
              '<span class="ss-av-card-live">Live</span>' +
            '</div>' +
            '<div class="ss-av-grid" id="ss-av-grid"></div>' +
            '<div class="ss-av-controls" id="ss-av-controls">' +
              '<button type="button" class="ss-av-btn" id="ss-btn-mic" title="Mute"><i class="fa-solid fa-microphone"></i></button>' +
              '<button type="button" class="ss-av-btn" id="ss-btn-cam" title="Camera"><i class="fa-solid fa-video"></i></button>' +
              '<button type="button" class="ss-av-btn ss-av-btn-danger" id="ss-btn-end-call" title="End call (stay on the map session)"><i class="fa-solid fa-phone-slash"></i></button>' +
            '</div>' +
            '<p class="ss-hint-text ss-av-footnote">End call stops voice &amp; video only. You stay in the share screen.</p>';
        } else {
          html +=
            '<div class="ss-av-card-head">' +
              '<span class="ss-av-card-title"><i class="fa-solid fa-video"></i> Voice &amp; video</span>' +
            '</div>' +
            '<p class="ss-hint-text" style="margin:0 0 8px">Optional — join the call to talk with others on this map session.</p>' +
            '<button type="button" class="text-action ss-join-call-btn" id="ss-btn-join-call"><i class="fa-solid fa-phone"></i> Join call</button>';
        }
        html += '</div>';

        html +=
            '<div class="ss-panel-hero">' +
              '<div class="ss-panel-kicker">Live session</div>' +
              '<h3 class="ss-panel-title">' + host.escapeHtml(active.name || 'Share screen') + '</h3>' +
              '<p class="ss-panel-meta">Expires ' + host.escapeHtml(exp) + '</p>' +
            '</div>' +
            '<div class="ss-panel-block">' +
              '<label class="ss-label">Invite link</label>' +
              '<div class="ss-link-row">' +
                '<input type="text" id="ss-link" readonly value="' + host.escapeHtml(link) + '" />' +
                '<button type="button" class="ss-icon-btn" id="ss-copy" title="Copy"><i class="fa-solid fa-copy"></i></button>' +
              '</div>' +
            '</div>';
        if (active.passcode) {
          html +=
            '<div class="ss-panel-block">' +
              '<label class="ss-label">Join code</label>' +
              '<div class="ss-link-row">' +
                '<input type="text" id="ss-passcode" readonly value="' + host.escapeHtml(active.passcode) + '" />' +
                '<button type="button" class="ss-icon-btn" id="ss-copy-pass" title="Copy code"><i class="fa-solid fa-copy"></i></button>' +
              '</div>' +
              '<p class="ss-hint-text" style="margin-top:6px">Share this code (e.g. <strong>204 kjg</strong>) so others can join without the link.</p>' +
            '</div>';
        }
        html +=
            '<div class="ss-panel-actions ss-panel-actions-row">' +
              '<button type="button" class="text-action tip-btn" id="ss-fit" data-tooltip="Full view"><i class="fa-solid fa-expand"></i> Full view</button>' +
              (active.isOwner
                ? '<span class="text-action-sep">|</span><button type="button" class="text-action tip-btn" id="ss-extend" data-tooltip="Extend duration"><i class="fa-solid fa-clock"></i> Extend</button>'
                : '') +
              '<span class="text-action-sep">|</span>' +
              '<button type="button" class="text-action tip-btn ss-leave-btn" id="ss-leave" data-tooltip="Leave session"><i class="fa-solid fa-right-from-bracket"></i> Leave session</button>' +
            '</div>' +
            '<div class="ss-panel-block">' +
              '<div class="ss-part-head">' +
                '<span><i class="fa-solid fa-users"></i> On this screen</span>' +
                '<span class="ss-part-count">' + participants.length + '</span>' +
              '</div>';
        if (active.isOwner) {
          html +=
            '<div class="ss-host-tools">' +
              '<button type="button" class="ss-chip is-warn" id="ss-mute-all"><i class="fa-solid fa-microphone-slash"></i> Mute all</button>' +
              '<button type="button" class="ss-chip" id="ss-unmute-all"><i class="fa-solid fa-microphone"></i> Allow mics</button>' +
            '</div>';
        }
        html += '<ul class="ss-participant-list">';
        if (!participants.length) {
          html += '<li class="ss-empty">Waiting for others…</li>';
        } else {
          participants.forEach(u => {
            const isMe = u.userId === me;
            const av = ssRemoteAv.get(u.userId) || {};
            const hostMuted = !isMe && (ssHostMutedUsers.has(u.userId) || av.hostForced);
            const muted = isMe
              ? (!ssInCall || ssMicMuted || ssHostForcedMute)
              : (hostMuted || !!av.audioMuted);
            const inCallHint = isMe
              ? (ssInCall ? (muted ? 'On call · Mic off' : 'On call') : 'Not on call')
              : (av.inCall === false ? 'Not on call' : (muted ? 'Mic off' : 'Mic on'));
            html +=
              '<li class="ss-participant-row" data-uid="' + host.escapeHtml(u.userId) + '">' +
                '<div class="ss-part-main">' +
                  '<span class="ss-avatar"><i class="fa-solid fa-user"></i></span>' +
                  '<div class="ss-part-text">' +
                    '<span class="ss-part-name">' + host.escapeHtml(u.name || 'User') + (isMe ? ' · you' : '') + '</span>' +
                    '<span class="ss-part-sub">' + inCallHint + (av.videoOff || (isMe && ssVideoOff && ssInCall) ? ' · Cam off' : '') + '</span>' +
                  '</div>' +
                '</div>' +
                '<div class="ss-part-actions">' +
                  '<button type="button" class="ss-icon-btn ss-goto tip-btn" data-tooltip="Go to location"><i class="fa-solid fa-location-crosshairs"></i></button>' +
                  (active.isOwner && !isMe
                    ? '<button type="button" class="ss-icon-btn ss-host-mute tip-btn" data-muted="' + (hostMuted ? '1' : '0') + '" data-tooltip="' + (hostMuted ? 'Allow mic' : 'Mute mic') + '">' +
                        '<i class="fa-solid ' + (hostMuted ? 'fa-microphone' : 'fa-microphone-slash') + '"></i></button>'
                    : '') +
                '</div>' +
              '</li>';
          });
        }
        html += '</ul></div></div>';
      } else {
        // Join (all tiers) + Create (enterprise only)
        html +=
          '<div class="ss-panel ss-panel-create">' +
            '<div class="ss-panel-hero">' +
              '<div class="ss-panel-kicker">Share screen</div>' +
              '<h3 class="ss-panel-title">Join a live session</h3>' +
              '<p class="ss-panel-meta">Enter the join code from the host, or open an invite link.</p>' +
            '</div>' +
            '<div class="ss-panel-block">' +
              '<label class="ss-label">Join code</label>' +
              '<div class="ss-code-row">' +
                '<input type="text" id="ss-join-nums" class="ss-input ss-input-nums" inputmode="numeric" maxlength="3" placeholder="204" autocomplete="off" />' +
                '<input type="text" id="ss-join-letters" class="ss-input ss-input-letters" maxlength="3" placeholder="kjg" autocomplete="off" />' +
              '</div>' +
              '<p class="ss-hint-text" style="margin-top:6px">3 numbers + 3 letters (not case sensitive)</p>' +
            '</div>' +
            '<div class="form-actions form-actions-text">' +
              '<button type="button" class="text-action" id="ss-join-by-code"><i class="fa-solid fa-right-to-bracket"></i> Join with code</button>' +
            '</div>';

        if (canCreate) {
          html +=
            '<div class="ss-panel-divider"></div>' +
            '<div class="ss-panel-hero" style="padding-top:4px">' +
              '<h3 class="ss-panel-title" style="font-size:1rem">Create a session</h3>' +
              '<p class="ss-panel-meta">Draw an area, invite the team, talk over voice &amp; video while drawings stay in sync.</p>' +
            '</div>' +
            '<div class="ss-panel-block">' +
              '<label class="ss-label">Session name</label>' +
              '<input type="text" id="ss-name" class="ss-input" placeholder="e.g. Checkpoint North" />' +
            '</div>' +
            '<div class="form-actions form-actions-text">' +
              '<button type="button" class="text-action" id="ss-start-draw"><i class="fa-solid fa-vector-square"></i> Draw area on map</button>' +
            '</div>' +
            '<p class="ss-hint-text">Click corners of the region, then double-click to finish. A join code is generated automatically.</p>';
        } else {
          html +=
            '<p class="ss-hint-text" style="margin-top:16px">Creating a share screen requires an <strong>Enterprise</strong> key. You can still join any session with a code or link.</p>';
        }
        html += '</div>';
      }
      host.genericPanelContent.innerHTML = html;
      updateShareScreenNavBadge();
      if (active && ssInCall) {
        renderSsAvGrid();
        updateSsAvControlsUi();
      }
      if (typeof host.setupTipButtons === 'function') host.setupTipButtons(host.genericPanelContent);

      document.getElementById('ss-copy')?.addEventListener('click', () => {
        const el = document.getElementById('ss-link');
        if (el) {
          navigator.clipboard.writeText(el.value);
          host.showInfo('Link copied');
        }
      });
      document.getElementById('ss-copy-pass')?.addEventListener('click', () => {
        const el = document.getElementById('ss-passcode');
        if (el) {
          navigator.clipboard.writeText(el.value);
          host.showInfo('Join code copied');
        }
      });
      document.getElementById('ss-leave')?.addEventListener('click', () => leaveShareScreen());
      document.getElementById('ss-extend')?.addEventListener('click', () => extendShareScreen());
      document.getElementById('ss-fit')?.addEventListener('click', () => fitShareScreenFullView());
      document.getElementById('ss-btn-mic')?.addEventListener('click', () => toggleSsMic());
      document.getElementById('ss-btn-cam')?.addEventListener('click', () => toggleSsCam());
      document.getElementById('ss-btn-end-call')?.addEventListener('click', () => endSsCall());
      document.getElementById('ss-btn-join-call')?.addEventListener('click', () => joinSsCall());
      document.getElementById('ss-mute-all')?.addEventListener('click', () => hostForceMuteAll(true));
      document.getElementById('ss-unmute-all')?.addEventListener('click', () => hostForceMuteAll(false));
      document.querySelectorAll('.ss-participant-row').forEach(row => {
        const uid = row.getAttribute('data-uid');
        row.querySelector('.ss-goto')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const u = (shareScreenParticipants || []).find(p => p.userId === uid);
          if (u && u.lat != null && u.lon != null && host.getMap()) {
            host.getMap().flyTo({ center: [u.lon, u.lat], zoom: Math.max(host.getMap().getZoom(), 15), essential: true });
          }
        });
        row.querySelector('.ss-host-mute')?.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          const btn = e.currentTarget;
          const currentlyMuted = btn.getAttribute('data-muted') === '1';
          hostForceMute(uid, !currentlyMuted);
        });
      });
      document.getElementById('ss-start-draw')?.addEventListener('click', () => {
        if (!host.hasFeature('share_screen_create')) {
          host.showInfo('Creating a share screen requires an Enterprise plan.');
          return;
        }
        const name = (document.getElementById('ss-name')?.value || '').trim();
        if (!name) {
          alert('Enter a name for the share screen');
          return;
        }
        beginShareScreenDraw(name);
      });
      document.getElementById('ss-join-by-code')?.addEventListener('click', () => joinShareScreenByCode());
      const numsEl = document.getElementById('ss-join-nums');
      const lettersEl = document.getElementById('ss-join-letters');
      if (numsEl) {
        numsEl.addEventListener('input', () => {
          numsEl.value = numsEl.value.replace(/\D/g, '').slice(0, 3);
          if (numsEl.value.length === 3) lettersEl?.focus();
        });
      }
      if (lettersEl) {
        lettersEl.addEventListener('input', () => {
          lettersEl.value = lettersEl.value.replace(/[^a-zA-Z]/g, '').slice(0, 3);
        });
        lettersEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') joinShareScreenByCode();
        });
      }
    }

    async function joinShareScreenByCode() {
      const nums = (document.getElementById('ss-join-nums')?.value || '').trim();
      const letters = (document.getElementById('ss-join-letters')?.value || '').trim();
      if (nums.length !== 3 || letters.length !== 3) {
        host.showInfo('Enter 3 numbers and 3 letters (e.g. 204 kjg)');
        return;
      }
      await ensureUserNameForShareScreen();
      try {
        const res = await fetch('/api/share-screen/join-by-code?api_key=' + encodeURIComponent(host.getApiKey()), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nums, letters })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          host.showInfo(err.error || 'No active session for that code');
          return;
        }
        const data = await res.json();
        await enterShareScreenFromData(data);
      } catch (e) {
        host.showInfo('Could not join: ' + (e.message || e));
      }
    }

    async function enterShareScreenFromData(data) {
      activeShareScreen = {
        id: data.id,
        name: data.name,
        geometry: data.geometry,
        expiresAt: data.expiresAt,
        passcode: data.passcode || null,
        isOwner: data.ownerId === host.getUserId()
      };
      shareScreenConfig = { ...shareScreenConfig, ...(data.config || {}) };
      shareScreenParticipants = data.users || [];
      drawShareScreenOutline(data.geometry);
      try {
        const ring = data.geometry.coordinates[0];
        const bounds = ring.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(ring[0], ring[0]));
        host.getMap().fitBounds(bounds, { padding: 48, maxZoom: 17 });
      } catch (_) {}
      requestShareScreenLocation();
      startShareScreenRealtime();
      host.openSidebarPanel('sharescreen', '<i class="fa-solid fa-display"></i> Share screen');
      renderShareScreenPanel();
    }

    function ensureUserNameForShareScreen() {
      return new Promise((resolve) => {
        if (host.getUserDisplayName()) {
          resolve(host.getUserDisplayName());
          return;
        }
        if (typeof host.openUserNameOverlay === 'function') {
          host.openUserNameOverlay({
            required: true,
            onDone: (n) => resolve(n || 'User')
          });
        } else {
          resolve('User');
        }
      });
    }

    function fitShareScreenFullView() {
      if (!activeShareScreen || !activeShareScreen.geometry || !host.getMap()) return;
      try {
        const ring = activeShareScreen.geometry.coordinates[0];
        const bounds = ring.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(ring[0], ring[0]));
        host.getMap().fitBounds(bounds, { padding: 48, maxZoom: 17, duration: 600 });
      } catch (_) {}
      // Fullscreen the whole app so the left nav stays visible
      const el = document.getElementById('app') || document.documentElement;
      if (!document.fullscreenElement) {
        const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
        if (req) {
          req.call(el).then(() => {
            shareScreenFullscreen = true;
            document.body.classList.add('ss-fullscreen');
            showShareScreenHint('Full view — left nav stays available · Esc to exit');
            setTimeout(hideShareScreenHint, 2800);
            try { host.getMap().resize(); } catch (_) {}
          }).catch(() => {});
        }
      } else {
        try { host.getMap().resize(); } catch (_) {}
      }
    }

    function setupShareScreenFullscreenExit() {
      document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) {
          shareScreenFullscreen = false;
          document.body.classList.remove('ss-fullscreen');
          hideShareScreenHint();
          try { if (host.getMap()) host.getMap().resize(); } catch (_) {}
        } else {
          document.body.classList.add('ss-fullscreen');
          try { if (host.getMap()) host.getMap().resize(); } catch (_) {}
        }
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && shareScreenFullscreen) {
          shareScreenFullscreen = false;
          document.body.classList.remove('ss-fullscreen');
        }
      });
    }

    function beginShareScreenDraw(name) {
      shareScreenMode = true;
      shareScreenCoords = [];
      if (typeof host.setActiveTool === 'function') host.setActiveTool(null);
      showShareScreenDrawGrid();
      showShareScreenHint('Click to add corners of the screen area. Double-click to finish.');
      const onClick = (e) => {
        if (!shareScreenMode) return;
        shareScreenCoords.push([e.lngLat.lng, e.lngLat.lat]);
        updateShareScreenTemp();
      };
      const onDbl = async (e) => {
        e.preventDefault();
        if (!shareScreenMode || shareScreenCoords.length < 3) {
          showShareScreenHint('Need at least 3 points. Keep clicking, then double-click.');
          return;
        }
        host.getMap().off('click', onClick);
        host.getMap().off('dblclick', onDbl);
        shareScreenMode = false;
        hideShareScreenHint();
        easeOutShareScreenDrawGrid();
        const ring = shareScreenCoords.slice();
        ring.push(ring[0]);
        const geometry = { type: 'Polygon', coordinates: [ring] };
        try {
          await ensureUserNameForShareScreen();
          // Seed the session bucket with drawings already inside the region
          const seedItems = collectItemsInGeometry(geometry);
          const res = await fetch('/api/share-screen?api_key=' + encodeURIComponent(host.getApiKey()), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name,
              geometry,
              ownerId: host.getUserId(),
              seedItems
            })
          });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
          const data = await res.json();
          activeShareScreen = {
            id: data.id,
            name: data.name,
            geometry: data.geometry,
            expiresAt: data.expiresAt,
            passcode: data.passcode || null,
            isOwner: true
          };
          ssLastSyncedItemIds = new Set(seedItems.map(it => it.id));
          drawShareScreenOutline(data.geometry);
          startShareScreenRealtime();
          requestShareScreenLocation();
          renderShareScreenPanel();
          host.showInfo(
            data.passcode
              ? 'Share screen created. Code: ' + data.passcode + ' — copy link or code from the panel.'
              : 'Share screen created. Copy the link from the panel.'
          );
        } catch (err) {
          alert('Could not create share screen: ' + (err.message || err));
        }
        shareScreenCoords = [];
        updateShareScreenTemp();
      };
      host.getMap().on('click', onClick);
      host.getMap().on('dblclick', onDbl);
    }

    function showShareScreenDrawGrid() {
      let el = document.getElementById('ss-draw-grid');
      if (!el) {
        el = document.createElement('div');
        el.id = 'ss-draw-grid';
        el.className = 'ss-draw-grid';
        el.setAttribute('aria-hidden', 'true');
        (document.getElementById('map') || document.body).appendChild(el);
      }
      el.classList.remove('ss-draw-grid-out');
      el.style.display = 'block';
      // Force reflow then fade in
      void el.offsetWidth;
      el.classList.add('ss-draw-grid-on');
    }

    function easeOutShareScreenDrawGrid() {
      const el = document.getElementById('ss-draw-grid');
      if (!el) return;
      el.classList.remove('ss-draw-grid-on');
      el.classList.add('ss-draw-grid-out');
      setTimeout(() => {
        el.style.display = 'none';
        el.classList.remove('ss-draw-grid-out');
      }, 500);
    }

    function updateShareScreenTemp() {
      ensureShareScreenSources();
      const coords = shareScreenCoords.slice();
      const features = [];
      if (coords.length >= 2) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: {}
        });
      }
      if (coords.length >= 3) {
        const ring = coords.slice();
        ring.push(ring[0]);
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [ring] },
          properties: { fill: 1 }
        });
      }
      const src = host.getMap().getSource(shareScreenOutlineSourceId + '-temp');
      if (src) src.setData({ type: 'FeatureCollection', features });
    }

    function ensureShareScreenSources() {
      if (!host.getMap().getSource(shareScreenOutlineSourceId + '-temp')) {
        host.getMap().addSource(shareScreenOutlineSourceId + '-temp', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });
        host.getMap().addLayer({
          id: shareScreenOutlineSourceId + '-temp-fill',
          type: 'fill',
          source: shareScreenOutlineSourceId + '-temp',
          filter: ['==', ['get', 'fill'], 1],
          paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.12 }
        });
        host.getMap().addLayer({
          id: shareScreenOutlineSourceId + '-temp-line',
          type: 'line',
          source: shareScreenOutlineSourceId + '-temp',
          paint: { 'line-color': '#2563eb', 'line-width': 2, 'line-dasharray': [2, 2] }
        });
      }
      if (!host.getMap().getSource(shareScreenOutlineSourceId)) {
        host.getMap().addSource(shareScreenOutlineSourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });
        host.getMap().addLayer({
          id: shareScreenOutlineSourceId + '-fill',
          type: 'fill',
          source: shareScreenOutlineSourceId,
          paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.08 }
        });
        host.getMap().addLayer({
          id: shareScreenOutlineSourceId + '-line',
          type: 'line',
          source: shareScreenOutlineSourceId,
          paint: { 'line-color': '#2563eb', 'line-width': 2.5, 'line-dasharray': [3, 2] }
        });
      }
      if (!host.getMap().getSource(shareScreenRemoteSourceId)) {
        host.getMap().addSource(shareScreenRemoteSourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });
        // Polygons / mark-area
        host.getMap().addLayer({
          id: shareScreenRemoteSourceId + '-fill',
          type: 'fill',
          source: shareScreenRemoteSourceId,
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: {
            'fill-color': ['coalesce', ['get', 'color'], '#e11d48'],
            'fill-opacity': 0.25
          }
        });
        host.getMap().addLayer({
          id: shareScreenRemoteSourceId + '-fill-outline',
          type: 'line',
          source: shareScreenRemoteSourceId,
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: {
            'line-color': ['coalesce', ['get', 'color'], '#e11d48'],
            'line-width': 2
          }
        });
        // Generic lines: freehand, polyline, measure, route (exclude fence/barricade — icon posts)
        host.getMap().addLayer({
          id: shareScreenRemoteSourceId + '-line',
          type: 'line',
          source: shareScreenRemoteSourceId,
          filter: [
            'all',
            ['==', ['geometry-type'], 'LineString'],
            ['!', ['in', ['get', 'itemType'], ['literal', ['fence', 'barricade']]]]
          ],
          paint: {
            'line-color': ['coalesce', ['get', 'color'], '#e11d48'],
            'line-width': [
              'case',
              ['==', ['get', 'itemType'], 'route'], 5,
              3
            ],
            'line-opacity': [
              'case',
              ['==', ['get', 'itemType'], 'route'], 0.9,
              1
            ]
          }
        });
        // Fence / barricade base line
        host.getMap().addLayer({
          id: shareScreenRemoteSourceId + '-line-base',
          type: 'line',
          source: shareScreenRemoteSourceId,
          filter: [
            'all',
            ['==', ['geometry-type'], 'LineString'],
            ['in', ['get', 'itemType'], ['literal', ['fence', 'barricade']]]
          ],
          paint: {
            'line-color': ['coalesce', ['get', 'color'], '#5d4037'],
            'line-width': 2,
            'line-opacity': 0.85
          }
        });
        // Fence icon posts (reuse registered images when ready)
        host.getMap().addLayer({
          id: shareScreenRemoteSourceId + '-fence-icons',
          type: 'symbol',
          source: shareScreenRemoteSourceId,
          filter: [
            'all',
            ['==', ['geometry-type'], 'LineString'],
            ['==', ['get', 'itemType'], 'fence']
          ],
          layout: {
            'symbol-placement': 'line',
            'symbol-spacing': 18,
            'icon-image': 'fence-post',
            'icon-size': 0.55,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'icon-rotation-alignment': 'map',
            'icon-pitch-alignment': 'map'
          }
        });
        host.getMap().addLayer({
          id: shareScreenRemoteSourceId + '-barricade-icons',
          type: 'symbol',
          source: shareScreenRemoteSourceId,
          filter: [
            'all',
            ['==', ['geometry-type'], 'LineString'],
            ['==', ['get', 'itemType'], 'barricade']
          ],
          layout: {
            'symbol-placement': 'line',
            'symbol-spacing': 16,
            'icon-image': 'barricade-post',
            'icon-size': 0.55,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'icon-rotation-alignment': 'map',
            'icon-pitch-alignment': 'map'
          }
        });
        // Text labels (Point)
        host.getMap().addLayer({
          id: shareScreenRemoteSourceId + '-text',
          type: 'symbol',
          source: shareScreenRemoteSourceId,
          filter: [
            'all',
            ['==', ['geometry-type'], 'Point'],
            ['==', ['get', 'itemType'], 'text']
          ],
          layout: {
            'text-field': ['coalesce', ['get', 'label'], ['get', 'name'], ''],
            'text-size': 14,
            'text-font': ['Noto Sans Regular'],
            'text-anchor': 'center',
            'text-allow-overlap': true,
            'text-ignore-placement': true,
            'text-optional': false
          },
          paint: {
            'text-color': ['coalesce', ['get', 'color'], '#202124'],
            'text-halo-color': '#ffffff',
            'text-halo-width': 1.5
          }
        });
      }
    }

    function drawShareScreenOutline(geometry) {
      ensureShareScreenSources();
      const src = host.getMap().getSource(shareScreenOutlineSourceId);
      if (src) {
        src.setData({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry, properties: {} }]
        });
      }
    }

    let ssHintEl = null;
    function showShareScreenHint(msg) {
      if (!ssHintEl) {
        ssHintEl = document.createElement('div');
        ssHintEl.className = 'ss-hint';
        (document.getElementById('map-container') || document.body).appendChild(ssHintEl);
      }
      ssHintEl.textContent = msg;
      ssHintEl.style.display = 'block';
    }
    function hideShareScreenHint() {
      if (ssHintEl) ssHintEl.style.display = 'none';
    }


    function requestShareScreenLocation() {
      if (!navigator.geolocation) return;
      // Auto-start movement trail on share screen (no confirm step)
      host.startTrailTracking({ auto: true, shareScreen: true });
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          host.appendTrailPoint(pos.coords.longitude, pos.coords.latitude, pos.coords.accuracy);
          postShareScreenPresence(pos.coords.latitude, pos.coords.longitude);
        },
        () => host.showInfo('Location permission is required to appear on the share screen.'),
        { enableHighAccuracy: true, timeout: 12000 }
      );
      if (window._ssWatchId) navigator.geolocation.clearWatch(window._ssWatchId);
      window._ssWatchId = navigator.geolocation.watchPosition(
        (pos) => {
          host.appendTrailPoint(pos.coords.longitude, pos.coords.latitude, pos.coords.accuracy);
          postShareScreenPresence(pos.coords.latitude, pos.coords.longitude);
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
      );
    }

    // Item ids last pushed to the session bucket (for delete detection)
    let ssLastSyncedItemIds = new Set();

    function pushShareScreenPresence(lat, lon) {
      if (!activeShareScreen) return;
      const payload = {
        type: 'presence',
        userId: host.getUserId(),
        lat: lat != null ? lat : undefined,
        lon: lon != null ? lon : undefined,
        name: host.getUserDisplayName() || 'User',
        trail: host.trailState.coords.length ? host.trailState.coords.slice() : undefined
      };
      if (shareScreenWs && shareScreenWs.readyState === 1) {
        try { shareScreenWs.send(JSON.stringify(payload)); } catch (_) {}
        return;
      }
      fetch('/api/share-screen/' + encodeURIComponent(activeShareScreen.id) + '/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: payload.userId,
          lat: payload.lat,
          lon: payload.lon,
          name: payload.name,
          trail: payload.trail
        })
      }).catch(() => {});
    }

    function postShareScreenPresence(lat, lon) {
      pushShareScreenPresence(lat, lon);
    }

    /**
     * Sync local in-region drawings into the durable session content bucket.
     * Upserts current items; deletes any previously synced ids that are gone.
     */
    function pushShareScreenContent() {
      if (!activeShareScreen) return;
      const items = collectItemsInShareScreen();
      const currentIds = new Set(items.map(it => it.id));
      const removed = [...ssLastSyncedItemIds].filter(id => !currentIds.has(id));
      ssLastSyncedItemIds = currentIds;

      if (shareScreenWs && shareScreenWs.readyState === 1) {
        try {
          if (items.length) {
            shareScreenWs.send(JSON.stringify({
              type: 'content-upsert',
              userId: host.getUserId(),
              items
            }));
          }
          if (removed.length) {
            shareScreenWs.send(JSON.stringify({
              type: 'content-delete',
              userId: host.getUserId(),
              itemIds: removed
            }));
          }
        } catch (_) {}
        return;
      }
      const base = '/api/share-screen/' + encodeURIComponent(activeShareScreen.id);
      if (items.length) {
        fetch(base + '/content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: host.getUserId(), items })
        }).catch(() => {});
      }
      if (removed.length) {
        fetch(base + '/content/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: host.getUserId(), itemIds: removed })
        }).catch(() => {});
      }
    }

    function connectShareScreenWs() {
      if (!activeShareScreen) return;
      disconnectShareScreenWs();
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = proto + '//' + location.host + '/ws/share-screen';
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (_) {
        return;
      }
      shareScreenWs = ws;
      ws.addEventListener('open', () => {
        try {
          const myItems = collectItemsInShareScreen();
          ssLastSyncedItemIds = new Set(myItems.map(it => it.id));
          ws.send(JSON.stringify({
            type: 'join',
            screenId: activeShareScreen.id,
            userId: host.getUserId(),
            name: host.getUserDisplayName() || 'User',
            // Upsert own in-region items into durable bucket (does not wipe others)
            items: myItems
          }));
        } catch (_) {}
        // Voice/video is optional — user joins call from the share-screen panel
        if (ssInCall) {
          syncSsPeersFromParticipants();
          broadcastSsAvState();
        }
      });
      ws.addEventListener('message', (ev) => {
        let data;
        try { data = JSON.parse(ev.data); } catch (_) { return; }
        if (!data) return;
        if (data.type === 'expired') {
          leaveShareScreen(true);
          return;
        }
        if (data.type === 'error') {
          if (data.error) host.showInfo(data.error);
          return;
        }
        if (data.type === 'signal') {
          handleSsSignal(data);
          return;
        }
        if (data.type === 'force-mute') {
          if (data.targetUserId === host.getUserId()) {
            ssHostForcedMute = !!data.muted;
            if (data.muted) {
              ssMicMuted = true;
            } else {
              // Host allowed mic again — clear forced mute and restore mic
              ssHostForcedMute = false;
              ssMicMuted = false;
            }
            applySsTrackState();
            host.showInfo(data.muted ? 'Host muted your microphone' : 'Host allowed your microphone');
            if (host.getActiveNavAction() === 'sharescreen') renderShareScreenPanel();
          }
          return;
        }
        if (data.type === 'force-mute-all') {
          if (!activeShareScreen || activeShareScreen.isOwner) return;
          if (data.muted) {
            ssHostForcedMute = true;
            ssMicMuted = true;
          } else {
            ssHostForcedMute = false;
            ssMicMuted = false;
          }
          applySsTrackState();
          host.showInfo(data.muted ? 'Host muted all microphones' : 'Host allowed microphones');
          if (host.getActiveNavAction() === 'sharescreen') renderShareScreenPanel();
          return;
        }
        if (data.type === 'av-state') {
          const uid = data.userId || data.from;
          if (uid && uid !== host.getUserId()) {
            ssRemoteAv.set(uid, {
              audioMuted: !!data.audioMuted,
              videoOff: !!data.videoOff,
              inCall: data.inCall !== false
            });
            renderSsAvGrid();
            if (host.getActiveNavAction() === 'sharescreen') {
              const list = document.querySelector('.ss-participant-list');
              if (list) renderShareScreenPanel();
            }
          }
          return;
        }
        if (data.type === 'state' || data.id) {
          applyShareScreenState(data);
        }
      });
      ws.addEventListener('close', () => {
        if (shareScreenWs === ws) shareScreenWs = null;
        // soft reconnect while still in a screen
        if (activeShareScreen) {
          setTimeout(() => {
            if (activeShareScreen && !shareScreenWs) connectShareScreenWs();
          }, 2000);
        }
      });
    }

    function disconnectShareScreenWs() {
      if (shareScreenWs) {
        try {
          if (shareScreenWs.readyState === 1) {
            shareScreenWs.send(JSON.stringify({ type: 'leave' }));
          }
          shareScreenWs.close();
        } catch (_) {}
        shareScreenWs = null;
      }
    }

    function applyShareScreenState(data) {
      if (!data) return;
      if (activeShareScreen) {
        activeShareScreen.expiresAt = data.expiresAt;
        activeShareScreen.geometry = data.geometry || activeShareScreen.geometry;
        activeShareScreen.name = data.name || activeShareScreen.name;
        if (data.passcode) activeShareScreen.passcode = data.passcode;
        if (data.ownerId != null) {
          activeShareScreen.isOwner = data.ownerId === host.getUserId();
        }
      }
      if (data.config) shareScreenConfig = { ...shareScreenConfig, ...data.config };
      if (data.geometry) drawShareScreenOutline(data.geometry);
      shareScreenParticipants = data.users || [];
      updateShareScreenUsers(shareScreenParticipants);
      updateShareScreenRemoteItems(data.items || []);
      // Remote movement trails
      const me = host.getUserId();
      const nextRemote = {};
      (data.users || []).forEach(u => {
        if (!u || !u.userId || u.userId === me) return;
        if (Array.isArray(u.trail) && u.trail.length) nextRemote[u.userId] = u.trail;
      });
      host.setRemoteTrails(nextRemote);
      host.renderRemoteTrails();
      updateShareScreenNavBadge();
      syncSsPeersFromParticipants();
      if (host.getActiveNavAction() === 'sharescreen') {
        const list = document.querySelector('.ss-participant-list');
        if (list) renderShareScreenPanel();
      }
    }

    function collectItemsInGeometry(geometry) {
      if (!geometry) return [];
      const out = [];
      const pushIfInside = (item) => {
        if (!item || !item.geojson) return;
        if (item.type === 'group') return;
        const [lng, lat] = host.geomCentroid(item.geojson);
        if (!pointInPolygon([lng, lat], geometry)) return;
        out.push({
          id: item.id,
          type: item.type,
          geojson: item.geojson,
          props: item.props || {},
          userId: host.getUserId(),
          name: host.getUserDisplayName() || null
        });
      };
      host.getUserLayers().forEach(layer => {
        if (!layer.visible) return;
        (layer.items || []).forEach(item => {
          if (item.type === 'group' && item.props && Array.isArray(item.props.members)) {
            item.props.members.forEach(member => pushIfInside(member));
          } else {
            pushIfInside(item);
          }
        });
      });
      return out;
    }

    function collectItemsInShareScreen() {
      if (!activeShareScreen || !activeShareScreen.geometry) return [];
      return collectItemsInGeometry(activeShareScreen.geometry);
    }

    function pointInPolygon(point, polygon) {
      // ray casting for outer ring
      const ring = polygon.type === 'Polygon' ? polygon.coordinates[0] : null;
      if (!ring || ring.length < 3) return false;
      const x = point[0], y = point[1];
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    }

    function startShareScreenRealtime() {
      connectShareScreenWs();
    }

    function stopShareScreenRealtime() {
      disconnectShareScreenWs();
    }

    function updateShareScreenUsers(users) {
      const size = shareScreenConfig.userIconSize || 28;
      const seen = new Set();
      (users || []).forEach(u => {
        if (!u || u.userId === host.getUserId()) return;
        if (u.lat == null || u.lon == null) return;
        seen.add(u.userId);
        const label = u.name || 'User';
        let m = shareScreenUserMarkers[u.userId];
        if (!m) {
          const el = document.createElement('div');
          el.className = 'ss-user-marker';
          el.innerHTML =
            '<span class="ss-user-marker-icon" style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.max(12, size * 0.5) + 'px">' +
              '<i class="fa-solid fa-user"></i>' +
            '</span>' +
            '<span class="ss-user-marker-name"></span>';
          el.querySelector('.ss-user-marker-name').textContent = label;
          m = new maplibregl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([u.lon, u.lat])
            .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML('<strong>' + host.escapeHtml(label) + '</strong>'))
            .addTo(host.getMap());
          shareScreenUserMarkers[u.userId] = m;
        } else {
          m.setLngLat([u.lon, u.lat]);
          const nameEl = m.getElement()?.querySelector('.ss-user-marker-name');
          if (nameEl) nameEl.textContent = label;
          try {
            const popup = m.getPopup();
            if (popup) popup.setHTML('<strong>' + host.escapeHtml(label) + '</strong>');
          } catch (_) {}
        }
      });
      Object.keys(shareScreenUserMarkers).forEach(id => {
        if (!seen.has(id)) {
          try { shareScreenUserMarkers[id].remove(); } catch (_) {}
          delete shareScreenUserMarkers[id];
        }
      });
    }

    function updateShareScreenRemoteItems(items) {
      ensureShareScreenSources();
      // Ensure fence/barricade icons exist before symbol layers try to use them
      try { if (typeof ensureFenceIcons === 'function') ensureFenceIcons(); } catch (_) {}
      const myId = host.getUserId();
      const features = (items || [])
        .filter(it => it && it.userId !== myId && it.geojson)
        .map(it => {
          const props = it.props || {};
          const colorDefault =
            it.type === 'fence' ? '#5d4037' :
            it.type === 'barricade' ? '#e65100' :
            it.type === 'text' ? (props.color || '#202124') :
            '#e11d48';
          return {
            type: 'Feature',
            geometry: it.geojson,
            properties: {
              color: props.color || colorDefault,
              itemType: it.type,
              remoteId: it.id,
              // Text tool stores the string in props.text (and often props.name)
              label: props.text || props.name || '',
              name: props.name || props.text || ''
            }
          };
        });
      const src = host.getMap().getSource(shareScreenRemoteSourceId);
      if (src) src.setData({ type: 'FeatureCollection', features });
    }

    async function extendShareScreen() {
      if (!activeShareScreen || !activeShareScreen.isOwner) return;
      try {
        const res = await fetch('/api/share-screen/' + encodeURIComponent(activeShareScreen.id) + '/extend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerId: host.getUserId() })
        });
        if (!res.ok) throw new Error('Extend failed');
        const data = await res.json();
        activeShareScreen.expiresAt = data.expiresAt;
        renderShareScreenPanel();
        host.showInfo('Share screen extended');
      } catch (e) {
        alert(e.message || 'Could not extend');
      }
    }

    function leaveShareScreen(expired) {
      stopShareScreenRealtime();
      stopSsLocalMedia();
      if (window._ssWatchId) {
        try { navigator.geolocation.clearWatch(window._ssWatchId); } catch (_) {}
        window._ssWatchId = null;
      }
      Object.values(shareScreenUserMarkers).forEach(m => { try { m.remove(); } catch (_) {} });
      shareScreenUserMarkers = {};
      shareScreenParticipants = [];
      ssHostMutedUsers.clear();
      if (host.getMap() && host.getMap().getSource(shareScreenOutlineSourceId)) {
        host.getMap().getSource(shareScreenOutlineSourceId).setData({ type: 'FeatureCollection', features: [] });
      }
      if (host.getMap() && host.getMap().getSource(shareScreenRemoteSourceId)) {
        host.getMap().getSource(shareScreenRemoteSourceId).setData({ type: 'FeatureCollection', features: [] });
      }
      if (document.fullscreenElement) {
        try { document.exitFullscreen(); } catch (_) {}
      }
      document.body.classList.remove('ss-fullscreen');
      activeShareScreen = null;
      ssLastSyncedItemIds = new Set();
      host.setRemoteTrails({});
      host.renderRemoteTrails();
      // Keep local trail visible; stop share-mode auto tracking flag
      if (host.trailState.shareMode) {
        host.trailState.shareMode = false;
        // Don't clear path — user can still see their trail after leaving
        if (host.trailState.status === 'tracking' || host.trailState.status === 'paused') {
          host.trailState.status = 'paused';
        }
      }
      updateShareScreenNavBadge();
      if (expired) host.showInfo('This share screen has expired.');
      if (host.getActiveNavAction() === 'sharescreen') renderShareScreenPanel();
    }

    async function handleShareScreenFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const screenId = params.get('screen');
      if (!screenId) return;
      try {
        await ensureUserNameForShareScreen();
        const res = await fetch('/api/share-screen/' + encodeURIComponent(screenId));
        if (!res.ok) {
          host.showInfo('Share screen not found or expired.');
          return;
        }
        const data = await res.json();
        await enterShareScreenFromData(data);
      } catch (e) {
        console.warn('Share screen join failed', e);
      }
    }

    api.pushShareScreenPresence = typeof pushShareScreenPresence !== "undefined" ? pushShareScreenPresence : null;
    api.postShareScreenPresence = typeof postShareScreenPresence !== "undefined" ? postShareScreenPresence : null;
    api.pushShareScreenContent = typeof pushShareScreenContent !== "undefined" ? pushShareScreenContent : null;
    api.handleShareScreenFromUrl = typeof handleShareScreenFromUrl !== "undefined" ? handleShareScreenFromUrl : null;
    api.setupShareScreenFullscreenExit = typeof setupShareScreenFullscreenExit !== "undefined" ? setupShareScreenFullscreenExit : null;
    api.enterShareScreenFromData = typeof enterShareScreenFromData !== "undefined" ? enterShareScreenFromData : null;
    api.ensureUserNameForShareScreen = typeof ensureUserNameForShareScreen !== "undefined" ? ensureUserNameForShareScreen : null;
    api.renderShareScreenPanel = typeof renderShareScreenPanel !== "undefined" ? renderShareScreenPanel : null;
    api.joinShareScreenByCode = typeof joinShareScreenByCode !== "undefined" ? joinShareScreenByCode : null;
    api.beginShareScreenDraw = typeof beginShareScreenDraw !== "undefined" ? beginShareScreenDraw : null;
    api.leaveShareScreen = typeof leaveShareScreen !== "undefined" ? leaveShareScreen : null;
    api.extendShareScreen = typeof extendShareScreen !== "undefined" ? extendShareScreen : null;
    api.connectShareScreenWs = typeof connectShareScreenWs !== "undefined" ? connectShareScreenWs : null;
    api.disconnectShareScreenWs = typeof disconnectShareScreenWs !== "undefined" ? disconnectShareScreenWs : null;
    api.applyShareScreenState = typeof applyShareScreenState !== "undefined" ? applyShareScreenState : null;
    api.updateShareScreenNavBadge = typeof updateShareScreenNavBadge !== "undefined" ? updateShareScreenNavBadge : null;
    api.requestShareScreenLocation = typeof requestShareScreenLocation !== "undefined" ? requestShareScreenLocation : null;
    api.startShareScreenRealtime = typeof startShareScreenRealtime !== "undefined" ? startShareScreenRealtime : null;
    api.stopShareScreenRealtime = typeof stopShareScreenRealtime !== "undefined" ? stopShareScreenRealtime : null;
    Object.defineProperty(api, 'activeShareScreen', {
      get: function () { return activeShareScreen; },
      set: function (v) { activeShareScreen = v; }
    });
    Object.defineProperty(api, 'shareScreenMode', {
      get: function () { return shareScreenMode; },
      set: function (v) { shareScreenMode = v; }
    });

    api._installed = true;
    api._host = host;
    Mahp.share.screen = api;
    return api;
  }

  Mahp.share.screen = Mahp.share.screen || {};
  Mahp.share.screen.install = install;
})(typeof window !== 'undefined' ? window : globalThis);
