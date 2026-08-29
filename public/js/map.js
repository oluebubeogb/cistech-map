(function () {
  // ---- Core modules (public/js/core/*) — loaded before this file ----
  // Aliases keep the rest of this file working without a mass rename.
  const getApiKey = Mahp.getApiKey;
  const hasFeature = Mahp.hasFeature;
  const hideEl = Mahp.hideEl;
  const applyFeatureFlags = Mahp.applyFeatureFlags;
  const loadJSON = Mahp.loadJSON;
  const saveJSON = Mahp.saveJSON;
  const escapeHtml = Mahp.escapeHtml;
  const makeCircleIconEl = Mahp.makeCircleIconEl;
  const showInfo = Mahp.showInfo;
  function setEnabledFeatures(list) { Mahp.setEnabledFeatures(list); }
  // Measure mode lives in analysis/measure.js
  function measureModeActive() {
    return !!(Mahp.measure && Mahp.measure.isActive && Mahp.measure.isActive());
  }
  function getCurrentTool() {
    return (Mahp.drawing && Mahp.drawing.tools && Mahp.drawing.tools.getCurrentTool)
      ? Mahp.drawing.tools.getCurrentTool() : null;
  }
  function setActiveTool(tool) {
    if (Mahp.drawing && Mahp.drawing.tools && Mahp.drawing.tools.setActiveTool) {
      Mahp.drawing.tools.setActiveTool(tool);
    }
  }
  function isDrawingActive() {
    return !!(Mahp.drawing && Mahp.drawing.tools && Mahp.drawing.tools.getIsDrawing &&
      Mahp.drawing.tools.getIsDrawing());
  }

  let map;
  let iconsConfig = {};
  let searchPinConfig = { color: '#2563eb', size: 32, borderColor: '#ffffff', borderWidth: 3 };
  let poiIconsConfig = null;
  let searchMarker = null;
  let poiMarkers = []; // circle markers for POIs
  let markedAreas = []; // { id, name, color, geojson } — user-marked areas, up to maxMarkedAreas
  let markedAreaColors = ['#e11d48', '#2563eb', '#16a34a'];
  let maxMarkedAreas = 3;

  // ---------- User Layers system ----------
  // Each layer: { id, name, visible, locked, opacity (0–0.8), items: [] }
  // item: { id, type, geojson, props }
  // Opacity is stored as 0–0.8; UI shows 0–80 (default / max 80).
  const MAX_LAYER_OPACITY = 0.8;
  const DEFAULT_LAYER_OPACITY = 0.8;
  let userLayers = [];
  let activeLayerId = null;
  let labelsOnTop = true;
  // currentTool / drawCoords / isDrawing owned by drawing/tools.js
  let selectedItemIds = new Set();
  let activeColor = '#1a73e8';
  let expandedLayers = new Set();
  let clickMarker = null;
  let pendingTextLngLat = null;
  let textMarkers = []; // HTML markers for user text tool (reliable rendering)
  // Undo / redo — stack owned by core/history.js (Mahp.history)
  // Map drag move / resize of selected items
  let isMovingItems = false;
  let moveStartLngLat = null;
  let moveSnapshot = null;
  let isResizingItems = false;
  let resizeStartLngLat = null;
  let resizeCentroid = null;
  let resizeSnapshot = null;
  let fenceIconsReady = false;

  // Satellite is capped at this zoom (Esri World Imagery tiles stop here).
  // Labels get force-shown (ignoring collision) starting 2 zooms before this,
  // so names that would otherwise be dropped for overlap aren't just missing
  // once you're near the top of the zoom range.
  const SAT_MAX_ZOOM = 17;
  const LABEL_FORCE_ZOOM = SAT_MAX_ZOOM - 2;

  // ---------- Left nav + sidebar panel ----------
  const sidebarPanel = document.getElementById('sidebar-panel');
  const sidebarPanelTitle = document.getElementById('sidebar-panel-title');
  const layersContent = document.getElementById('layers-content');
  const genericPanelContent = document.getElementById('generic-panel-content');
  let activeNavAction = null;

  const LS_SAVED = 'mahp_saved_views';
  const LS_RECENTS = 'mahp_recents';
  const LS_CONTRIBUTIONS = 'mahp_contributions';
  const LS_USER_ID = 'mahp_user_id';
  const LS_USER_NAME = 'mahp_user_name';

  function getUserId() {
    let id = localStorage.getItem(LS_USER_ID);
    if (!id) {
      id = 'u_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(LS_USER_ID, id);
    }
    return id;
  }

  function getUserDisplayName() {
    try {
      const n = (localStorage.getItem(LS_USER_NAME) || '').trim();
      return n || '';
    } catch (_) { return ''; }
  }

  function setUserDisplayName(name) {
    const n = String(name || '').trim().slice(0, 40);
    try {
      if (n) localStorage.setItem(LS_USER_NAME, n);
      else localStorage.removeItem(LS_USER_NAME);
    } catch (_) {}
    updateUserNameToolbarUi();
    try { if (typeof pushShareScreenPresence === 'function' && getActiveShareScreen()) pushShareScreenPresence(); } catch (_) {}
    return n;
  }

  function timeOfDayGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  function updateUserNameToolbarUi() {
    const btn = document.getElementById('btn-user-name');
    if (!btn) return;
    const n = getUserDisplayName();
    if (n) {
      btn.classList.add('has-name');
      btn.setAttribute('data-tooltip', timeOfDayGreeting() + ', ' + n);
      btn.title = timeOfDayGreeting() + ', ' + n;
    } else {
      btn.classList.remove('has-name');
      btn.setAttribute('data-tooltip', 'Your name');
      btn.title = 'Your name';
    }
  }

  function openUserNameOverlay(opts) {
    // exposed for mobile shell
    const options = opts || {};
    let existing = document.getElementById('user-name-overlay');
    if (existing) existing.remove();
    const current = getUserDisplayName();
    const el = document.createElement('div');
    el.id = 'user-name-overlay';
    el.className = 'user-name-overlay';
    el.innerHTML =
      '<div class="user-name-card">' +
        '<button type="button" class="user-name-close" title="Close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>' +
        '<div class="user-name-icon"><i class="fa-solid fa-user"></i></div>' +
        '<p class="user-name-caption">' +
          (current
            ? escapeHtml(timeOfDayGreeting()) + ', <strong>' + escapeHtml(current) + '</strong>'
            : 'Hi there! What\'s your name?') +
        '</p>' +
        '<input type="text" id="user-name-input" class="user-name-input" maxlength="40" placeholder="Your name" value="' + escapeHtml(current) + '" autocomplete="nickname" />' +
        '<div class="user-name-actions">' +
          '<button type="button" class="text-action" id="user-name-save"><i class="fa-solid fa-check"></i> Save</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    const input = el.querySelector('#user-name-input');
    setTimeout(() => { try { input.focus(); input.select(); } catch (_) {} }, 50);
    const finish = (saved) => {
      el.remove();
      if (typeof options.onDone === 'function') options.onDone(saved);
    };
    el.querySelector('.user-name-close')?.addEventListener('click', () => {
      if (options.required && !getUserDisplayName()) return;
      finish(getUserDisplayName());
    });
    el.querySelector('#user-name-save')?.addEventListener('click', () => {
      const v = (input.value || '').trim();
      if (!v) {
        if (options.required) {
          input.focus();
          return;
        }
        setUserDisplayName('');
        finish('');
        return;
      }
      setUserDisplayName(v);
      finish(v);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') el.querySelector('#user-name-save')?.click();
      if (e.key === 'Escape' && !options.required) finish(getUserDisplayName());
    });
  }

  Mahp.openUserNameOverlay = openUserNameOverlay;

  function setupUserNameTool() {
    const btn = document.getElementById('btn-user-name');
    if (!btn) return;
    btn.addEventListener('click', () => openUserNameOverlay({}));
    updateUserNameToolbarUi();
  }


  function setActiveNav(action) {
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.action === action);
    });
    activeNavAction = action;
  }

  function openSidebarPanel(action, titleHtml) {
    setActiveNav(action);
    sidebarPanel.style.display = 'flex';
    sidebarPanelTitle.innerHTML = titleHtml;
    if (action === 'layers') {
      layersContent.style.display = 'block';
      genericPanelContent.style.display = 'none';
      genericPanelContent.innerHTML = '';
      if (typeof renderLayersList === 'function') renderLayersList();
    } else {
      layersContent.style.display = 'none';
      genericPanelContent.style.display = 'block';
    }
  }

  function closeSidebarPanel() {
    sidebarPanel.style.display = 'none';
    setActiveNav(null);
    layersContent.style.display = 'none';
    genericPanelContent.style.display = 'none';
    genericPanelContent.innerHTML = '';
  }

  document.getElementById('sidebar-panel-close').addEventListener('click', closeSidebarPanel);

  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const action = item.dataset.action;
      if (activeNavAction === action && sidebarPanel.style.display !== 'none') {
        closeSidebarPanel();
        return;
      }
      handleNavAction(action);
    });
  });

  function handleNavAction(action) {
    const navFeat = {
      layers: 'layers', saved: 'saved_views', recents: 'recents',
      location: 'trail', landmarks: 'nearest_landmark',
      share: 'share_embed', sharescreen: 'share_screen',
      missing: 'missing_place', business: 'business', edit: 'map_edit'
    };
    if (navFeat[action] && !hasFeature(navFeat[action])) {
      showInfo('This feature is not enabled for the current API key.');
      return;
    }
    if (action === 'contributions' && !hasFeature('missing_place') && !hasFeature('business') && !hasFeature('map_edit')) {
      showInfo('This feature is not enabled for the current API key.');
      return;
    }
    switch (action) {
      case 'layers':
        openSidebarPanel('layers', '<i class="fa-solid fa-layer-group"></i> Workspace');
        break;
      case 'saved':
        openSidebarPanel('saved', '<i class="fa-solid fa-bookmark"></i> Saved');
        renderSavedPanel();
        break;
      case 'recents':
        openSidebarPanel('recents', '<i class="fa-solid fa-clock-rotate-left"></i> Recents');
        renderRecentsPanel();
        break;
      case 'contributions':
        openSidebarPanel('contributions', '<i class="fa-solid fa-pen-to-square"></i> Your contributions');
        renderContributionsPanel();
        break;
      case 'location':
        openSidebarPanel('location', '<i class="fa-solid fa-person-walking"></i> Movement trail');
        renderTrailPanel();
        break;
      case 'landmarks':
        openSidebarPanel('landmarks', '<i class="fa-solid fa-landmark"></i> Nearest landmarks');
        renderLandmarksPanel();
        loadLandmarkCategories().then(() => {
          if (activeNavAction === 'landmarks') renderLandmarksPanel();
          if (!landmarksState.results.length && !landmarksState.loading) fetchNearestLandmarks();
        });
        break;
      case 'share':
        openSidebarPanel('share', '<i class="fa-solid fa-share-nodes"></i> Share or embed');
        renderSharePanel();
        break;
      case 'sharescreen':
        openSidebarPanel('sharescreen', '<i class="fa-solid fa-display"></i> Share screen');
        renderShareScreenPanel();
        break;
      case 'missing':
        openSidebarPanel('missing', '<i class="fa-solid fa-map-pin"></i> Add a missing place');
        renderSubmissionForm('missing_place');
        break;
      case 'business':
        openSidebarPanel('business', '<i class="fa-solid fa-store"></i> Add your business');
        renderSubmissionForm('business');
        break;
      case 'edit':
        openSidebarPanel('edit', '<i class="fa-solid fa-pen"></i> Edit the map');
        renderSubmissionForm('map_edit');
        break;
      default:
        break;
    }
  }

  function renderSavedPanel() {
    const views = loadJSON(LS_SAVED, []);
    let html = '<div class="panel-toolbar"><button type="button" class="text-action" id="btn-save-current-view"><i class="fa-solid fa-plus"></i> Save current map view</button></div>';
    if (!views.length) {
      html += '<div class="panel-empty">No saved views yet. Save the current map screen to return to it later.</div>';
    } else {
      html += '<ul class="panel-list">';
      views.forEach((v, i) => {
        html += '<li class="panel-list-item" data-idx="' + i + '"><i class="fa-solid fa-map"></i><div class="item-meta"><div class="item-title">' + escapeHtml(v.name || 'Saved view') + '</div><div class="item-sub">Zoom ' + (v.zoom != null ? Number(v.zoom).toFixed(1) : '') + ' · ' + new Date(v.ts).toLocaleString() + '</div></div><button type="button" class="icon-btn btn-del-saved" data-idx="' + i + '" title="Remove"><i class="fa-solid fa-xmark"></i></button></li>';
      });
      html += '</ul>';
    }
    genericPanelContent.innerHTML = html;
    document.getElementById('btn-save-current-view')?.addEventListener('click', () => {
      if (!map) return;
      const c = map.getCenter();
      const name = prompt('Name this view', 'View ' + new Date().toLocaleDateString()) || ('View ' + new Date().toLocaleDateString());
      const list = loadJSON(LS_SAVED, []);
      list.unshift({ name: name, center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), ts: Date.now() });
      saveJSON(LS_SAVED, list.slice(0, 50));
      renderSavedPanel();
    });
    genericPanelContent.querySelectorAll('.panel-list-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.btn-del-saved')) return;
        const v = loadJSON(LS_SAVED, [])[+el.dataset.idx];
        if (v && map) map.flyTo({ center: v.center, zoom: v.zoom, bearing: v.bearing || 0, pitch: v.pitch || 0, essential: true });
      });
    });
    genericPanelContent.querySelectorAll('.btn-del-saved').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const list = loadJSON(LS_SAVED, []);
        list.splice(+btn.dataset.idx, 1);
        saveJSON(LS_SAVED, list);
        renderSavedPanel();
      });
    });
  }

  function addRecentSearch(query, result) {
    if (Mahp.search && Mahp.search.addRecentSearch) Mahp.search.addRecentSearch(query, result);
  }

  function renderRecentsPanel() {
    const recents = loadJSON(LS_RECENTS, []);
    if (!recents.length) {
      genericPanelContent.innerHTML = '<div class="panel-empty">No recent searches yet. Search for a place to see it here.</div>';
      return;
    }
    let html = '<div class="panel-toolbar panel-toolbar-split">' +
      '<span class="panel-toolbar-label">History</span>' +
      '<button type="button" class="text-action text-action-sm" id="btn-clear-recents"><i class="fa-solid fa-trash-can"></i> Clear all</button>' +
      '</div><ul class="panel-list">';
    recents.forEach((r, i) => {
      html += '<li class="panel-list-item" data-idx="' + i + '"><i class="fa-solid fa-magnifying-glass"></i><div class="item-meta"><div class="item-title">' + escapeHtml(r.name || r.q) + '</div><div class="item-sub">' + escapeHtml(r.q) + ' · ' + new Date(r.ts).toLocaleString() + '</div></div><button type="button" class="icon-btn btn-del-recent" data-idx="' + i + '" title="Remove"><i class="fa-solid fa-xmark"></i></button></li>';
    });
    html += '</ul>';
    genericPanelContent.innerHTML = html;
    genericPanelContent.querySelectorAll('.panel-list-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.btn-del-recent')) return;
        const r = loadJSON(LS_RECENTS, [])[+el.dataset.idx];
        if (!r) return;
        const input = document.getElementById('search-input');
        if (input) { input.value = r.q; input.dispatchEvent(new Event('input', { bubbles: true })); }
        if (r.lat != null && r.lon != null && map) map.flyTo({ center: [r.lon, r.lat], zoom: Math.max(map.getZoom(), 15), essential: true });
      });
    });
    genericPanelContent.querySelectorAll('.btn-del-recent').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const list = loadJSON(LS_RECENTS, []);
        list.splice(+btn.dataset.idx, 1);
        saveJSON(LS_RECENTS, list);
        renderRecentsPanel();
      });
    });
    document.getElementById('btn-clear-recents')?.addEventListener('click', () => { saveJSON(LS_RECENTS, []); renderRecentsPanel(); });
  }

  function getContributions() { return loadJSON(LS_CONTRIBUTIONS, []); }
  function saveContributionLocal(entry) {
    const list = getContributions();
    list.unshift(entry);
    saveJSON(LS_CONTRIBUTIONS, list.slice(0, 100));
  }

  function renderContributionsPanel() {
    const list = getContributions();
    if (!list.length) {
      genericPanelContent.innerHTML = '<div class="panel-empty">You haven\'t submitted any places, businesses, or map edits yet.<br><br>Use “Add a missing place”, “Add your business”, or “Edit the map”.</div>';
      return;
    }
    let html = '<ul class="panel-list">';
    list.forEach(c => {
      const status = c.status || 'pending';
      const icon = c.type === 'business' ? 'fa-store' : (c.type === 'map_edit' ? 'fa-pen' : 'fa-map-pin');
      html += '<li class="panel-list-item"><i class="fa-solid ' + icon + '"></i><div class="item-meta"><div class="item-title">' + escapeHtml(c.name || c.title || 'Submission') + '</div><div class="item-sub"><span class="status-badge ' + status + '">' + status + '</span> · ' + new Date(c.ts).toLocaleString() + '</div></div></li>';
    });
    html += '</ul>';
    genericPanelContent.innerHTML = html;
  }

  function renderSubmissionForm(type) {
    const c = map ? map.getCenter() : { lng: 7.49, lat: 5.53 };
    genericPanelContent.innerHTML = '<form class="panel-form" id="submission-form">' +
      '<label>Name / Title *</label><input type="text" name="name" required placeholder="' + (type === 'business' ? 'Business name' : (type === 'map_edit' ? 'What should change?' : 'Place name')) + '" />' +
      '<label>Description</label><textarea name="description" placeholder="Details, address, notes…"></textarea>' +
      '<label>Category</label><select name="category"><option value="general">General</option><option value="business">Business</option><option value="landmark">Landmark</option><option value="road">Road / Street</option><option value="school">School</option><option value="hospital">Hospital / Clinic</option><option value="market">Market</option><option value="other">Other</option></select>' +
      '<label>Coordinates (click map to update)</label><div class="coord-row"><input type="number" step="any" name="lat" id="sub-lat" value="' + c.lat.toFixed(6) + '" required /><input type="number" step="any" name="lon" id="sub-lon" value="' + c.lng.toFixed(6) + '" required /></div>' +
      '<p class="form-hint">Click anywhere on the map to set the location. Your submission is saved in this browser immediately and sent for review.</p>' +
      '<div class="form-actions form-actions-text">' +
      '<button type="submit" class="text-action"><i class="fa-solid fa-paper-plane"></i> Submit</button>' +
      '<span class="text-action-sep">|</span>' +
      '<button type="button" class="text-action" id="btn-cancel-sub"><i class="fa-solid fa-xmark"></i> Cancel</button>' +
      '</div></form>';

    // Keep updating lat/lon on every map click while the form is open
    if (map && renderSubmissionForm._onMapClick) {
      map.off('click', renderSubmissionForm._onMapClick);
    }
    const onMapClick = (e) => {
      const latEl = document.getElementById('sub-lat');
      const lonEl = document.getElementById('sub-lon');
      if (latEl && lonEl) {
        latEl.value = e.lngLat.lat.toFixed(6);
        lonEl.value = e.lngLat.lng.toFixed(6);
      }
    };
    renderSubmissionForm._onMapClick = onMapClick;
    if (map) map.on('click', onMapClick);

    document.getElementById('btn-cancel-sub')?.addEventListener('click', () => {
      if (map) map.off('click', onMapClick);
      closeSidebarPanel();
    });

    document.getElementById('submission-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const entry = {
        id: 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        type: type,
        name: String(fd.get('name') || '').trim(),
        description: String(fd.get('description') || '').trim(),
        category: String(fd.get('category') || 'general'),
        lat: parseFloat(fd.get('lat')),
        lon: parseFloat(fd.get('lon')),
        status: 'pending',
        userId: getUserId(),
        ts: Date.now()
      };
      if (!entry.name) return;
      saveContributionLocal(entry);
      try {
        await fetch('/api/submissions?api_key=' + encodeURIComponent(getApiKey()), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) });
      } catch (_) {}
      if (map) map.off('click', onMapClick);
      try {
        new maplibregl.Marker({ color: '#f59e0b' }).setLngLat([entry.lon, entry.lat])
          .setPopup(new maplibregl.Popup().setHTML('<strong>' + escapeHtml(entry.name) + '</strong><br><small>Pending review</small>'))
          .addTo(map);
      } catch (_) {}
      openSidebarPanel('contributions', '<i class="fa-solid fa-pen-to-square"></i> Your contributions');
      renderContributionsPanel();
    });
  }

  let shareTarget = null; // { lat, lon, name }
  let sharePickMode = false;
  let shareTargetMarker = null;

  // Share/embed links intentionally do NOT carry the current session's real
  // API key. A publicly shared or embedded link should never grant paid-tier
  // access to whoever opens it, and it should never expose a real secret key
  // in a copy-pasteable URL/iframe (anyone could pull it from view-source and
  // reuse it directly against the API). Omitting api_key here means the
  // link/embed falls back to the free-tier demo key server-side — every
  // shared link opens at free tier regardless of the sharer's own plan.
  // Once accounts exist, a logged-in viewer's own account tier can override
  // this server-side without changing anything about the link itself.
  function buildShareUrls(target) {
    const origin = window.location.origin;
    if (!target) {
      return {
        link: origin + '/',
        embed: '<iframe src="' + origin + '/embed" width="100%" height="480" style="border:0" allowfullscreen loading="lazy"></iframe>'
      };
    }
    const q = new URLSearchParams();
    q.set('lat', Number(target.lat).toFixed(6));
    q.set('lon', Number(target.lon).toFixed(6));
    if (target.name) q.set('name', target.name);
    q.set('directions', '1');
    const link = origin + '/?' + q.toString();
    const embedSrc = origin + '/embed?' + q.toString();
    return {
      link,
      embed: '<iframe src="' + embedSrc + '" width="100%" height="480" style="border:0" allowfullscreen loading="lazy"></iframe>'
    };
  }

  function updateShareFields() {
    const urls = buildShareUrls(shareTarget);
    const linkEl = document.getElementById('share-link');
    const embedEl = document.getElementById('embed-code');
    if (linkEl) linkEl.value = urls.link;
    if (embedEl) embedEl.value = urls.embed;
  }

  function setShareTarget(lat, lon, name) {
    shareTarget = { lat: +lat, lon: +lon, name: name || (shareTarget && shareTarget.name) || '' };
    if (shareTargetMarker) {
      try { shareTargetMarker.remove(); } catch (_) {}
    }
    if (map) {
      shareTargetMarker = new maplibregl.Marker({ color: '#e11d48' })
        .setLngLat([shareTarget.lon, shareTarget.lat])
        .setPopup(new maplibregl.Popup().setHTML(
          '<strong>' + escapeHtml(shareTarget.name || 'Shared location') + '</strong>'
        ))
        .addTo(map);
    }
    updateShareFields();
    const latEl = document.getElementById('share-lat');
    const lonEl = document.getElementById('share-lon');
    if (latEl) latEl.value = Number(shareTarget.lat).toFixed(6);
    if (lonEl) lonEl.value = Number(shareTarget.lon).toFixed(6);
  }

  function renderSharePanel() {
    const c = map ? map.getCenter() : { lat: 5.53, lng: 7.49 };
    if (!shareTarget) {
      shareTarget = { lat: c.lat, lon: c.lng, name: '' };
    }
    const urls = buildShareUrls(shareTarget);
    genericPanelContent.innerHTML =
      '<div class="panel-form">' +
      '<p class="form-hint" style="margin-top:0">Share a target on the map. Recipients open the link and can route from <em>their</em> location to this point — all inside Mahp.</p>' +
      '<label>Label (optional)</label>' +
      '<input type="text" id="share-target-name" placeholder="e.g. Shop front, Meeting point, Office" value="' + escapeHtml(shareTarget.name || '') + '" />' +
      '<label style="margin-top:12px">Target coordinates</label>' +
      '<div class="coord-row coord-row-with-tools">' +
      '<input type="number" step="any" id="share-lat" value="' + Number(shareTarget.lat).toFixed(6) + '" />' +
      '<input type="number" step="any" id="share-lon" value="' + Number(shareTarget.lon).toFixed(6) + '" />' +
      '<button type="button" class="tip-btn" id="btn-pick-target" data-tooltip="Pick on map"><i class="fa-solid fa-map-pin"></i></button>' +
      '<button type="button" class="tip-btn" id="btn-use-center" data-tooltip="Use map center"><i class="fa-solid fa-crosshairs"></i></button>' +
      '</div>' +
      '<div class="share-copy-row">' +
      '<button type="button" class="text-action" id="btn-copy-share"><i class="fa-solid fa-link"></i> Copy link</button>' +
      '<span class="text-action-sep">|</span>' +
      '<button type="button" class="text-action" id="btn-copy-embed"><i class="fa-solid fa-code"></i> Copy embed</button>' +
      '</div>' +
      '<input type="hidden" id="share-link" value="" />' +
      '<textarea readonly id="embed-code" rows="3" class="embed-code-quiet"></textarea>' +
      '</div>';

    document.getElementById('share-link').value = urls.link;
    document.getElementById('embed-code').value = urls.embed;

    document.getElementById('share-target-name')?.addEventListener('input', (e) => {
      if (shareTarget) shareTarget.name = e.target.value;
      updateShareFields();
    });
    const syncCoordsFromInputs = () => {
      const lat = parseFloat(document.getElementById('share-lat').value);
      const lon = parseFloat(document.getElementById('share-lon').value);
      if (!isNaN(lat) && !isNaN(lon)) {
        setShareTarget(lat, lon, document.getElementById('share-target-name')?.value || '');
      }
    };
    document.getElementById('share-lat')?.addEventListener('change', syncCoordsFromInputs);
    document.getElementById('share-lon')?.addEventListener('change', syncCoordsFromInputs);

    document.getElementById('btn-use-center')?.addEventListener('click', () => {
      if (!map) return;
      const center = map.getCenter();
      setShareTarget(center.lat, center.lng, document.getElementById('share-target-name')?.value || '');
    });

    document.getElementById('btn-pick-target')?.addEventListener('click', () => {
      sharePickMode = true;
      showDestPickHint('Click the map to set the shared target');
      showInfo('<strong>Pick target</strong><p style="margin-top:8px;font-size:0.9rem;color:#5f6368">Click anywhere on the map to set the location people will navigate to.</p>');
    });

    document.getElementById('btn-copy-share')?.addEventListener('click', () => {
      navigator.clipboard.writeText(document.getElementById('share-link').value);
      showInfo('Link copied');
    });
    document.getElementById('btn-copy-embed')?.addEventListener('click', () => {
      navigator.clipboard.writeText(document.getElementById('embed-code').value);
      showInfo('Embed code copied');
    });

    setShareTarget(shareTarget.lat, shareTarget.lon, shareTarget.name);
    setupTipButtons(genericPanelContent);
  }

  function showDestPickHint(text) {
    let el = document.getElementById('dest-pick-hint');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dest-pick-hint';
      el.className = 'dest-pick-hint';
      document.getElementById('map-container').appendChild(el);
    }
    el.textContent = text || '';
    el.style.display = text ? 'block' : 'none';
  }

  let destMarker = null;
  let destRouteSourceId = 'shared-dest-route';

  function clearDestRoute() {
    if (!map) return;
    try {
      if (map.getLayer(destRouteSourceId)) map.removeLayer(destRouteSourceId);
      if (map.getSource(destRouteSourceId)) map.removeSource(destRouteSourceId);
    } catch (_) {}
  }

  function showDestinationCard(dest) {
    let card = document.getElementById('dest-directions-card');
    if (!card) {
      card = document.createElement('div');
      card.id = 'dest-directions-card';
      card.className = 'dest-directions-card';
      document.getElementById('map-container').appendChild(card);
    }
    card.innerHTML =
      '<h4><i class="fa-solid fa-location-dot" style="color:#e11d48"></i> ' + escapeHtml(dest.name || 'Shared location') + '</h4>' +
      '<div class="dest-meta">' + Number(dest.lat).toFixed(5) + ', ' + Number(dest.lon).toFixed(5) + '</div>' +
      '<div class="dest-meta" id="dest-route-status">Route from your location to this point.</div>' +
      '<div class="dest-actions">' +
      '<button type="button" class="btn-primary" id="btn-directions-from-me"><i class="fa-solid fa-route"></i> Directions from me</button>' +
      '<button type="button" class="btn-secondary" id="btn-dest-dismiss">Dismiss</button>' +
      '</div>';
    card.style.display = 'block';

    document.getElementById('btn-dest-dismiss')?.addEventListener('click', () => {
      card.style.display = 'none';
      clearDestRoute();
    });
    document.getElementById('btn-directions-from-me')?.addEventListener('click', () => {
      routeFromMyLocationTo(dest);
    });
  }

  function routeFromMyLocationTo(dest) {
    const status = document.getElementById('dest-route-status');
    if (status) status.textContent = 'Getting your location…';
    if (!navigator.geolocation) {
      if (status) status.textContent = 'Geolocation not supported on this device.';
      return;
    }
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const fromLat = pos.coords.latitude;
      const fromLon = pos.coords.longitude;
      if (status) status.textContent = 'Calculating route…';
      try {
        const url = '/api/route?from_lat=' + fromLat + '&from_lon=' + fromLon +
          '&to_lat=' + dest.lat + '&to_lon=' + dest.lon + '&api_key=' + encodeURIComponent(getApiKey());
        const res = await fetch(url);
        const data = await res.json();
        const coords = (data.coordinates || (data.geometry && data.geometry.coordinates)) ||
          [[fromLon, fromLat], [dest.lon, dest.lat]];
        clearDestRoute();
        map.addSource(destRouteSourceId, {
          type: 'geojson',
          data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }
        });
        map.addLayer({
          id: destRouteSourceId,
          type: 'line',
          source: destRouteSourceId,
          paint: { 'line-color': '#1a73e8', 'line-width': 5, 'line-opacity': 0.9 }
        });
        const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
        map.fitBounds(bounds, { padding: 64, maxZoom: 16 });
        const dist = data.distance_km != null ? data.distance_km : (data.properties && data.properties.distance_km);
        const dur = data.duration_min != null ? data.duration_min : (data.properties && data.properties.duration_min);
        let msg = dist != null ? dist.toFixed(1) + ' km' : 'Route ready';
        if (dur != null) msg += ' · ~' + dur + ' min drive';
        if (status) status.textContent = msg;
        new maplibregl.Marker({ color: '#16a34a' }).setLngLat([fromLon, fromLat]).addTo(map);
      } catch (err) {
        if (status) status.textContent = 'Could not calculate route. Try again.';
      }
    }, () => {
      if (status) status.textContent = 'Location permission denied. Allow location to get directions.';
    }, { enableHighAccuracy: true, timeout: 12000 });
  }

  function handleSharedDestinationFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const lat = parseFloat(params.get('lat'));
    const lon = parseFloat(params.get('lon'));
    if (isNaN(lat) || isNaN(lon)) return;
    const name = params.get('name') || '';
    const wantDirections = params.get('directions') === '1' || params.get('dir') === '1';
    const dest = { lat, lon, name };
    if (map) {
      destMarker = new maplibregl.Marker({ color: '#e11d48' })
        .setLngLat([lon, lat])
        .setPopup(new maplibregl.Popup().setHTML('<strong>' + escapeHtml(name || 'Shared location') + '</strong>'))
        .addTo(map);
      map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 14), essential: true });
    }
    showDestinationCard(dest);
    if (wantDirections) {
      setTimeout(() => routeFromMyLocationTo(dest), 600);
    }
  }



  function setupRouteBridge() {
    if (Mahp.state) Mahp.state.map = map;
    Mahp.route.configure({
      showInfo: showInfo,
      commitDraw: function (t, g, p) { return commitDraw(t, g, p); },
      getActiveColor: function () { return activeColor; },
      setActiveTool: setActiveTool,
      getCurrentTool: getCurrentTool,
      isDrawing: isDrawingActive,
      isMeasureActive: measureModeActive
    });
    Mahp.route.setup();
  }

  function setupDrawingBridge() {
    if (Mahp.state) Mahp.state.map = map;
    // Layers are wired via installLayersBridge(host.refs) — no model.configure.
    Mahp.drawing.tools.configure({
      getActiveLayer: function () { return getActiveLayer(); },
      commitDraw: function (t, g, p) { return commitDraw(t, g, p); },
      getActiveColor: function () { return activeColor; }
    });
    Mahp.drawing.tools.setup();
    // install() already exposes syncToMap on Mahp.layers
    if (Mahp.layers && typeof Mahp.layers.syncToMap === 'function') {
      // keep local name in sync if module reassigns
      Mahp.layers.syncToMap = Mahp.layers.syncUserLayersToMap || Mahp.layers.syncToMap;
    }
  }



  function installLayersBridge() {
    if (Mahp.state) Mahp.state.map = map;
    // Live refs object — mutations in the module update map.js locals
    var refs = {
      get userLayers() { return userLayers; },
      set userLayers(v) { userLayers = v; },
      get activeLayerId() { return activeLayerId; },
      set activeLayerId(v) { activeLayerId = v; },
      get expandedLayers() { return expandedLayers; },
      set expandedLayers(v) { expandedLayers = v; },
      get selectedItemIds() { return selectedItemIds; },
      set selectedItemIds(v) { selectedItemIds = v; },
      get labelsOnTop() { return labelsOnTop; },
      set labelsOnTop(v) { labelsOnTop = v; },
      get textMarkers() { return textMarkers; },
      set textMarkers(v) { textMarkers = v; },
      get fenceIconsReady() { return fenceIconsReady; },
      set fenceIconsReady(v) { fenceIconsReady = v; }
    };
    Mahp.layers.install({
      getMap: function () { return map; },
      refs: refs,
      getActiveColor: function () { return activeColor; },
      DEFAULT_LAYER_OPACITY: DEFAULT_LAYER_OPACITY,
      MAX_LAYER_OPACITY: MAX_LAYER_OPACITY,
      showInfo: showInfo,
      removeMarkedAreasByIds: function (ids) {
        markedAreas = markedAreas.filter(a => !ids.includes(a.id));
        try { updateMarkedAreasSource(); } catch (_) {}
        try { renderMarkedAreaList(); } catch (_) {}
      },
      pushShareScreenPresence: function () { return pushShareScreenPresence(); },
      pushShareScreenContent: function () { return pushShareScreenContent(); },
      getActiveShareScreen: function () { return getActiveShareScreen(); }
    });
  }

  function installShareScreenBridge() {
    if (Mahp.state) Mahp.state.map = map;
    Mahp.share.screen.install({
      getMap: function () { return map; },
      getUserLayers: function () { return userLayers; },
      showInfo: showInfo,
      getUserId: getUserId,
      getUserDisplayName: getUserDisplayName,
      setUserDisplayName: setUserDisplayName,
      trailState: trailState,
      getRemoteTrails: function () { return remoteTrails; },
      setRemoteTrails: function (v) { remoteTrails = v; },
      renderRemoteTrails: function () { return renderRemoteTrails(); },
      getActiveNavAction: function () { return activeNavAction; },
      openSidebarPanel: openSidebarPanel,
      escapeHtml: escapeHtml,
      hasFeature: hasFeature,
      getApiKey: getApiKey,
      genericPanelContent: genericPanelContent,
      geomCentroid: geomCentroid,
      setupTipButtons: setupTipButtons,
      setActiveTool: setActiveTool,
      getCurrentTool: getCurrentTool,
      openUserNameOverlay: openUserNameOverlay,
      startTrailTracking: function (opts) { return startTrailTracking(opts); },
      appendTrailPoint: function (lng, lat, accuracy) { return appendTrailPoint(lng, lat, accuracy); }
    });
  }

  function setupHistoryBridge() {
    Mahp.history.configure({
      getSnapshot: function () {
        return {
          userLayers: userLayers,
          activeLayerId: activeLayerId,
          selectedItemIds: Array.from(selectedItemIds),
          markedAreas: markedAreas
        };
      },
      applySnapshot: function (snap) {
        userLayers = snap.userLayers || [];
        activeLayerId = snap.activeLayerId;
        selectedItemIds = new Set(snap.selectedItemIds || []);
        markedAreas = snap.markedAreas || [];
        ensureDefaultLayer();
        updateMarkedAreasSource();
        renderMarkedAreaList();
        renderLayersList();
        syncUserLayersToMap();
      }
    });
    Mahp.history.setupKeyboard();
  }

  function setupMeasureBridge() {
    Mahp.measure.configure({
      showInfo: showInfo,
      getActiveLayer: function () { return getActiveLayer(); },
      commitDraw: function (type, geom, props) { return commitDraw(type, geom, props); },
      getActiveColor: function () { return activeColor; }
    });
    // Ensure measure module sees the map instance
    if (Mahp.state) Mahp.state.map = map;
    Mahp.measure.setup();
  }

  function setupSearchBridge() {
    if (Mahp.state) {
      Mahp.state.map = map;
      Mahp.state.iconsConfig = iconsConfig;
      Mahp.state.searchPinConfig = searchPinConfig;
    }
    Mahp.search.configure({
      iconForType: function (type) { return iconForType(type); }
    });
    Mahp.search.setup();
  }

  async function init() {
    let config, style, styleMeta;
    try {
      const boot = await Mahp.fetchMapBootstrap();
      config = boot.config;
      style = boot.style;
      styleMeta = boot.styleMeta;
    } catch (err) {
      Mahp.showInvalidKeyScreen(err && err.message);
      return;
    }

    // The server always resolves a key now (falling back to the bundled demo
    // key when none is supplied in the URL), so enabledFeatures is always a
    // real allow-list from that key's record — never "unrestricted".
    setEnabledFeatures(Array.isArray(config.enabledFeatures) ? config.enabledFeatures : null);

    Mahp.applyStyleMeta(config, styleMeta);
    // Keep local vars in sync during the transition away from the monolith.
    iconsConfig = Mahp.state.iconsConfig;
    searchPinConfig = Mahp.state.searchPinConfig;
    poiIconsConfig = Mahp.state.poiIconsConfig;
    markedAreaColors = Mahp.state.markedAreaColors;
    maxMarkedAreas = Mahp.state.maxMarkedAreas;

    map = Mahp.createMap({
      style: style,
      center: config.center || [7.4896, 5.5263],
      zoom: config.zoom || 13
    });

    map.on('load', () => {
      ensureFenceIcons();
      loadIndexLabels();
      loadPoiMarkers();
      // The base style's own 'place-labels' (baked in from the vector tiles) duplicates
      // what index-labels-place already shows and can name the same spot differently,
      // so it stays hidden for good. 'road-labels' is handled separately, inside
      // loadIndexLabels/showMissingRoadLabels, which filters it down to only the road
      // names missing from our index instead of hiding it outright.
      if (map.getLayer('place-labels')) {
        try { map.setLayoutProperty('place-labels', 'visibility', 'none'); } catch (_) {}
      }
    });

    map.on('zoom', updatePoiVisibility);
    map.on('zoomend', updatePoiVisibility);

    // Run feature bridges independently so one missing/stub module cannot
    // abort the rest of desktop (and mobile) initialization.
    function safe(label, fn) {
      try { fn(); } catch (e) { console.warn('[mahp] ' + label, e); }
    }
    safe('search', setupSearchBridge);
    safe('measure', setupMeasureBridge);
    safe('markArea', setupMarkArea);
    safe('layers', installLayersBridge);
    safe('shareScreen', installShareScreenBridge);
    safe('route', setupRouteBridge);
    safe('satellite', setupSatellite);
    safe('3d', setup3DView);
    safe('layersUI', setupLayers);
    safe('drawing', setupDrawingBridge);
    safe('colorPalette', setupColorPalette);
    safe('userName', setupUserNameTool);
    safe('coordClick', setupCoordClick);
    safe('itemTransform', setupItemTransform);
    safe('history', setupHistoryBridge);
    safe('keyboard', setupKeyboardShortcuts);
    safe('lineEditHover', setupLineEditHover);
    safe('areaGroup', setupAreaAndGroupButtons);
    safe('navTooltips', setupNavTooltips);
    safe('shareFullscreen', setupShareScreenFullscreenExit);
    safe('branding', function () { applyBranding(config); });
    safe('featureFlags', function () { applyFeatureFlags(config); });
    safe('sharedDest', handleSharedDestinationFromUrl);
    safe('shareScreenUrl', handleShareScreenFromUrl);
    safe('historyPush', function () { Mahp.history.push(); });

    // Everything above has already applied the resolved key's real feature
    // set to the DOM (toolbar buttons, nav items, etc.) — only now is it
    // safe to reveal the app, so a lower-tier key never gets a glimpse of
    // the full UI before it's stripped down.
    Mahp.endBoot();
    try {
      if (Mahp.ui && Mahp.ui.mobile && Mahp.ui.mobile.shell) Mahp.ui.mobile.shell.setup();
    } catch (e) { console.warn('mobile shell', e); }
  }

  function setupAreaAndGroupButtons() {
    const areaBtn = document.getElementById('btn-area');
    if (areaBtn) {
      areaBtn.addEventListener('click', () => {
        setActiveTool(null);
        showAreaForSelection();
      });
    }
    const groupBtn = document.getElementById('btn-group');
    if (groupBtn) {
      groupBtn.addEventListener('click', () => {
        setActiveTool(null);
        groupSelectedItems();
      });
    }
  }


  function setupTipButtons(root) {
    const scope = root || document;
    let tip = document.getElementById('nav-float-tooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'nav-float-tooltip';
      tip.className = 'nav-float-tooltip';
      document.body.appendChild(tip);
    }
    scope.querySelectorAll('.tip-btn[data-tooltip]').forEach(btn => {
      if (btn.dataset.tipBound) return;
      btn.dataset.tipBound = '1';
      btn.addEventListener('mouseenter', () => {
        const label = btn.getAttribute('data-tooltip');
        if (!label) return;
        tip.textContent = label;
        tip.classList.add('visible');
        const r = btn.getBoundingClientRect();
        // Prefer above; fall back below if near top
        const above = r.top > 36;
        tip.style.left = Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2) + 'px';
        tip.style.top = above
          ? (r.top - tip.offsetHeight - 8) + 'px'
          : (r.bottom + 8) + 'px';
      });
      btn.addEventListener('mouseleave', () => tip.classList.remove('visible'));
      btn.addEventListener('click', () => tip.classList.remove('visible'));
    });
  }

  function setupNavTooltips() {
    const tip = document.createElement('div');
    tip.className = 'nav-float-tooltip';
    document.body.appendChild(tip);
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.add('nav-tip-js');
    document.querySelectorAll('.sidebar-nav .nav-item[data-tooltip]').forEach(btn => {
      btn.addEventListener('mouseenter', () => {
        const label = btn.getAttribute('data-tooltip');
        if (!label) return;
        tip.textContent = label;
        tip.classList.add('visible');
        const r = btn.getBoundingClientRect();
        tip.style.left = (r.right + 10) + 'px';
        tip.style.top = (r.top + r.height / 2 - tip.offsetHeight / 2) + 'px';
      });
      btn.addEventListener('mouseleave', () => tip.classList.remove('visible'));
      btn.addEventListener('click', () => tip.classList.remove('visible'));
    });
  }

  function applyBranding(config) {
    if (config.title) {
      document.title = config.title;
    }
    // Attribution
    const attr = document.getElementById('map-attribution');
    if (attr && config.attributionHtml) {
      attr.innerHTML = config.attributionHtml;
    } else if (attr && config.attributionText) {
      attr.textContent = config.attributionText;
    }
    // Site / logo icon
    if (config.siteIconUrl) {
      document.querySelectorAll('.logo').forEach(el => {
        el.innerHTML = '<img src="' + config.siteIconUrl + '" alt="logo" />';
      });
      let link = document.querySelector('link[rel="icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = config.siteIconUrl;
    }
  }

  function iconForType(type) {
    return iconsConfig[type] || iconsConfig.default || { fa: 'fa-map-marker-alt', color: '#e74c3c' };
  }

  function poiStyleForType(type) {
    const cfg = poiIconsConfig || {};
    const defaults = cfg.defaults || {};
    const t = (type || 'default').toLowerCase();
    return defaults[t] || defaults.default || { fa: 'fa-circle', bg: '#64748b' };
  }


  function clearSearchMarker() {
    if (Mahp.search && Mahp.search.clearSearchMarker) Mahp.search.clearSearchMarker();
    searchMarker = null;
  }

  function createSearchMarker(lon, lat, name) {
    if (Mahp.search && Mahp.search.createSearchMarker) {
      Mahp.search.createSearchMarker(lon, lat, name);
      searchMarker = Mahp.state && Mahp.state.searchMarker;
    }
  }

  // ---------- POI markers from places index ----------
  async function loadPoiMarkers() {
    if (!hasFeature('poi_markers')) return;
    if (!poiIconsConfig) return;
    const enabled = new Set((poiIconsConfig.enabledTypes || []).map(t => t.toLowerCase()));
    if (!enabled.size) return;

    try {
      const res = await fetch('/api/places-geojson?api_key=' + encodeURIComponent(getApiKey()));
      if (!res.ok) return;
      const geojson = await res.json();
      const features = geojson.features || [];

      // Limit markers for performance
      const maxMarkers = 400;
      let count = 0;

      for (const f of features) {
        if (count >= maxMarkers) break;
        const props = f.properties || {};
        const type = (props.type || '').toLowerCase();
        if (!enabled.has(type) && !enabled.has('poi')) continue;
        // Prefer explicit enabled types
        if (!enabled.has(type) && type !== 'poi') continue;

        const [lon, lat] = f.geometry.coordinates;
        const style = poiStyleForType(type);
        const size = poiIconsConfig.circleSize || 28;
        const borderW = poiIconsConfig.borderWidth || 3;

        const el = makeCircleIconEl(style.bg, style.fa, size, borderW, '#ffffff');
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([lon, lat])
          .setPopup(new maplibregl.Popup({ offset: 14 }).setHTML(
            `<strong>${props.display_name || props.name}</strong><br><span style="color:#64748b;text-transform:capitalize">${type}</span>`
          ));

        poiMarkers.push({ marker, el, minZoom: poiIconsConfig.minZoom || 14 });
        count++;
      }

      updatePoiVisibility();
    } catch (e) {
      console.warn('POI markers failed:', e.message);
    }
  }

  function updatePoiVisibility() {
    if (!map || !poiMarkers.length) return;
    const z = map.getZoom();
    poiMarkers.forEach(({ marker, minZoom }) => {
      if (z >= minZoom) {
        if (!marker._map) marker.addTo(map);
      } else {
        marker.remove();
      }
    });
  }

  // ---------- Index labels ----------
  let lastIndexGeojson = null;

  async function loadIndexLabels() {
    if (!hasFeature('labels')) return;
    try {
      const res = await fetch('/api/places-geojson?api_key=' + encodeURIComponent(getApiKey()));
      if (!res.ok) return;
      const geojson = await res.json();
      lastIndexGeojson = geojson;
      if (map.getSource('index-places')) return;

      map.addSource('index-places', { type: 'geojson', data: geojson });

      map.addLayer({
        id: 'index-labels-place',
        type: 'symbol',
        source: 'index-places',
        filter: ['in', ['get', 'type'], ['literal', ['city', 'town', 'village', 'place', 'suburb', 'neighbourhood']]],
        minzoom: 8,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 14, 14],
          'text-font': ['Noto Sans Regular'],
          'text-offset': [0, 0.6],
          'text-anchor': 'top',
          'text-max-width': 10,
          'text-optional': true,
          'text-allow-overlap': ['step', ['zoom'], false, LABEL_FORCE_ZOOM, true],
          'text-ignore-placement': ['step', ['zoom'], false, LABEL_FORCE_ZOOM, true]
        },
        paint: {
          'text-color': '#1e293b',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.4
        }
      });

      map.addLayer({
        id: 'index-labels-street',
        type: 'symbol',
        source: 'index-places',
        filter: ['in', ['get', 'type'], ['literal', ['street', 'road', 'path', 'secondary', 'tertiary', 'primary', 'minor']]],
        minzoom: 11,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 12,
          'text-font': ['Noto Sans Regular'],
          'text-offset': [0, 0.5],
          'text-anchor': 'top',
          'text-max-width': 12,
          'text-optional': false,
          'text-allow-overlap': ['step', ['zoom'], false, LABEL_FORCE_ZOOM - 1, true],
          'text-ignore-placement': ['step', ['zoom'], false, LABEL_FORCE_ZOOM - 1, true]
        },
        paint: {
          'text-color': '#334155',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.3
        }
      });

      map.addLayer({
        id: 'index-labels-poi',
        type: 'symbol',
        source: 'index-places',
        filter: ['!', ['in', ['get', 'type'], ['literal', [
          'city', 'town', 'village', 'place', 'suburb', 'neighbourhood',
          'street', 'road', 'path', 'secondary', 'tertiary', 'primary', 'minor'
        ]]]],
        minzoom: 12,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 12, 11, 16, 13],
          'text-font': ['Noto Sans Regular'],
          'text-offset': [0, 1.05],
          'text-anchor': 'top',
          'text-max-width': 12,
          // Prefer showing names over hiding them when icons/labels collide
          'text-optional': false,
          'text-allow-overlap': ['step', ['zoom'], false, LABEL_FORCE_ZOOM - 1, true],
          'text-ignore-placement': ['step', ['zoom'], false, LABEL_FORCE_ZOOM - 1, true]
        },
        paint: {
          'text-color': '#475569',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.4
        }
      });

      showMissingRoadLabels(geojson);
    } catch (e) {
      console.warn('Index labels not loaded:', e.message);
    }
  }

  // ---------- Missing-road-name flagging ----------
  // Filters the base style's 'road-labels' layer (raw vector-tile road names) down
  // to only the names NOT already present in our own index, and re-styles it so
  // those stand out. This re-uses 'road-labels' rather than re-querying tiles by
  // hand, and is scoped to roads only — place-labels is skipped since the same
  // real-world spot can legitimately carry a different name in each source, which
  // would just read as false positives rather than genuinely missing roads.
  const ROAD_TYPES = ['street', 'road', 'path', 'secondary', 'tertiary', 'primary', 'minor'];

  function showMissingRoadLabels(geojson) {
    if (!map.getLayer('road-labels')) return;

    const indexRoadNames = new Set(
      (geojson.features || [])
        .filter(f => ROAD_TYPES.includes(f.properties && f.properties.type))
        .map(f => (f.properties.name || '').trim().toLowerCase())
        .filter(Boolean)
    );

    map.setFilter('road-labels', [
      '!',
      ['in', ['downcase', ['to-string', ['get', 'name']]], ['literal', [...indexRoadNames]]]
    ]);
    map.setLayoutProperty('road-labels', 'visibility', 'visible');
    // Distinct flag styling so these read as "not in your index yet", not as a
    // second, redundant label set.
    map.setPaintProperty('road-labels', 'text-color', '#111111');
    map.setPaintProperty('road-labels', 'text-halo-color', '#ffffff');
    map.setPaintProperty('road-labels', 'text-halo-width', 1.6);
  }

  // ---------- Mark Area (user-driven: type a name, pick from suggestions, up to maxMarkedAreas at once) ----------
  const DEFAULT_MARK_ZOOM = 17; // used when marking a point (a settlement/city has no area to fit bounds to)
  let markAreaSuggestions = [];
  let markAreaDebounce = null;

  function setupMarkArea() {
    const btn = document.getElementById('btn-mark-area');
    const panel = document.getElementById('mark-area-panel');
    const closeBtn = document.getElementById('mark-area-close');
    const input = document.getElementById('mark-area-input');
    const suggestionsEl = document.getElementById('mark-area-suggestions');

    btn.addEventListener('click', () => {
      const showing = panel.style.display !== 'none';
      panel.style.display = showing ? 'none' : 'block';
      btn.classList.toggle('active', !showing);
      if (!showing) input.focus();
    });

    closeBtn.addEventListener('click', () => {
      panel.style.display = 'none';
      btn.classList.remove('active');
    });

    input.addEventListener('input', () => {
      const q = input.value.trim();
      clearTimeout(markAreaDebounce);
      if (q.length < 2) {
        hideMarkAreaSuggestions();
        return;
      }
      markAreaDebounce = setTimeout(() => fetchMarkAreaSuggestions(q), 200);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && markAreaSuggestions.length) {
        selectMarkAreaSuggestion(markAreaSuggestions[0].id); // Enter picks the top suggestion — still a "click", never raw free text
      } else if (e.key === 'Escape') {
        hideMarkAreaSuggestions();
      }
    });

    document.addEventListener('click', (e) => {
      if (!suggestionsEl.contains(e.target) && e.target !== input) hideMarkAreaSuggestions();
    });

    renderMarkedAreaList();
  }

  async function fetchMarkAreaSuggestions(q) {
    try {
      const res = await fetch(`/api/area-suggest?q=${encodeURIComponent(q)}&api_key=${encodeURIComponent(getApiKey())}`);
      const suggestions = await res.json();
      markAreaSuggestions = suggestions;
      renderMarkAreaSuggestions();
    } catch (e) {
      hideMarkAreaSuggestions();
    }
  }

  function renderMarkAreaSuggestions() {
    const el = document.getElementById('mark-area-suggestions');
    if (!markAreaSuggestions.length) {
      hideMarkAreaSuggestions();
      return;
    }
    el.innerHTML = markAreaSuggestions.map(s => {
      const context = s.level === 'state' || s.level === 'country' ? '' : (s.state || '');
      return `
        <div class="mark-area-suggestion" data-id="${s.id}">
          <span class="suggestion-name">${s.name}</span>
          <span class="suggestion-level">${s.levelLabel}</span>
          ${context ? `<span class="suggestion-context">${context}</span>` : ''}
        </div>
      `;
    }).join('');
    el.querySelectorAll('.mark-area-suggestion').forEach(row => {
      row.addEventListener('click', () => selectMarkAreaSuggestion(row.dataset.id));
    });
    el.style.display = 'block';
  }

  function hideMarkAreaSuggestions() {
    const el = document.getElementById('mark-area-suggestions');
    if (el) { el.style.display = 'none'; el.innerHTML = ''; }
    markAreaSuggestions = [];
  }

  function setMarkAreaStatus(text) {
    const el = document.getElementById('mark-area-status');
    if (el) el.textContent = text || '';
  }

  // Only path that actually adds an area — always from a clicked (or Enter-selected) suggestion, never raw typed text
  async function selectMarkAreaSuggestion(id) {
    hideMarkAreaSuggestions();
    document.getElementById('mark-area-input').value = '';

    const layer = getActiveLayer();
    if (layer.locked) {
      setMarkAreaStatus('Active layer is locked — unlock it or pick another layer.');
      return;
    }
    // Count mark-area items already on the active layer
    const markCount = layer.items.filter(it => it.type === 'mark-area').length;
    if (markCount >= maxMarkedAreas) {
      setMarkAreaStatus(`You can mark up to ${maxMarkedAreas} areas on this layer — remove one to add another.`);
      return;
    }

    setMarkAreaStatus('Loading…');
    try {
      const res = await fetch(`/api/area-boundary/${id}?api_key=${encodeURIComponent(getApiKey())}`);
      const data = await res.json();
      if (!res.ok) {
        setMarkAreaStatus(data.error || 'Could not load that area.');
        return;
      }

      const color = activeColor || markedAreaColors[markCount % markedAreaColors.length];
      // Also keep legacy markedAreas for the mark-area panel list
      const area = { id: `${Date.now()}`, name: data.name, level: data.level, levelLabel: data.levelLabel, color, geojson: data.geometry };
      markedAreas.push(area);
      updateMarkedAreasSource();
      renderMarkedAreaList();

      // Write into the active user layer (thicker border, lighter fill via sync)
      commitDraw('mark-area', data.geometry, {
        color,
        name: data.name,
        level: data.level,
        levelLabel: data.levelLabel
      });

      fitToGeojson(area.geojson);
      setMarkAreaStatus('');
    } catch (e) {
      setMarkAreaStatus('Something went wrong loading that — try again.');
    }
  }

  function removeMarkedArea(id) {
    markedAreas = markedAreas.filter(a => a.id !== id);
    updateMarkedAreasSource();
    renderMarkedAreaList();
    setMarkAreaStatus('');
  }

  function renderMarkedAreaList() {
    const list = document.getElementById('mark-area-list');
    if (!list) return;
    list.innerHTML = markedAreas.map(a => `
      <div class="mark-area-item">
        <span class="mark-area-swatch" style="background:${a.color}"></span>
        <span class="mark-area-name" title="${a.name}">${a.name}${a.levelLabel ? ` — ${a.levelLabel}` : ''}</span>
        <button class="mark-area-remove" data-id="${a.id}" title="Remove"><i class="fa-solid fa-xmark"></i></button>
      </div>
    `).join('');
    list.querySelectorAll('.mark-area-remove').forEach(b => {
      b.addEventListener('click', () => removeMarkedArea(b.dataset.id));
    });
  }

  function updateMarkedAreasSource() {
    const fc = {
      type: 'FeatureCollection',
      features: markedAreas.map(a => ({
        type: 'Feature',
        properties: { id: a.id, name: a.name, color: a.color },
        geometry: a.geojson
      }))
    };

    if (map.getSource('marked-areas')) {
      map.getSource('marked-areas').setData(fc);
      return;
    }
    if (!fc.features.length) return;

    map.addSource('marked-areas', { type: 'geojson', data: fc });

    // beforeId keeps these under the name labels but above the base map fills/roads
    const beforeId = map.getLayer('index-labels-place') ? 'index-labels-place' : undefined;

    // Fill/outline render for Polygon/MultiPolygon features; MapLibre skips
    // Point features on these automatically (no explicit filter needed).
    map.addLayer({
      id: 'marked-areas-fill',
      type: 'fill',
      source: 'marked-areas',
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 }
    }, beforeId);

    map.addLayer({
      id: 'marked-areas-outline',
      type: 'line',
      source: 'marked-areas',
      paint: { 'line-color': ['get', 'color'], 'line-width': 2.5 }
    }, beforeId);

    // No circle/vertex markers — keep marked areas clean (fill + outline only).
    // Point geometries (e.g. settlements) are still stored but intentionally
    // not given a separate marker layer so the map stays clean.
  }

  function fitToGeojson(geojson) {
    if (geojson.type === 'Point') {
      map.flyTo({ center: geojson.coordinates, zoom: DEFAULT_MARK_ZOOM, duration: 600 });
      return;
    }
    const coordsList = geojson.type === 'Polygon' ? geojson.coordinates : geojson.coordinates.flat();
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    coordsList.forEach(ring => ring.forEach(([lng, lat]) => {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }));
    if (minLng < Infinity) {
      map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 60, duration: 600 });
    }
  }

  // ---------- Search (Mahp.search) / Measure (Mahp.measure) ----------

  // ---------- Satellite toggle (Esri World Imagery only) ----------
  let satelliteOn = false;
  let savedMaxZoom = 22;

  function ensureSatelliteLayer() {
    if (map.getSource('esri-satellite')) return;
    map.addSource('esri-satellite', {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256,
      minzoom: 0,
      maxzoom: SAT_MAX_ZOOM,
      attribution: 'Tiles © Esri — Esri, Maxar, Earthstar Geographics'
    });
    // Place below index labels / road names so names stay on top of imagery
    const beforeId = map.getLayer('index-labels-place')
      ? 'index-labels-place'
      : (map.getLayer('road-labels')
        ? 'road-labels'
        : (map.getLayer('index-labels-street') ? 'index-labels-street' : undefined));
    map.addLayer({
      id: 'esri-satellite-layer',
      type: 'raster',
      source: 'esri-satellite',
      layout: { visibility: 'none' }
      // No layer-level maxzoom here: the source's maxzoom (SAT_MAX_ZOOM) already caps
      // which tiles get fetched, and MapLibre auto-oversamples the last available tile
      // past that. A layer-level maxzoom instead makes the whole layer vanish (whitish
      // gap showing the base map background) once zoom crosses the boundary — that was
      // the bug. Now it just keeps showing the zoom-17 tile scaled up at higher zooms.
    }, beforeId);
  }

  function bringIndexLabelsToTop() {
    // Order matters: regions first (so they sit under text), then labels on top.
    // road-labels (source-layer transportation_name) kept so street names stay on satellite.
    ['marked-areas-fill', 'marked-areas-outline', 'road-labels', 'index-labels-place', 'index-labels-street', 'index-labels-poi'].forEach(id => {
      if (!map.getLayer(id)) return;
      try {
        map.moveLayer(id); // move to top of stack
        map.setLayoutProperty(id, 'visibility', 'visible');
      } catch (_) {}
    });
  }

  function setupSatellite() {
    const btn = document.getElementById('btn-satellite');
    if (!btn) return;

    btn.addEventListener('click', () => {
      if (!map) return;
      ensureSatelliteLayer();

      satelliteOn = !satelliteOn;
      map.setLayoutProperty('esri-satellite-layer', 'visibility', satelliteOn ? 'visible' : 'none');

      // Preserve camera (pitch/bearing) — 3D view applies to both map and satellite
      const keptPitch = map.getPitch();
      const keptBearing = map.getBearing();

      const style = map.getStyle();
      if (style && style.layers) {
        style.layers.forEach(layer => {
          if (!layer.id) return;
          if (layer.id === 'esri-satellite-layer') return;
          if (layer.id.startsWith('user-layer-')) return; // keep drawings / extrusions on both basemaps
          if (layer.id.startsWith('index-labels')) return; // keep names
          if (layer.id.startsWith('marked-areas')) return; // keep user-marked area outlines
          if (layer.id === 'place-labels') return; // stay hidden always; index-labels-place replaces it
          // Keep street names (source-layer transportation_name) visible on satellite
          if (layer.id === 'road-labels') return;
          if (satelliteOn) {
            if (layer.type === 'background' || layer.type === 'fill' || layer.type === 'line' || layer.type === 'symbol') {
              try { map.setLayoutProperty(layer.id, 'visibility', 'none'); } catch (_) {}
            }
          } else {
            try { map.setLayoutProperty(layer.id, 'visibility', 'visible'); } catch (_) {}
          }
        });
      }

      // Restore pitch/bearing after style visibility changes
      try { map.setPitch(keptPitch); map.setBearing(keptBearing); } catch (_) {}

      if (satelliteOn) {
        // Names on top of satellite; minzoom on each layer still controls when they appear
        bringIndexLabelsToTop();
        // Stronger halo so text stays readable on imagery
        ['index-labels-place', 'index-labels-street', 'index-labels-poi', 'road-labels'].forEach(id => {
          if (!map.getLayer(id)) return;
          try {
            map.setPaintProperty(id, 'text-color', '#ffffff');
            map.setPaintProperty(id, 'text-halo-color', '#000000');
            map.setPaintProperty(id, 'text-halo-width', 1.8);
            map.setLayoutProperty(id, 'visibility', 'visible');
          } catch (_) {}
        });
        // Force more street/POI names to show over imagery (collision was dropping many).
        // Clear road-labels filter so ALL transportation_name labels show on satellite,
        // not only the "missing from index" subset used on the vector basemap.
        try {
          if (map.getLayer('road-labels')) {
            map.setFilter('road-labels', null);
            map.setLayoutProperty('road-labels', 'text-allow-overlap', true);
            map.setLayoutProperty('road-labels', 'text-ignore-placement', true);
            map.setLayoutProperty('road-labels', 'symbol-placement', 'line');
          }
          if (map.getLayer('index-labels-poi')) {
            map.setLayoutProperty('index-labels-poi', 'text-allow-overlap', true);
            map.setLayoutProperty('index-labels-poi', 'text-ignore-placement', true);
            map.setLayoutProperty('index-labels-poi', 'text-optional', false);
          }
          if (map.getLayer('index-labels-street')) {
            map.setLayoutProperty('index-labels-street', 'text-allow-overlap', true);
            map.setLayoutProperty('index-labels-street', 'text-ignore-placement', true);
          }
        } catch (_) {}
        savedMaxZoom = map.getMaxZoom() || 22;
        map.setMaxZoom(SAT_MAX_ZOOM);
        if (map.getZoom() > SAT_MAX_ZOOM) map.zoomTo(SAT_MAX_ZOOM);
      } else {
        // Restore normal label colors
        ['index-labels-place', 'index-labels-street', 'index-labels-poi'].forEach(id => {
          if (!map.getLayer(id)) return;
          try {
            map.setPaintProperty(id, 'text-color', id === 'index-labels-place' ? '#1e293b' : (id === 'index-labels-poi' ? '#475569' : '#334155'));
            map.setPaintProperty(id, 'text-halo-color', '#ffffff');
            map.setPaintProperty(id, 'text-halo-width', 1.3);
          } catch (_) {}
        });
        if (map.getLayer('road-labels')) {
          try {
            map.setLayoutProperty('road-labels', 'text-allow-overlap', false);
            map.setLayoutProperty('road-labels', 'text-ignore-placement', false);
          } catch (_) {}
          // Restore "missing from index" filter + amber styling on vector basemap
          if (lastIndexGeojson) {
            try { showMissingRoadLabels(lastIndexGeojson); } catch (_) {}
          } else {
            try {
              map.setPaintProperty('road-labels', 'text-color', '#3a3a3a');
              map.setPaintProperty('road-labels', 'text-halo-color', '#ffffff');
              map.setPaintProperty('road-labels', 'text-halo-width', 1.2);
            } catch (_) {}
          }
        }
        try {
          if (map.getLayer('index-labels-poi')) {
            map.setLayoutProperty('index-labels-poi', 'text-allow-overlap', ['step', ['zoom'], false, LABEL_FORCE_ZOOM, true]);
            map.setLayoutProperty('index-labels-poi', 'text-ignore-placement', ['step', ['zoom'], false, LABEL_FORCE_ZOOM, true]);
            map.setLayoutProperty('index-labels-poi', 'text-optional', true);
          }
          if (map.getLayer('index-labels-street')) {
            map.setLayoutProperty('index-labels-street', 'text-allow-overlap', ['step', ['zoom'], false, LABEL_FORCE_ZOOM, true]);
            map.setLayoutProperty('index-labels-street', 'text-ignore-placement', ['step', ['zoom'], false, LABEL_FORCE_ZOOM, true]);
          }
        } catch (_) {}
        map.setMaxZoom(savedMaxZoom);
      }

      btn.classList.toggle('active', satelliteOn);
      const icon = btn.querySelector('i');
      if (icon) icon.className = satelliteOn ? 'fa-solid fa-map' : 'fa-solid fa-globe';
    });
  }


  // ---------- 3D view (pitch) — applies to map AND satellite ----------
  let view3dOn = false;
  let savedPitch = 60;
  const DEFAULT_3D_PITCH = 60;

  function setup3DView() {
    const btn = document.getElementById('btn-3d');
    if (!btn || !map) return;
    // Reflect current pitch if user already tilted
    if (map.getPitch() > 5) {
      view3dOn = true;
      savedPitch = map.getPitch();
      btn.classList.add('active');
    }
    btn.addEventListener('click', () => {
      if (!map) return;
      view3dOn = !view3dOn;
      if (view3dOn) {
        const pitch = savedPitch >= 15 ? savedPitch : DEFAULT_3D_PITCH;
        map.easeTo({ pitch, duration: 500 });
        btn.classList.add('active');
      } else {
        savedPitch = map.getPitch() || DEFAULT_3D_PITCH;
        map.easeTo({ pitch: 0, duration: 500 });
        btn.classList.remove('active');
      }
    });
    map.on('pitchend', () => {
      const p = map.getPitch();
      if (p > 5) {
        view3dOn = true;
        savedPitch = p;
        btn.classList.add('active');
      } else {
        view3dOn = false;
        btn.classList.remove('active');
      }
    });
  }

  // Route → analysis/route.js (Mahp.route)

  document.getElementById('close-panel').addEventListener('click', () => {
    document.getElementById('info-panel').style.display = 'none';
  });

  // ========== USER LAYERS → layers/render.js (Mahp.layers) ==========
  function uid() {
    return (Mahp.layers && Mahp.layers.uid) ? Mahp.layers.uid() :
      ('L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
  }
  function ensureDefaultLayer() {
    if (Mahp.layers && Mahp.layers.ensureDefaultLayer) return Mahp.layers.ensureDefaultLayer();
  }
  function getActiveLayer() {
    if (Mahp.layers && Mahp.layers.getActiveLayer) return Mahp.layers.getActiveLayer();
    return null;
  }
  function setupLayers() {
    if (Mahp.layers && Mahp.layers.setupLayers) return Mahp.layers.setupLayers();
  }
  function renderLayersList() {
    if (Mahp.layers && Mahp.layers.renderLayersList) return Mahp.layers.renderLayersList();
  }
  function syncUserLayersToMap() {
    if (Mahp.layers && Mahp.layers.syncUserLayersToMap) return Mahp.layers.syncUserLayersToMap();
  }
  function deleteItems(ids) {
    if (Mahp.layers && Mahp.layers.deleteItems) return Mahp.layers.deleteItems(ids);
  }
  function adjustHeightForIds(ids, delta) {
    if (Mahp.layers && Mahp.layers.adjustHeightForIds) return Mahp.layers.adjustHeightForIds(ids, delta);
  }
  function isScalableType(type) {
    return (Mahp.layers && Mahp.layers.isScalableType) ? Mahp.layers.isScalableType(type) : true;
  }
  function isHeightableType(type) {
    return (Mahp.layers && Mahp.layers.isHeightableType) ? Mahp.layers.isHeightableType(type) : false;
  }
  function getItemHeight(item) {
    return (Mahp.layers && Mahp.layers.getItemHeight) ? Mahp.layers.getItemHeight(item) : 0;
  }
  function itemDisplayName(item) {
    if (Mahp.layers && typeof Mahp.layers.itemDisplayName === 'function') {
      return Mahp.layers.itemDisplayName(item);
    }
    if (!item) return 'item';
    if (item.props && item.props.name) return item.props.name;
    if (item.type === 'text' && item.props && item.props.text) return item.props.text;
    if (item.type === 'measure' && item.props && item.props.distance_km != null) {
      return 'Measure ' + item.props.distance_km + ' km';
    }
    if (item.type === 'route' && item.props && item.props.distance_km != null) {
      return 'Route ' + item.props.distance_km + ' km';
    }
    return String(item.type || 'item').replace(/-/g, ' ');
  }
  function applyLabelOrder() {
    if (Mahp.layers && Mahp.layers.applyLabelOrder) return Mahp.layers.applyLabelOrder();
  }
  function ensureFenceIcons() {
    if (Mahp.layers && Mahp.layers.ensureFenceIcons) return Mahp.layers.ensureFenceIcons();
  }
  function exportLayers() {
    if (Mahp.layers && Mahp.layers.exportLayers) return Mahp.layers.exportLayers();
  }
  function importLayers(file) {
    if (Mahp.layers && Mahp.layers.importLayers) return Mahp.layers.importLayers(file);
  }
  function findItemById(id) {
    // still defined later in select section OR in layers - prefer layers after install
    if (Mahp.layers && Mahp.layers.findItemById) return Mahp.layers.findItemById(id);
    for (const layer of userLayers) {
      const item = (layer.items || []).find(it => it.id === id);
      if (item) return { layer, item };
    }
    return null;
  }
  function commitDraw(type, geometry, props = {}) {
    if (Mahp.layers && Mahp.layers.commitDraw) {
      return Mahp.layers.commitDraw(type, geometry, props);
    }
    // fallback minimal
    const layer = getActiveLayer();
    if (!layer || layer.locked) return null;
    const item = {
      id: uid(),
      type,
      geojson: geometry,
      props: Object.assign({ color: activeColor || '#1a73e8' }, props || {})
    };
    layer.items.push(item);
    expandedLayers.add(layer.id);
    Mahp.history.push();
    renderLayersList();
    syncUserLayersToMap();
    return item;
  }

  // ---------- Color palette ----------
  function applyColorToSelection(color) {
    if (!color || !selectedItemIds.size) return false;
    let changed = 0;
    [...selectedItemIds].forEach(id => {
      const found = findItemById(id);
      if (!found || found.layer.locked) return;
      if (!found.item.props) found.item.props = {};
      found.item.props.color = color;
      // Group members
      if (found.item.type === 'group' && Array.isArray(found.item.props.members)) {
        found.item.props.members.forEach(m => {
          if (!m.props) m.props = {};
          m.props.color = color;
        });
      }
      changed++;
    });
    if (changed) {
      Mahp.history.push();
      syncUserLayersToMap();
      renderLayersList();
      try { if (typeof pushShareScreenPresence === 'function') pushShareScreenPresence(); } catch (_) {}
      return true;
    }
    return false;
  }


  function setActiveColor(color) {
    if (!color) return;
    activeColor = color;
    if (Mahp.state) Mahp.state.activeColor = color;
    const palette = document.getElementById('color-palette');
    if (palette) {
      palette.querySelectorAll('.color-swatch').forEach(b => {
        b.classList.toggle('active', b.dataset.color === color);
      });
      const custom = document.getElementById('custom-color');
      if (custom) custom.value = color;
    }
    try { applyColorToSelection(color); } catch (_) {}
  }
  Mahp.setActiveColor = setActiveColor;
  Mahp.getActiveColor = function () { return activeColor; };
  if (Mahp.state) {
    Mahp.state.activeColor = activeColor;
    if (Mahp.state.lineWidth == null) Mahp.state.lineWidth = 3;
  }

  function setupColorPalette() {
    const palette = document.getElementById('color-palette');
    if (!palette) return;
    palette.querySelectorAll('.color-swatch[data-color]').forEach(btn => {
      btn.addEventListener('click', () => {
        setActiveColor(btn.dataset.color);
      });
    });
    const custom = document.getElementById('custom-color');
    if (custom) {
      custom.addEventListener('input', () => {
        setActiveColor(custom.value);
      });
    }
  }

  // ---------- Click coord readout + small adaptive marker ----------
  function setupCoordClick() {
    const readout = document.getElementById('coord-readout');
    const coordText = document.getElementById('coord-text');
    if (!readout || !coordText) return;

    map.on('click', (e) => {
      // Share panel: pick target on map
      if (sharePickMode) {
        sharePickMode = false;
        showDestPickHint('');
        const name = document.getElementById('share-target-name')?.value || '';
        setShareTarget(e.lngLat.lat, e.lngLat.lng, name);
        openSidebarPanel('share', '<i class="fa-solid fa-share-nodes"></i> Share or embed');
        renderSharePanel();
        return;
      }
      // Don't place marker while drawing tools / measure / mark-area panel interactions
      if (getCurrentTool() || measureModeActive()) return;
      const { lng, lat } = e.lngLat;
      coordText.textContent = lat.toFixed(6) + ', ' + lng.toFixed(6);
      readout.style.display = 'block';

      if (clickMarker) clickMarker.remove();
      const el = document.createElement('div');
      el.className = 'coord-click-marker';
      // Size adapts lightly with zoom via CSS + update on zoom
      const size = Math.max(8, Math.min(14, 6 + map.getZoom() * 0.4));
      el.style.cssText = `width:${size}px;height:${size}px;background:#1a73e8;border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.35);pointer-events:none;`;
      clickMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(map);
    });

    map.on('zoom', () => {
      if (!clickMarker) return;
      const el = clickMarker.getElement();
      if (!el) return;
      const size = Math.max(8, Math.min(14, 6 + map.getZoom() * 0.4));
      el.style.width = size + 'px';
      el.style.height = size + 'px';
    });
  }

  // ---------- Select / move / resize items on map ----------
  function isMovableType(type) {
    return type !== 'mark-area' && type !== 'measure' && type !== 'route';
  }

  function scaleItemsByIds(ids, factor) {
    const scalable = ids.filter(id => {
      const found = findItemById(id);
      return found && isScalableType(found.item.type) && !found.layer.locked && (found.item.geojson || (found.item.props && found.item.props.members));
    });
    if (!scalable.length) return;
    // Shared centroid of all selected
    let cx = 0, cy = 0, n = 0;
    scalable.forEach(id => {
      const found = findItemById(id);
      if (!found) return;
      const geom = found.item.geojson || (found.item.props && found.item.props.members && found.item.props.members[0] && found.item.props.members[0].geojson);
      if (!geom) return;
      const c = geomCentroid(geom);
      cx += c[0]; cy += c[1]; n++;
    });
    if (!n) return;
    cx /= n; cy /= n;
    scalable.forEach(id => {
      const found = findItemById(id);
      if (!found) return;
      if (found.item.geojson) {
        found.item.geojson = scaleGeometry(found.item.geojson, cx, cy, factor);
      }
      if (found.item.type === 'group' && found.item.props && found.item.props.members) {
        found.item.props.members.forEach(m => {
          if (m.geojson) m.geojson = scaleGeometry(m.geojson, cx, cy, factor);
        });
      }
    });
    Mahp.history.push();
    syncUserLayersToMap();
    renderLayersList();
  }

  function groupSelectedItems() {
    if (!hasFeature('group')) return;
    const ids = [...selectedItemIds];
    if (ids.length < 2) {
      showInfo('<strong>Group</strong><p style="margin-top:8px;font-size:0.9rem;color:#5f6368">Select 2 or more items (Ctrl+click), then Group or press Ctrl+G.</p>');
      return;
    }
    const layer = getActiveLayer();
    if (!layer || layer.locked) return;
    const members = [];
    ids.forEach(id => {
      const found = findItemById(id);
      if (found && isScalableType(found.item.type)) {
        members.push(JSON.parse(JSON.stringify(found.item)));
      }
    });
    if (members.length < 2) {
      showInfo('<strong>Group</strong><p style="margin-top:8px;font-size:0.9rem;color:#5f6368">Need at least 2 scalable items (drawings). Mark area, measure, and route cannot be grouped.</p>');
      return;
    }
    // Build a GeometryCollection from member geojsons
    const geoms = members.map(m => m.geojson).filter(Boolean);
    const groupItem = {
      id: uid(),
      type: 'group',
      geojson: { type: 'GeometryCollection', geometries: geoms },
      props: {
        name: 'Group (' + members.length + ')',
        members: members,
        memberIds: members.map(m => m.id)
      }
    };
    // Remove originals
    deleteItems(members.map(m => m.id));
    layer.items.push(groupItem);
    selectedItemIds.clear();
    selectedItemIds.add(groupItem.id);
    expandedLayers.add(layer.id);
    Mahp.history.push();
    renderLayersList();
    syncUserLayersToMap();
  }

  function ungroupSelected() {
    if (!hasFeature('group')) return;
    const ids = [...selectedItemIds];
    let changed = false;
    ids.forEach(id => {
      const found = findItemById(id);
      if (!found || found.item.type !== 'group') return;
      const members = (found.item.props && found.item.props.members) || [];
      const idx = found.layer.items.findIndex(it => it.id === id);
      if (idx < 0) return;
      found.layer.items.splice(idx, 1);
      members.forEach(m => {
        m.id = m.id || uid();
        found.layer.items.splice(idx, 0, m);
        selectedItemIds.add(m.id);
      });
      selectedItemIds.delete(id);
      changed = true;
    });
    if (changed) {
      Mahp.history.push();
      renderLayersList();
      syncUserLayersToMap();
    }
  }

  /** Approximate polygon area in km² (spherical excess / shoelace on lon/lat) */
  function polygonAreaKm2(coords) {
    // coords: ring of [lng, lat]
    if (!coords || coords.length < 3) return 0;
    const R = 6371;
    let area = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const [lon1, lat1] = coords[i];
      const [lon2, lat2] = coords[i + 1];
      area += (lon2 - lon1) * Math.PI / 180 * (2 + Math.sin(lat1 * Math.PI / 180) + Math.sin(lat2 * Math.PI / 180));
    }
    area = Math.abs(area) * R * R / 2;
    return area;
  }

  function computeFeatureAreaKm2(geom) {
    if (!geom) return 0;
    if (geom.type === 'Polygon') {
      return polygonAreaKm2(geom.coordinates[0]);
    }
    if (geom.type === 'MultiPolygon') {
      return geom.coordinates.reduce((s, poly) => s + polygonAreaKm2(poly[0]), 0);
    }
    if (geom.type === 'GeometryCollection') {
      return (geom.geometries || []).reduce((s, g) => s + computeFeatureAreaKm2(g), 0);
    }
    return 0;
  }

  function showAreaForSelection() {
    const ids = [...selectedItemIds];
    if (!ids.length) {
      showInfo('<strong>Area</strong><p style="margin-top:8px;font-size:0.9rem;color:#5f6368">Select a polygon, mark-area, or group first, then click Area.</p>');
      return;
    }
    let total = 0;
    const lines = [];
    ids.forEach(id => {
      const found = findItemById(id);
      if (!found || !found.item.geojson) return;
      const a = computeFeatureAreaKm2(found.item.geojson);
      total += a;
      lines.push(`${escapeHtml(itemDisplayName(found.item))}: ${a >= 1 ? a.toFixed(3) + ' km²' : (a * 1e6).toFixed(0) + ' m²'}`);
    });
    if (!lines.length) {
      showInfo('<strong>Area</strong><p style="margin-top:8px;font-size:0.9rem;color:#5f6368">Selected items have no measurable area (need polygons / mark-area / groups).</p>');
      return;
    }
    const totalStr = total >= 1 ? total.toFixed(3) + ' km²' : (total * 1e6).toFixed(0) + ' m²';
    showInfo(`<strong>Area</strong><ul style="margin:8px 0 0 16px;font-size:0.9rem;color:#5f6368">${lines.map(l => '<li>' + l + '</li>').join('')}</ul><p style="margin-top:10px;font-weight:600">Total: ${totalStr}</p>`);
  }

  // ---------- Straighten / Curve for freehand, fence, barricade ----------
  const LINE_EDIT_TYPES = new Set(['freehand', 'fence', 'barricade', 'polyline']);

  function getLineCoords(geom) {
    if (!geom) return null;
    if (geom.type === 'LineString') return geom.coordinates.slice();
    if (geom.type === 'MultiLineString' && geom.coordinates.length) return geom.coordinates[0].slice();
    return null;
  }

  function setLineCoords(item, coords) {
    if (!item || !item.geojson || coords.length < 2) return;
    if (item.geojson.type === 'MultiLineString') {
      item.geojson = { type: 'MultiLineString', coordinates: [coords] };
    } else {
      item.geojson = { type: 'LineString', coordinates: coords };
    }
  }

  /** Reduce a line to a straight segment between endpoints (or multi-segment via high-tolerance DP). */
  function straightenCoords(coords) {
    if (!coords || coords.length < 2) return coords;
    if (coords.length === 2) return coords.slice();
    // Simple: keep only first and last for a true straight fence/barricade
    return [coords[0].slice(), coords[coords.length - 1].slice()];
  }

  /** Chaikin corner-cutting for a smooth curve tendency (no auto-apply on draw). */
  function curveCoords(coords, iterations) {
    if (!coords || coords.length < 3) return coords ? coords.slice() : coords;
    let pts = coords.map(c => c.slice());
    const n = Math.max(1, Math.min(4, iterations || 2));
    for (let it = 0; it < n; it++) {
      const next = [pts[0].slice()];
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i];
        const p1 = pts[i + 1];
        next.push([
          0.75 * p0[0] + 0.25 * p1[0],
          0.75 * p0[1] + 0.25 * p1[1]
        ]);
        next.push([
          0.25 * p0[0] + 0.75 * p1[0],
          0.25 * p0[1] + 0.75 * p1[1]
        ]);
      }
      next.push(pts[pts.length - 1].slice());
      pts = next;
    }
    return pts;
  }

  function applyLineEditToSelected(mode) {
    if (!hasFeature('line_edit')) return false;
    const ids = [...selectedItemIds];
    if (!ids.length) return false;
    let changed = 0;
    ids.forEach(id => {
      const found = findItemById(id);
      if (!found || found.layer.locked) return;
      const { item } = found;
      if (!LINE_EDIT_TYPES.has(item.type)) return;
      const coords = getLineCoords(item.geojson);
      if (!coords || coords.length < 2) return;
      const next = mode === 'straighten' ? straightenCoords(coords) : curveCoords(coords, 2);
      if (!next || next.length < 2) return;
      setLineCoords(item, next);
      changed++;
    });
    if (changed) {
      Mahp.history.push();
      syncUserLayersToMap();
      renderLayersList();
      return true;
    }
    return false;
  }

  let lineEditToolbar = null;
  function ensureLineEditToolbar() {
    if (lineEditToolbar) return lineEditToolbar;
    const el = document.createElement('div');
    el.id = 'line-edit-toolbar';
    el.className = 'line-edit-toolbar';
    el.style.display = 'none';
    el.innerHTML =
      '<button type="button" data-mode="straighten" title="Straighten (S)"><i class="fa-solid fa-slash"></i> Straighten</button>' +
      '<button type="button" data-mode="curve" title="Curve (C)"><i class="fa-solid fa-wave-square"></i> Curve</button>';
    el.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-mode]');
      if (!btn) return;
      applyLineEditToSelected(btn.dataset.mode);
    });
    const container = document.getElementById('map-container') || document.body;
    container.appendChild(el);
    lineEditToolbar = el;
    return el;
  }

  function updateLineEditToolbarPosition() {
    const tb = ensureLineEditToolbar();
    const ids = [...selectedItemIds].filter(id => {
      const f = findItemById(id);
      return f && LINE_EDIT_TYPES.has(f.item.type) && !f.layer.locked;
    });
    if (!ids.length || !map) {
      tb.style.display = 'none';
      return;
    }
    // Position near centroid of first selected line
    const found = findItemById(ids[0]);
    if (!found) { tb.style.display = 'none'; return; }
    const [lng, lat] = geomCentroid(found.item.geojson);
    const pt = map.project([lng, lat]);
    tb.style.display = 'flex';
    tb.style.left = Math.max(8, pt.x - 70) + 'px';
    tb.style.top = Math.max(8, pt.y - 48) + 'px';
  }

  function hideLineEditToolbar() {
    const tb = lineEditToolbar || document.getElementById('line-edit-toolbar');
    if (tb) tb.style.display = 'none';
  }

  function setupLineEditHover() {
    ensureLineEditToolbar();
    map.on('mousemove', () => {
      if (selectedItemIds.size) updateLineEditToolbarPosition();
    });
    map.on('move', () => {
      if (selectedItemIds.size) updateLineEditToolbarPosition();
    });
    map.on('click', () => setTimeout(updateLineEditToolbarPosition, 50));
    // Dismiss when clicking anywhere outside the toolbar (UI chrome, empty map after deselect, etc.)
    document.addEventListener('pointerdown', (e) => {
      const tb = lineEditToolbar || document.getElementById('line-edit-toolbar');
      if (!tb || tb.style.display === 'none') return;
      if (tb.contains(e.target)) return;
      // Empty map click is handled by selection clearer; for other page UI hide immediately
      if (map && (e.target === map.getCanvas() || map.getCanvas().contains(e.target))) return;
      hideLineEditToolbar();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hideLineEditToolbar();
        if (selectedItemIds.size) {
          selectedItemIds.clear();
          renderLayersList();
          syncUserLayersToMap();
        }
      }
    });
  }

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;

      // Scale selected: [ down, ] up  (avoids +/− which MapLibre uses for zoom)
      // Height: Alt+[ down, Alt+] up (metres) — works in 2D and 3D
      if ((e.key === '[' || e.key === ']') && !e.ctrlKey && !e.metaKey) {
        if (!selectedItemIds.size) return;
        e.preventDefault();
        if (e.altKey) {
          adjustHeightForIds([...selectedItemIds], e.key === ']' ? HEIGHT_STEP : -HEIGHT_STEP);
        } else {
          const factor = e.key === ']' ? 1.12 : 1 / 1.12;
          scaleItemsByIds([...selectedItemIds], factor);
        }
        return;
      }

      // Straighten selected freehand/fence/barricade/polyline: S
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 's' || e.key === 'S')) {
        if (applyLineEditToSelected('straighten')) {
          e.preventDefault();
          return;
        }
      }
      // Curve selected: C
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'c' || e.key === 'C')) {
        if (applyLineEditToSelected('curve')) {
          e.preventDefault();
          return;
        }
      }

      // Group: Ctrl+G / Cmd+G
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        groupSelectedItems();
        return;
      }
      // Ungroup: Ctrl+Shift+G
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        ungroupSelected();
        return;
      }
    });
  }

  function translateGeometry(geom, dLng, dLat) {
    const g = JSON.parse(JSON.stringify(geom));
    const walk = (coords) => {
      if (typeof coords[0] === 'number') {
        coords[0] += dLng;
        coords[1] += dLat;
      } else coords.forEach(walk);
    };
    walk(g.coordinates);
    return g;
  }

  function scaleGeometry(geom, cx, cy, factor) {
    const g = JSON.parse(JSON.stringify(geom));
    const walk = (coords) => {
      if (typeof coords[0] === 'number') {
        coords[0] = cx + (coords[0] - cx) * factor;
        coords[1] = cy + (coords[1] - cy) * factor;
      } else coords.forEach(walk);
    };
    if (g.type === 'GeometryCollection' && g.geometries) {
      g.geometries.forEach(sub => {
        if (sub.coordinates) walk(sub.coordinates);
      });
    } else if (g.coordinates) {
      walk(g.coordinates);
    }
    return g;
  }

  function geomCentroid(geom) {
    let sumLng = 0, sumLat = 0, n = 0;
    const walk = (coords) => {
      if (typeof coords[0] === 'number') {
        sumLng += coords[0]; sumLat += coords[1]; n++;
      } else coords.forEach(walk);
    };
    if (!geom) return [0, 0];
    if (geom.type === 'GeometryCollection' && geom.geometries) {
      geom.geometries.forEach(g => { if (g.coordinates) walk(g.coordinates); });
    } else if (geom.coordinates) {
      walk(geom.coordinates);
    }
    return n ? [sumLng / n, sumLat / n] : [0, 0];
  }

  function setupItemTransform() {
    map.on('mousedown', (e) => {
      if (getCurrentTool() || measureModeActive() || isDrawingActive()) return;
      if (!selectedItemIds.size) return;
      // Only start move/resize if clicking near a selected feature
      const feats = map.queryRenderedFeatures(e.point).filter(f =>
        f.properties && selectedItemIds.has(f.properties.itemId)
      );
      if (!feats.length) return;

      // Filter out mark-area from movable set
      const movable = [...selectedItemIds].filter(id => {
        const found = findItemById(id);
        return found && isMovableType(found.item.type) && !found.layer.locked;
      });
      if (!movable.length) return;

      if (e.originalEvent.shiftKey) {
        // Resize from centroid
        isResizingItems = true;
        resizeStartLngLat = e.lngLat;
        resizeSnapshot = {};
        let cx = 0, cy = 0, n = 0;
        movable.forEach(id => {
          const found = findItemById(id);
          if (!found) return;
          resizeSnapshot[id] = JSON.parse(JSON.stringify(found.item.geojson));
          const c = geomCentroid(found.item.geojson);
          cx += c[0]; cy += c[1]; n++;
        });
        resizeCentroid = n ? [cx / n, cy / n] : [e.lngLat.lng, e.lngLat.lat];
      } else {
        isMovingItems = true;
        moveStartLngLat = e.lngLat;
        moveSnapshot = {};
        movable.forEach(id => {
          const found = findItemById(id);
          if (found) moveSnapshot[id] = JSON.parse(JSON.stringify(found.item.geojson));
        });
      }
      map.dragPan.disable();
      e.preventDefault();
    });

    map.on('mousemove', (e) => {
      if (isMovingItems && moveStartLngLat && moveSnapshot) {
        const dLng = e.lngLat.lng - moveStartLngLat.lng;
        const dLat = e.lngLat.lat - moveStartLngLat.lat;
        Object.keys(moveSnapshot).forEach(id => {
          const found = findItemById(id);
          if (found) found.item.geojson = translateGeometry(moveSnapshot[id], dLng, dLat);
        });
        syncUserLayersToMap();
      } else if (isResizingItems && resizeStartLngLat && resizeSnapshot && resizeCentroid) {
        const dx0 = resizeStartLngLat.lng - resizeCentroid[0];
        const dy0 = resizeStartLngLat.lat - resizeCentroid[1];
        const dx1 = e.lngLat.lng - resizeCentroid[0];
        const dy1 = e.lngLat.lat - resizeCentroid[1];
        const dist0 = Math.sqrt(dx0 * dx0 + dy0 * dy0) || 1e-9;
        const dist1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) || 1e-9;
        const factor = Math.max(0.15, Math.min(8, dist1 / dist0));
        Object.keys(resizeSnapshot).forEach(id => {
          const found = findItemById(id);
          if (found) {
            found.item.geojson = scaleGeometry(
              resizeSnapshot[id],
              resizeCentroid[0],
              resizeCentroid[1],
              factor
            );
          }
        });
        syncUserLayersToMap();
      }
    });

    map.on('mouseup', () => {
      if (isMovingItems || isResizingItems) {
        isMovingItems = false;
        isResizingItems = false;
        moveStartLngLat = null;
        moveSnapshot = null;
        resizeStartLngLat = null;
        resizeSnapshot = null;
        resizeCentroid = null;
        map.dragPan.enable();
        Mahp.history.push();
        renderLayersList();
      }
    });

    // Click map feature to select (when no tool active)
    map.on('click', (e) => {
      if (getCurrentTool() || measureModeActive() || isDrawingActive()) return;
      const feats = map.queryRenderedFeatures(e.point).filter(f =>
        f.properties && f.properties.itemId
      );
      if (!feats.length) {
        if (selectedItemIds.size) {
          selectedItemIds.clear();
          renderLayersList();
          syncUserLayersToMap();
          hideLineEditToolbar();
        }
        return;
      }
      const id = feats[0].properties.itemId;
      if (e.originalEvent.ctrlKey || e.originalEvent.metaKey) {
        if (selectedItemIds.has(id)) selectedItemIds.delete(id);
        else selectedItemIds.add(id);
      } else {
        selectedItemIds.clear();
        selectedItemIds.add(id);
      }
      // Expand parent layer
      const found = findItemById(id);
      if (found) expandedLayers.add(found.layer.id);
      renderLayersList();
      syncUserLayersToMap();
      try { updateLineEditToolbarPosition(); } catch (_) {}
    });
  }

  // ---------- Share Screen → share/share-screen.js (Mahp.share.screen) ----------
  // Thin wrappers so existing call sites keep working.
  function renderShareScreenPanel() {
    if (Mahp.share.screen && Mahp.share.screen.renderShareScreenPanel) {
      return Mahp.share.screen.renderShareScreenPanel();
    }
  }
  function pushShareScreenPresence(lat, lon) {
    if (Mahp.share.screen && Mahp.share.screen.pushShareScreenPresence) {
      return Mahp.share.screen.pushShareScreenPresence(lat, lon);
    }
  }
  function pushShareScreenContent() {
    if (Mahp.share.screen && Mahp.share.screen.pushShareScreenContent) {
      return Mahp.share.screen.pushShareScreenContent();
    }
  }
  function setupShareScreenFullscreenExit() {
    if (Mahp.share.screen && Mahp.share.screen.setupShareScreenFullscreenExit) {
      return Mahp.share.screen.setupShareScreenFullscreenExit();
    }
  }
  async function handleShareScreenFromUrl() {
    if (Mahp.share.screen && Mahp.share.screen.handleShareScreenFromUrl) {
      return Mahp.share.screen.handleShareScreenFromUrl();
    }
  }
  function getActiveShareScreen() {
    return (Mahp.share.screen && Mahp.share.screen.activeShareScreen) || null;
  }

  // ---------- Movement trails ----------
  // status: 'idle' | 'confirming' | 'tracking' | 'paused'
  const trailState = {
    status: 'idle',
    coords: [], // [lng, lat][]
    watchId: null,
    confirmMarker: null,
    pinMarker: null,
    lastAccuracy: null,
    shareMode: false,
    minStepM: 6
  };
  const TRAIL_LOCAL_SRC = 'trail-local-src';
  const TRAIL_REMOTE_SRC = 'trail-remote-src';
  let remoteTrails = {}; // userId -> coords

  function haversineM(a, b) {
    const R = 6371000;
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(b[1] - a[1]);
    const dLon = toRad(b[0] - a[0]);
    const lat1 = toRad(a[1]);
    const lat2 = toRad(b[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function trailColorForUser(uid) {
    if (!uid || uid === getUserId()) return '#2563eb';
    let h = 0;
    const s = String(uid);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const hue = h % 360;
    return 'hsl(' + hue + ' 72% 45%)';
  }

  function ensureTrailLayers() {
    if (!map || !map.isStyleLoaded()) return;
    if (!map.getSource(TRAIL_LOCAL_SRC)) {
      map.addSource(TRAIL_LOCAL_SRC, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addLayer({
        id: TRAIL_LOCAL_SRC + '-line',
        type: 'line',
        source: TRAIL_LOCAL_SRC,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#2563eb',
          'line-width': 4,
          'line-opacity': 0.85
        }
      });
    }
    if (!map.getSource(TRAIL_REMOTE_SRC)) {
      map.addSource(TRAIL_REMOTE_SRC, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addLayer({
        id: TRAIL_REMOTE_SRC + '-line',
        type: 'line',
        source: TRAIL_REMOTE_SRC,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['coalesce', ['get', 'color'], '#7c3aed'],
          'line-width': 3.5,
          'line-opacity': 0.8
        }
      });
    }
  }

  function renderLocalTrail() {
    ensureTrailLayers();
    const src = map && map.getSource(TRAIL_LOCAL_SRC);
    if (!src) return;
    const coords = trailState.coords;
    const features = [];
    if (coords.length >= 2) {
      features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: coords }
      });
    } else if (coords.length === 1) {
      features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: coords[0] }
      });
    }
    src.setData({ type: 'FeatureCollection', features });
  }

  function renderRemoteTrails() {
    ensureTrailLayers();
    const src = map && map.getSource(TRAIL_REMOTE_SRC);
    if (!src) return;
    const me = getUserId();
    const features = [];
    Object.keys(remoteTrails).forEach(uid => {
      if (uid === me) return;
      const coords = remoteTrails[uid];
      if (!coords || coords.length < 2) return;
      features.push({
        type: 'Feature',
        properties: { color: trailColorForUser(uid), userId: uid },
        geometry: { type: 'LineString', coordinates: coords }
      });
    });
    src.setData({ type: 'FeatureCollection', features });
  }

  function setTrailPin(lng, lat) {
    if (trailState.pinMarker) {
      try { trailState.pinMarker.setLngLat([lng, lat]); } catch (_) {}
      return;
    }
    if (!map) return;
    const el = document.createElement('div');
    el.className = 'trail-pin-marker';
    el.innerHTML = '<i class="fa-solid fa-location-dot"></i>';
    trailState.pinMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([lng, lat])
      .addTo(map);
  }

  function clearTrailPin() {
    if (trailState.pinMarker) {
      try { trailState.pinMarker.remove(); } catch (_) {}
      trailState.pinMarker = null;
    }
    if (trailState.confirmMarker) {
      try { trailState.confirmMarker.remove(); } catch (_) {}
      trailState.confirmMarker = null;
    }
  }

  function appendTrailPoint(lng, lat, accuracy) {
    if (trailState.status !== 'tracking' && trailState.status !== 'paused') {
      // allow seeding first point while confirming
      if (trailState.status !== 'confirming') return;
    }
    if (trailState.status === 'paused') return;
    if (typeof lng !== 'number' || typeof lat !== 'number' || isNaN(lng) || isNaN(lat)) return;
    trailState.lastAccuracy = accuracy != null ? accuracy : trailState.lastAccuracy;
    const pt = [lng, lat];
    const coords = trailState.coords;
    if (coords.length) {
      const dist = haversineM(coords[coords.length - 1], pt);
      if (dist < trailState.minStepM) {
        // update pin only
        if (trailState.status === 'tracking') setTrailPin(lng, lat);
        return;
      }
    }
    coords.push(pt);
    if (coords.length > 2000) coords.splice(0, coords.length - 2000);
    if (trailState.status === 'tracking') setTrailPin(lng, lat);
    renderLocalTrail();
  }

  function beginTrailConfirm() {
    if (!navigator.geolocation) {
      showInfo('Geolocation is not available on this device.');
      return;
    }
    trailState.status = 'confirming';
    trailState.shareMode = false;
    showInfo('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lng = pos.coords.longitude;
        const lat = pos.coords.latitude;
        trailState.lastAccuracy = pos.coords.accuracy;
        trailState.coords = [[lng, lat]];
        clearTrailPin();
        if (map) {
          const el = document.createElement('div');
          el.className = 'trail-confirm-marker';
          el.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i>';
          trailState.confirmMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([lng, lat])
            .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(
              '<strong>Confirm location</strong><br><span style="font-size:0.85rem;color:#5f6368">Accuracy ±' +
              Math.round(pos.coords.accuracy || 0) + ' m</span>'
            ))
            .addTo(map);
          try { trailState.confirmMarker.togglePopup(); } catch (_) {}
          map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 16), essential: true });
        }
        renderLocalTrail();
        if (activeNavAction === 'location') renderTrailPanel();
      },
      () => {
        trailState.status = 'idle';
        showInfo('Could not get location. Check permission and try again.');
        if (activeNavAction === 'location') renderTrailPanel();
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
    if (activeNavAction === 'location') renderTrailPanel();
  }

  function startTrailTracking(opts) {
    const options = opts || {};
    trailState.shareMode = !!options.shareScreen;
    if (trailState.status === 'tracking') return;
    if (trailState.confirmMarker) {
      try { trailState.confirmMarker.remove(); } catch (_) {}
      trailState.confirmMarker = null;
    }
    trailState.status = 'tracking';
    if (!trailState.coords.length && !options.auto) {
      // need at least confirm pin
    }
    if (trailState.coords.length) {
      const last = trailState.coords[trailState.coords.length - 1];
      setTrailPin(last[0], last[1]);
    }
    // Solo mode: own watch (share screen uses _ssWatchId)
    if (!options.shareScreen) {
      if (trailState.watchId != null) {
        try { navigator.geolocation.clearWatch(trailState.watchId); } catch (_) {}
      }
      trailState.watchId = navigator.geolocation.watchPosition(
        (pos) => {
          appendTrailPoint(pos.coords.longitude, pos.coords.latitude, pos.coords.accuracy);
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
      );
    }
    renderLocalTrail();
    if (activeNavAction === 'location') renderTrailPanel();
  }

  function pauseTrail() {
    if (trailState.status !== 'tracking') return;
    trailState.status = 'paused';
    if (activeNavAction === 'location') renderTrailPanel();
  }

  function resumeTrail() {
    if (trailState.status !== 'paused') return;
    trailState.status = 'tracking';
    if (activeNavAction === 'location') renderTrailPanel();
  }

  function stopTrail({ clear } = {}) {
    if (trailState.watchId != null) {
      try { navigator.geolocation.clearWatch(trailState.watchId); } catch (_) {}
      trailState.watchId = null;
    }
    trailState.status = 'idle';
    trailState.shareMode = false;
    if (clear) {
      trailState.coords = [];
      clearTrailPin();
      renderLocalTrail();
    }
    if (activeNavAction === 'location') renderTrailPanel();
  }

  function clearTrailOnly() {
    trailState.coords = [];
    clearTrailPin();
    renderLocalTrail();
    if (getActiveShareScreen()) pushShareScreenPresence();
    if (activeNavAction === 'location') renderTrailPanel();
  }

  function renderTrailPanel() {
    const st = trailState.status;
    const acc = trailState.lastAccuracy != null ? Math.round(trailState.lastAccuracy) : null;
    const pts = trailState.coords.length;
    let distM = 0;
    for (let i = 1; i < trailState.coords.length; i++) {
      distM += haversineM(trailState.coords[i - 1], trailState.coords[i]);
    }
    const distLabel = distM >= 1000 ? (distM / 1000).toFixed(2) + ' km' : Math.round(distM) + ' m';

    let html = '<div class="ss-panel trail-panel">';
    html += '<div class="ss-panel-hero">' +
      '<div class="ss-panel-kicker">Movement trail</div>' +
      '<h3 class="ss-panel-title">Track where you go</h3>' +
      '<p class="ss-panel-meta">A gradual path builds as you move — pause anytime. On a share screen, trails start automatically for everyone.</p>' +
      '</div>';

    if (st === 'idle') {
      html += '<p class="ss-hint-text">We pin your current location first so you can confirm it is accurate.</p>' +
        '<div class="form-actions form-actions-text">' +
        '<button type="button" class="text-action" id="trail-begin"><i class="fa-solid fa-location-crosshairs"></i> Pin my location</button>' +
        '</div>';
    } else if (st === 'confirming') {
      html += '<div class="trail-confirm-box">' +
        '<p><strong>Is this pin accurate?</strong></p>' +
        (acc != null ? '<p class="ss-hint-text">Reported accuracy ±' + acc + ' m</p>' : '') +
        '<div class="form-actions form-actions-text">' +
        '<button type="button" class="text-action" id="trail-confirm-start"><i class="fa-solid fa-play"></i> Yes, start trail</button>' +
        '<span class="text-action-sep">|</span>' +
        '<button type="button" class="text-action" id="trail-retry"><i class="fa-solid fa-rotate"></i> Retry</button>' +
        '<span class="text-action-sep">|</span>' +
        '<button type="button" class="text-action" id="trail-cancel">Cancel</button>' +
        '</div></div>';
    } else if (st === 'tracking' || st === 'paused') {
      html += '<div class="trail-stats">' +
        '<span class="trail-stat"><i class="fa-solid fa-route"></i> ' + distLabel + '</span>' +
        '<span class="trail-stat"><i class="fa-solid fa-map-pin"></i> ' + pts + ' pts</span>' +
        '<span class="trail-stat trail-stat-' + st + '">' + (st === 'paused' ? 'Paused' : 'Live') + '</span>' +
        '</div>' +
        '<div class="form-actions form-actions-text">' +
        (st === 'tracking'
          ? '<button type="button" class="text-action" id="trail-pause"><i class="fa-solid fa-pause"></i> Pause</button>'
          : '<button type="button" class="text-action" id="trail-resume"><i class="fa-solid fa-play"></i> Resume</button>') +
        '<span class="text-action-sep">|</span>' +
        '<button type="button" class="text-action" id="trail-stop"><i class="fa-solid fa-stop"></i> Stop</button>' +
        '<span class="text-action-sep">|</span>' +
        '<button type="button" class="text-action" id="trail-clear"><i class="fa-solid fa-eraser"></i> Clear path</button>' +
        '</div>';
      if (trailState.shareMode || getActiveShareScreen()) {
        html += '<p class="ss-hint-text" style="margin-top:10px">Share screen: others can see your trail in real time.</p>';
      }
    }
    html += '</div>';
    genericPanelContent.innerHTML = html;

    document.getElementById('trail-begin')?.addEventListener('click', () => beginTrailConfirm());
    document.getElementById('trail-confirm-start')?.addEventListener('click', () => startTrailTracking({}));
    document.getElementById('trail-retry')?.addEventListener('click', () => beginTrailConfirm());
    document.getElementById('trail-cancel')?.addEventListener('click', () => stopTrail({ clear: true }));
    document.getElementById('trail-pause')?.addEventListener('click', () => pauseTrail());
    document.getElementById('trail-resume')?.addEventListener('click', () => resumeTrail());
    document.getElementById('trail-stop')?.addEventListener('click', () => stopTrail({ clear: false }));
    document.getElementById('trail-clear')?.addEventListener('click', () => clearTrailOnly());
  }

  // ---------- Nearest landmarks ----------
  const landmarksState = {
    category: 'all',
    query: '',
    results: [],
    categories: [],
    loading: false,
    from: null,
    error: null
  };

  function formatLandmarkDist(r) {
    const km = r.distance_km;
    const dist = km >= 1 ? km.toFixed(2) + ' km' : Math.round(r.distance_m) + ' m';
    const mins = r.duration_min_walk != null ? r.duration_min_walk + ' min' : '—';
    return { dist, mins };
  }

  async function loadLandmarkCategories() {
    try {
      const res = await fetch('/api/landmarks/categories?api_key=' + encodeURIComponent(getApiKey()));
      if (!res.ok) return;
      const data = await res.json();
      landmarksState.categories = data.categories || [];
    } catch (_) {}
  }

  function getPositionPromise() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        err => reject(err),
        { enableHighAccuracy: true, timeout: 15000 }
      );
    });
  }

  async function fetchNearestLandmarks() {
    landmarksState.loading = true;
    landmarksState.error = null;
    if (activeNavAction === 'landmarks') renderLandmarksPanel();
    try {
      if (!landmarksState.from) {
        landmarksState.from = await getPositionPromise();
      }
      const params = new URLSearchParams({
        lat: landmarksState.from.lat,
        lon: landmarksState.from.lon,
        limit: '25',
        api_key: getApiKey()
      });
      if (landmarksState.category && landmarksState.category !== 'all') {
        params.set('category', landmarksState.category);
      }
      if (landmarksState.query) params.set('q', landmarksState.query);
      const res = await fetch('/api/landmarks/nearest?' + params.toString());
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to load landmarks');
      }
      const data = await res.json();
      landmarksState.results = data.results || [];
      landmarksState.from = data.from || landmarksState.from;
    } catch (e) {
      landmarksState.error = e.message || String(e);
      landmarksState.results = [];
    }
    landmarksState.loading = false;
    if (activeNavAction === 'landmarks') renderLandmarksPanel();
  }

  function renderLandmarksPanel() {
    const cats = landmarksState.categories || [];
    let catOpts = '<option value="all"' + (landmarksState.category === 'all' ? ' selected' : '') + '>All categories</option>';
    cats.forEach(c => {
      catOpts += '<option value="' + escapeHtml(c.id) + '"' +
        (landmarksState.category === c.id ? ' selected' : '') + '>' +
        escapeHtml(c.label || c.id) +
        (c.count != null ? ' (' + c.count + ')' : '') +
        '</option>';
    });

    let html = '<div class="ss-panel landmarks-panel">';
    html +=
      '<div class="ss-panel-hero">' +
        '<div class="ss-panel-kicker">Nearest landmarks</div>' +
        '<h3 class="ss-panel-title">Around you</h3>' +
        '<p class="ss-panel-meta">Up to 25 nearby places from the map index. Filter by category or search by name.</p>' +
      '</div>' +
      '<div class="ss-panel-block">' +
        '<label class="ss-label">Category</label>' +
        '<select id="lm-category" class="ss-input">' + catOpts + '</select>' +
      '</div>' +
      '<div class="ss-panel-block">' +
        '<label class="ss-label">Search</label>' +
        '<div class="ss-link-row">' +
          '<input type="text" id="lm-search" class="ss-input" placeholder="Hospital, school, market…" value="' + escapeHtml(landmarksState.query) + '" />' +
          '<button type="button" class="ss-icon-btn" id="lm-search-btn" title="Search"><i class="fa-solid fa-magnifying-glass"></i></button>' +
        '</div>' +
      '</div>' +
      '<div class="form-actions form-actions-text">' +
        '<button type="button" class="text-action" id="lm-refresh"><i class="fa-solid fa-location-crosshairs"></i> Use my location</button>' +
      '</div>';

    if (landmarksState.loading) {
      html += '<p class="ss-hint-text">Finding nearby places…</p>';
    } else if (landmarksState.error) {
      html += '<p class="ss-hint-text" style="color:#b91c1c">' + escapeHtml(landmarksState.error) + '</p>';
    } else if (!landmarksState.results.length) {
      html += '<p class="ss-hint-text">No landmarks found. Try another category or search.</p>';
    } else {
      html += '<ul class="lm-list">';
      landmarksState.results.forEach((r, idx) => {
        const { dist, mins } = formatLandmarkDist(r);
        html +=
          '<li class="lm-row" data-idx="' + idx + '">' +
            '<div class="lm-main">' +
              '<span class="lm-name">' + escapeHtml(r.display_name || r.name) + '</span>' +
              '<span class="lm-meta">' + escapeHtml(r.type_label || r.type) +
                ' · ' + dist + ' · ~' + mins + ' walk</span>' +
            '</div>' +
            '<div class="lm-actions">' +
              '<button type="button" class="ss-icon-btn lm-goto tip-btn" data-tooltip="Go to location"><i class="fa-solid fa-location-crosshairs"></i></button>' +
              '<button type="button" class="ss-icon-btn lm-route tip-btn" data-tooltip="Route to"><i class="fa-solid fa-route"></i></button>' +
            '</div>' +
          '</li>';
      });
      html += '</ul>';
    }
    html += '</div>';
    genericPanelContent.innerHTML = html;
    setupTipButtons(genericPanelContent);

    document.getElementById('lm-category')?.addEventListener('change', (e) => {
      landmarksState.category = e.target.value || 'all';
      fetchNearestLandmarks();
    });
    const runSearch = () => {
      landmarksState.query = (document.getElementById('lm-search')?.value || '').trim();
      fetchNearestLandmarks();
    };
    document.getElementById('lm-search-btn')?.addEventListener('click', runSearch);
    document.getElementById('lm-search')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runSearch();
    });
    document.getElementById('lm-refresh')?.addEventListener('click', () => {
      landmarksState.from = null;
      fetchNearestLandmarks();
    });
    document.querySelectorAll('.lm-row').forEach(row => {
      const idx = +row.getAttribute('data-idx');
      const r = landmarksState.results[idx];
      if (!r) return;
      row.querySelector('.lm-goto')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!map) return;
        map.flyTo({ center: [r.lon, r.lat], zoom: Math.max(map.getZoom(), 15), essential: true });
        try {
          new maplibregl.Marker({ color: '#0f766e' })
            .setLngLat([r.lon, r.lat])
            .setPopup(new maplibregl.Popup().setHTML('<strong>' + escapeHtml(r.display_name || r.name) + '</strong>'))
            .addTo(map)
            .togglePopup();
        } catch (_) {}
      });
      row.querySelector('.lm-route')?.addEventListener('click', (e) => {
        e.stopPropagation();
        routeFromMyLocationTo({ lat: r.lat, lon: r.lon, name: r.display_name || r.name });
        showDestinationCard({ lat: r.lat, lon: r.lon, name: r.display_name || r.name });
      });
    });
  }
  // Prefetch categories when panel may be used
  try { loadLandmarkCategories(); } catch (_) {}

  // Safety net: if init() ever throws or hangs before it can reveal the app
  // itself (e.g. a network error), don't leave the user staring at the boot
  // spinner forever — force a reveal after a few seconds either way.
  setTimeout(() => document.documentElement.classList.remove('mahp-booting'), 8000);
  init().catch((e) => {
    console.error(e);
    document.documentElement.classList.remove('mahp-booting');
  });
})();