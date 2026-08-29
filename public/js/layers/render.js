/**
 * layers/render.js
 * User layers: model helpers, list UI, MapLibre sync, import/export.
 * Installed from map.js via Mahp.layers.install(host).
 *
 * host.refs must hold live references:
 *   userLayers, activeLayerId, expandedLayers, selectedItemIds,
 *   labelsOnTop, textMarkers, fenceIconsReady
 */
(function (global) {
  "use strict";

  var Mahp = global.Mahp || (global.Mahp = {});
  Mahp.layers = Mahp.layers || {};

  function install(host) {
    if (!host || typeof host.getMap !== "function") {
      throw new Error("Mahp.layers.install requires host.getMap");
    }
    if (Mahp.layers._installed) return Mahp.layers;

    var api = Mahp.layers;

    // Helpers that lived in the map.js closure — resolve via Mahp / host
    function escapeHtml(s) {
      if (Mahp.escapeHtml) return Mahp.escapeHtml(s);
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
    function showInfo(msg) {
      if (typeof host.showInfo === 'function') return host.showInfo(msg);
      if (Mahp.showInfo) return Mahp.showInfo(msg);
      try { console.info('[mahp]', msg); } catch (_) {}
    }

    // ========== USER LAYERS ==========
    function uid() {
      return 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    function ensureDefaultLayer() {
      if (!host.refs || !Array.isArray(host.refs.userLayers)) {
        console.warn('[mahp] layers: host.refs.userLayers missing');
        return;
      }
      if (host.refs.userLayers.length) {
        if (!host.refs.activeLayerId) {
          host.refs.activeLayerId = host.refs.userLayers[0].id;
        }
        return;
      }
      const id = uid();
      host.refs.userLayers.push({
        id,
        name: 'Layer 1',
        visible: true,
        locked: false,
        opacity: (host.DEFAULT_LAYER_OPACITY != null ? host.DEFAULT_LAYER_OPACITY : 0.8),
        items: []
      });
      host.refs.activeLayerId = id;
      // Start with the default layer expanded so the panel is never empty-looking
      if (host.refs.expandedLayers && host.refs.expandedLayers.add) {
        host.refs.expandedLayers.add(id);
      }
    }

    function getActiveLayer() {
      ensureDefaultLayer();
      return host.refs.userLayers.find(l => l.id === host.refs.activeLayerId) || host.refs.userLayers[0];
    }

    function setupLayers() {
      ensureDefaultLayer();
      const addBtn = document.getElementById('btn-add-layer');
      const exportBtn = document.getElementById('btn-export-layers');
      const importBtn = document.getElementById('btn-import-layers');
      const importInput = document.getElementById('import-layers-input');
      const labelsCb = document.getElementById('labels-on-top');

      // Open/close is handled by left-nav "layers" action + sidebar panel

      if (addBtn) addBtn.addEventListener('click', () => {
        ensureDefaultLayer();
        const id = uid();
        const n = host.refs.userLayers.length + 1;
        host.refs.userLayers.push({
          id,
          name: 'Layer ' + n,
          visible: true,
          locked: false,
          opacity: (host.DEFAULT_LAYER_OPACITY != null ? host.DEFAULT_LAYER_OPACITY : 0.8),
          items: []
        });
        host.refs.activeLayerId = id;
        if (host.refs.expandedLayers && host.refs.expandedLayers.add) host.refs.expandedLayers.add(id);
        if (Mahp.history && Mahp.history.push) Mahp.history.push();
        renderLayersList();
        syncUserLayersToMap();
      });

      if (labelsCb) labelsCb.addEventListener('change', () => {
        host.refs.labelsOnTop = labelsCb.checked;
        applyLabelOrder();
      });

      if (exportBtn) exportBtn.addEventListener('click', exportLayers);
      if (importBtn && importInput) {
        importBtn.addEventListener('click', () => importInput.click());
        importInput.addEventListener('change', (e) => {
          const file = e.target.files && e.target.files[0];
          if (file) importLayers(file);
          importInput.value = '';
        });
      }

      const delSelBtn = document.getElementById('btn-delete-selected');
      if (delSelBtn) {
        delSelBtn.addEventListener('click', () => {
          if (!host.refs.selectedItemIds.size) {
            alert('Select one or more items first (click in the layers list, Ctrl+click for multi-select).');
            return;
          }
          if (!confirm(`Delete ${host.refs.selectedItemIds.size} selected item(s)?`)) return;
          deleteItems([...host.refs.selectedItemIds]);
        });
      }

      // Keyboard: Ctrl+Up / Ctrl+Down to move active layer; Delete removes selected items
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          const tag = (e.target && e.target.tagName) || '';
          if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
          if (host.refs.selectedItemIds.size) {
            e.preventDefault();
            deleteItems([...host.refs.selectedItemIds]);
          }
          return;
        }
        if (!e.ctrlKey && !e.metaKey) return;
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        const idx = host.refs.userLayers.findIndex(l => l.id === host.refs.activeLayerId);
        if (idx < 0) return;
        e.preventDefault();
        const swapWith = e.key === 'ArrowUp' ? idx - 1 : idx + 1;
        if (swapWith < 0 || swapWith >= host.refs.userLayers.length) return;
        const tmp = host.refs.userLayers[idx];
        host.refs.userLayers[idx] = host.refs.userLayers[swapWith];
        host.refs.userLayers[swapWith] = tmp;
        renderLayersList();
        syncUserLayersToMap();
      });

      renderLayersList();
    }

    const ITEM_ICONS = {
      freehand: 'fa-pencil', polyline: 'fa-minus', polygon: 'fa-vector-square',
      text: 'fa-font', fence: 'fa-border-all', barricade: 'fa-road-barrier',
      'mark-area': 'fa-draw-polygon', measure: 'fa-ruler', route: 'fa-route',
      group: 'fa-object-group'
    };

    /** Types that can be freely scaled (not tied to real-world lat/lon features) */
    function isScalableType(type) {
      return !['mark-area', 'measure', 'route'].includes(type);
    }

    /** Types that support optional 3D height (metres), stored in props.height */
    function isHeightableType(type) {
      return ['freehand', 'polyline', 'polygon', 'text', 'fence', 'barricade', 'group'].includes(type);
    }

    const HEIGHT_STEP = 2; // metres per keypress
    const HEIGHT_MAX = 200;

    function getItemHeight(item) {
      if (!item || !item.props) return 0;
      const h = Number(item.props.height);
      return isFinite(h) && h > 0 ? h : 0;
    }

    /** Approximate line buffer → thin polygon for wall extrusion */
    function lineToWallPolygon(coords, widthMeters) {
      if (!coords || coords.length < 2) return null;
      const left = [];
      const right = [];
      for (let i = 0; i < coords.length; i++) {
        const prev = coords[Math.max(0, i - 1)];
        const next = coords[Math.min(coords.length - 1, i + 1)];
        const lng = coords[i][0];
        const lat = coords[i][1];
        let dx = next[0] - prev[0];
        let dy = next[1] - prev[1];
        const len = Math.sqrt(dx * dx + dy * dy) || 1e-12;
        dx /= len;
        dy /= len;
        const metersPerDegLat = 111320;
        const metersPerDegLng = Math.max(1e-6, 111320 * Math.cos((lat * Math.PI) / 180));
        const half = widthMeters / 2;
        const ox = (-dy * half) / metersPerDegLng;
        const oy = (dx * half) / metersPerDegLat;
        left.push([lng + ox, lat + oy]);
        right.push([lng - ox, lat - oy]);
      }
      const ring = left.concat(right.reverse());
      ring.push(ring[0]);
      return { type: 'Polygon', coordinates: [ring] };
    }

    function findItemById(id) {
      const layers = (host.refs && host.refs.userLayers) || [];
      for (const layer of layers) {
        const item = (layer.items || []).find(it => it.id === id);
        if (item) return { layer, item };
      }
      return null;
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

    function scaleItemsByIds(ids, factor) {
      const scalable = (ids || []).filter(id => {
        const found = findItemById(id);
        return found && isScalableType(found.item.type) && !found.layer.locked &&
          (found.item.geojson || (found.item.props && found.item.props.members));
      });
      if (!scalable.length) return;
      let cx = 0, cy = 0, n = 0;
      scalable.forEach(id => {
        const found = findItemById(id);
        if (!found) return;
        const geom = found.item.geojson ||
          (found.item.props && found.item.props.members && found.item.props.members[0] &&
           found.item.props.members[0].geojson);
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
      if (Mahp.history && Mahp.history.push) Mahp.history.push();
      syncUserLayersToMap();
      renderLayersList();
    }

        function adjustHeightForIds(ids, delta) {
      let changed = false;
      ids.forEach(id => {
        const found = findItemById(id);
        if (!found || found.layer.locked) return;
        if (!isHeightableType(found.item.type)) return;
        if (!found.item.props) found.item.props = {};
        let h = getItemHeight(found.item) + delta;
        h = Math.max(0, Math.min(HEIGHT_MAX, h));
        // snap small values to 0
        if (h < 0.5) h = 0;
        found.item.props.height = h;
        if (found.item.type === 'group' && found.item.props.members) {
          found.item.props.members.forEach(m => {
            if (!m.props) m.props = {};
            if (isHeightableType(m.type)) m.props.height = h;
          });
        }
        changed = true;
      });
      if (changed) {
        Mahp.history.push();
        syncUserLayersToMap();
        renderLayersList();
      }
    }

    function itemDisplayName(item) {
      if (item.props && item.props.name) return item.props.name;
      if (item.type === 'text' && item.props && item.props.text) return item.props.text;
      if (item.type === 'measure' && item.props && item.props.distance_km != null) return `Measure ${item.props.distance_km} km`;
      if (item.type === 'route' && item.props && item.props.distance_km != null) {
        return `Route ${item.props.distance_km} km`;
      }
      return (item.type || 'item').replace(/-/g, ' ');
    }

    function renderLayersList() {
      const list = document.getElementById('layers-list');
      if (!list) return;
      ensureDefaultLayer();
      if (!host.refs || !host.refs.userLayers) {
        list.innerHTML = '<div class="panel-empty">Layers unavailable.</div>';
        return;
      }

      let html = '';
      host.refs.userLayers.forEach(layer => {
        const expanded = host.refs.expandedLayers.has(layer.id);
        html += `
        <div class="layer-row ${layer.id === host.refs.activeLayerId ? 'active' : ''} ${layer.locked ? 'locked' : ''}"
             data-id="${layer.id}" draggable="true">
          <button type="button" class="layer-expand" data-action="expand" title="Expand">
            <i class="fa-solid ${expanded ? 'fa-chevron-down' : 'fa-chevron-right'}"></i>
          </button>
          <button type="button" class="layer-eye ${layer.visible ? '' : 'off'}" data-action="toggle-vis" title="${layer.visible ? 'Hide' : 'Show'}">
            <i class="fa-solid ${layer.visible ? 'fa-eye' : 'fa-eye-slash'}"></i>
          </button>
          <button type="button" class="layer-lock" data-action="toggle-lock" title="${layer.locked ? 'Unlock' : 'Lock'}">
            <i class="fa-solid ${layer.locked ? 'fa-lock' : 'fa-lock-open'}"></i>
          </button>
          <span class="layer-name" data-action="rename" title="Double-click to rename">${escapeHtml(layer.name)}</span>
          <input type="number" class="layer-opacity-input" min="0" max="80" step="1"
                 value="${Math.round(Math.min(80, Math.max(0, (layer.opacity || (host.DEFAULT_LAYER_OPACITY)) * 100)))}"
                 data-action="opacity" title="Opacity (0–80)" />
          <span class="layer-count">${layer.items.length}</span>
          <button type="button" class="layer-delete" data-action="delete-layer" title="Delete layer"><i class="fa-solid fa-trash-can"></i></button>
        </div>`;
        if (expanded && layer.items.length) {
          html += `<div class="layer-items" data-layer-id="${layer.id}">`;
          layer.items.forEach(item => {
            const sel = host.refs.selectedItemIds.has(item.id) ? 'selected' : '';
            const icon = ITEM_ICONS[item.type] || 'fa-shapes';
            const scalable = isScalableType(item.type);
            const heightable = isHeightableType(item.type);
            const hVal = getItemHeight(item);
            const scaleBtns = scalable
              ? `<span class="item-scale"><button type="button" data-action="scale-down" title="Scale down ([)">−</button><button type="button" data-action="scale-up" title="Scale up (])">+</button></span>`
              : '';
            const heightBtns = heightable
              ? `<span class="item-scale item-height" title="Height ${hVal} m"><button type="button" data-action="height-down" title="Height down (Alt+[)">▾</button><span class="item-h-label">${hVal ? hVal + 'm' : 'flat'}</span><button type="button" data-action="height-up" title="Height up (Alt+])">▴</button></span>`
              : '';
            html += `
            <div class="layer-item-row ${sel} ${item.type === 'group' ? 'group-item' : ''}" data-item-id="${item.id}" data-layer-id="${layer.id}" draggable="true">
              <span class="item-icon"><i class="fa-solid ${icon}"></i></span>
              ${scaleBtns}${heightBtns}
              <span class="item-name" data-action="rename-item" title="Double-click to rename">${escapeHtml(itemDisplayName(item))}</span>
              <button type="button" class="item-del" data-action="delete-item" title="Delete"><i class="fa-solid fa-xmark"></i></button>
            </div>`;
          });
          html += `</div>`;
        } else if (expanded) {
          html += `<div class="layer-items" data-layer-id="${layer.id}"><div style="font-size:0.75rem;color:var(--text-muted);padding:4px 6px">Empty</div></div>`;
        }
      });
      list.innerHTML = html || '<p style="color:var(--text-muted);font-size:0.85rem;padding:8px">No layers yet</p>';

      // Layer row handlers
      list.querySelectorAll('.layer-row').forEach(row => {
        const id = row.dataset.id;
        row.addEventListener('click', (e) => {
          if (e.target.closest('[data-action]')) return;
          host.refs.activeLayerId = id;
          renderLayersList();
        });
        row.querySelector('[data-action="expand"]').addEventListener('click', (e) => {
          e.stopPropagation();
          if (host.refs.expandedLayers.has(id)) host.refs.expandedLayers.delete(id);
          else host.refs.expandedLayers.add(id);
          renderLayersList();
        });
        row.querySelector('[data-action="toggle-vis"]').addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = host.refs.userLayers.find(l => l.id === id);
          if (layer) { layer.visible = !layer.visible; renderLayersList(); syncUserLayersToMap(); }
        });
        row.querySelector('[data-action="toggle-lock"]').addEventListener('click', (e) => {
          e.stopPropagation();
          const layer = host.refs.userLayers.find(l => l.id === id);
          if (layer) { layer.locked = !layer.locked; renderLayersList(); }
        });
        row.querySelector('[data-action="delete-layer"]').addEventListener('click', (e) => {
          e.stopPropagation();
          if (!confirm('Delete this layer and all its items?')) return;
          host.refs.userLayers = host.refs.userLayers.filter(l => l.id !== id);
          if (host.refs.activeLayerId === id) host.refs.activeLayerId = host.refs.userLayers[0] ? host.refs.userLayers[0].id : null;
          ensureDefaultLayer();
          Mahp.history.push();
          renderLayersList();
          syncUserLayersToMap();
        });
        const nameEl = row.querySelector('[data-action="rename"]');
        nameEl.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          const layer = host.refs.userLayers.find(l => l.id === id);
          if (!layer || layer.locked) return;
          nameEl.contentEditable = 'true';
          nameEl.focus();
          const range = document.createRange();
          range.selectNodeContents(nameEl);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        });
        nameEl.addEventListener('blur', () => {
          const layer = host.refs.userLayers.find(l => l.id === id);
          if (layer) {
            layer.name = nameEl.textContent.trim() || layer.name;
            nameEl.contentEditable = 'false';
            renderLayersList();
          }
        });
        nameEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
        });
        const opacityInput = row.querySelector('[data-action="opacity"]');
        if (opacityInput) {
          const applyOpacity = (e) => {
            e.stopPropagation();
            const layer = host.refs.userLayers.find(l => l.id === id);
            if (!layer) return;
            let n = parseInt(e.target.value, 10);
            if (isNaN(n)) n = 80;
            n = Math.min(80, Math.max(0, n));
            e.target.value = n;
            layer.opacity = n / 100;
            syncUserLayersToMap();
          };
          opacityInput.addEventListener('change', applyOpacity);
          opacityInput.addEventListener('input', (e) => {
            e.stopPropagation();
            // Live preview while typing, clamp on change
            const layer = host.refs.userLayers.find(l => l.id === id);
            if (!layer) return;
            let n = parseInt(e.target.value, 10);
            if (isNaN(n)) return;
            n = Math.min(80, Math.max(0, n));
            layer.opacity = n / 100;
            syncUserLayersToMap();
          });
          opacityInput.addEventListener('click', (e) => e.stopPropagation());
        }
        // Drag reorder layers
        row.addEventListener('dragstart', (e) => {
          row.classList.add('dragging');
          e.dataTransfer.setData('text/plain', 'layer:' + id);
          e.dataTransfer.effectAllowed = 'move';
        });
        row.addEventListener('dragend', () => row.classList.remove('dragging'));
        row.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
        row.addEventListener('drop', (e) => {
          e.preventDefault();
          const raw = e.dataTransfer.getData('text/plain');
          if (raw.startsWith('item:')) {
            const itemId = raw.slice(5);
            const ids = host.refs.selectedItemIds.has(itemId) && host.refs.selectedItemIds.size
              ? [...host.refs.selectedItemIds]
              : [itemId];
            reorderOrMoveItems(ids, id, null);
            return;
          }
          if (!raw.startsWith('layer:')) return;
          const fromId = raw.slice(6);
          if (fromId === id) return;
          const fromIdx = host.refs.userLayers.findIndex(l => l.id === fromId);
          const toIdx = host.refs.userLayers.findIndex(l => l.id === id);
          if (fromIdx < 0 || toIdx < 0) return;
          const [moved] = host.refs.userLayers.splice(fromIdx, 1);
          host.refs.userLayers.splice(toIdx, 0, moved);
          renderLayersList();
          syncUserLayersToMap();
        });
      });

      // Item row handlers — select, delete, rename, drag reorder / cross-layer
      list.querySelectorAll('.layer-item-row').forEach(row => {
        const itemId = row.dataset.itemId;
        const layerId = row.dataset.layerId;
        row.addEventListener('click', (e) => {
          if (e.target.closest('[data-action]')) return;
          if (e.ctrlKey || e.metaKey) {
            if (host.refs.selectedItemIds.has(itemId)) host.refs.selectedItemIds.delete(itemId);
            else host.refs.selectedItemIds.add(itemId);
          } else {
            host.refs.selectedItemIds.clear();
            host.refs.selectedItemIds.add(itemId);
          }
          renderLayersList();
          syncUserLayersToMap();
        });
        row.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', 'item:' + itemId);
          e.dataTransfer.setData('application/x-layer-id', layerId);
          e.dataTransfer.effectAllowed = 'move';
          if (!host.refs.selectedItemIds.has(itemId)) {
            host.refs.selectedItemIds.clear();
            host.refs.selectedItemIds.add(itemId);
          }
          row.classList.add('dragging');
        });
        row.addEventListener('dragend', () => row.classList.remove('dragging'));
        row.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          row.classList.add('drag-over');
        });
        row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
        row.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          row.classList.remove('drag-over');
          const raw = e.dataTransfer.getData('text/plain');
          if (!raw.startsWith('item:')) return;
          const fromId = raw.slice(5);
          const ids = host.refs.selectedItemIds.has(fromId) && host.refs.selectedItemIds.size
            ? [...host.refs.selectedItemIds]
            : [fromId];
          reorderOrMoveItems(ids, layerId, itemId);
        });
        const delBtn = row.querySelector('[data-action="delete-item"]');
        if (delBtn) delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteItems([itemId]);
        });
        row.querySelectorAll('[data-action="scale-up"], [data-action="scale-down"]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const factor = btn.dataset.action === 'scale-up' ? 1.12 : 1 / 1.12;
            const ids = host.refs.selectedItemIds.has(itemId) && host.refs.selectedItemIds.size > 1
              ? [...host.refs.selectedItemIds]
              : [itemId];
            scaleItemsByIds(ids, factor);
          });
        });
        row.querySelectorAll('[data-action="height-up"], [data-action="height-down"]').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const delta = btn.dataset.action === 'height-up' ? HEIGHT_STEP : -HEIGHT_STEP;
            const ids = host.refs.selectedItemIds.has(itemId) && host.refs.selectedItemIds.size > 1
              ? [...host.refs.selectedItemIds]
              : [itemId];
            adjustHeightForIds(ids, delta);
          });
        });
        const nameEl = row.querySelector('[data-action="rename-item"]');
        if (nameEl) {
          nameEl.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            nameEl.contentEditable = 'true';
            nameEl.focus();
          });
          nameEl.addEventListener('blur', () => {
            const layer = host.refs.userLayers.find(l => l.id === layerId);
            const item = layer && layer.items.find(it => it.id === itemId);
            if (item) {
              if (!item.props) item.props = {};
              item.props.name = nameEl.textContent.trim() || itemDisplayName(item);
              nameEl.contentEditable = 'false';
              Mahp.history.push();
              renderLayersList();
            }
          });
          nameEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
          });
        }
      });

      // Allow drop on empty expanded layer area
      list.querySelectorAll('.layer-items').forEach(box => {
        box.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
        box.addEventListener('drop', (e) => {
          if (e.target.closest('.layer-item-row')) return;
          e.preventDefault();
          const raw = e.dataTransfer.getData('text/plain');
          if (!raw.startsWith('item:')) return;
          const fromId = raw.slice(5);
          const ids = host.refs.selectedItemIds.has(fromId) && host.refs.selectedItemIds.size
            ? [...host.refs.selectedItemIds]
            : [fromId];
          reorderOrMoveItems(ids, box.dataset.layerId, null);
        });
      });
    }

    /** Move items to target layer, optionally insert before beforeItemId (null = append) */
    function reorderOrMoveItems(itemIds, targetLayerId, beforeItemId) {
      const target = host.refs.userLayers.find(l => l.id === targetLayerId);
      if (!target || target.locked) return;
      const moving = [];
      host.refs.userLayers.forEach(layer => {
        if (layer.locked && layer.id !== targetLayerId) return;
        layer.items = layer.items.filter(it => {
          if (itemIds.includes(it.id)) {
            moving.push(it);
            return false;
          }
          return true;
        });
      });
      if (!moving.length) return;
      if (beforeItemId) {
        const idx = target.items.findIndex(it => it.id === beforeItemId);
        if (idx >= 0) target.items.splice(idx, 0, ...moving);
        else target.items.push(...moving);
      } else {
        target.items.push(...moving);
      }
      host.refs.expandedLayers.add(targetLayerId);
      Mahp.history.push();
      renderLayersList();
      syncUserLayersToMap();
    }

        function deleteItems(ids) {
      if (!ids || !ids.length) return;
      host.refs.userLayers.forEach(layer => {
        if (layer.locked) return;
        layer.items = layer.items.filter(it => !ids.includes(it.id));
      });
      ids.forEach(id => host.refs.selectedItemIds.delete(id));
      // markedAreas lives in map.js — optional host hook
      if (typeof host.removeMarkedAreasByIds === 'function') {
        try { host.removeMarkedAreasByIds(ids); } catch (_) {}
      }
      if (Mahp.history && Mahp.history.push) Mahp.history.push();
      renderLayersList();
      syncUserLayersToMap();
    }


    function syncUserLayersToMap() {
      if (!host.getMap() || !host.getMap().isStyleLoaded()) return;

      // Remove previous user-layer-* layers/sources
      const style = host.getMap().getStyle();
      if (style && style.layers) {
        style.layers.slice().reverse().forEach(l => {
          if (l.id && l.id.startsWith('user-layer-')) {
            try { host.getMap().removeLayer(l.id); } catch (_) {}
          }
        });
      }
      if (style && style.sources) {
        Object.keys(style.sources).forEach(sid => {
          if (sid.startsWith('user-layer-')) {
            try { host.getMap().removeSource(sid); } catch (_) {}
          }
        });
      }

      // Add layers bottom → top (first in array = bottom)
      host.refs.userLayers.forEach(layer => {
        if (!layer.visible || !layer.items.length) return;
        const sourceId = 'user-layer-' + layer.id;
        const features = [];
        layer.items.forEach(item => {
          let height = getItemHeight(item);
          // Fence / barricade always get a standing height so extrusion + icons read as 3D
          if (height <= 0 && (item.type === 'fence' || item.type === 'barricade')) {
            height = item.type === 'fence' ? 2.5 : 1.5;
          }
          const baseProps = {
            itemId: item.id,
            itemType: item.type,
            color: (item.props && item.props.color) || '#1a73e8',
            text: (item.props && item.props.text) || '',
            selected: host.refs.selectedItemIds.has(item.id) ? 1 : 0,
            height: height,
            width: (item.props && item.props.width != null) ? Number(item.props.width) : 2.5
          };

          function pushFeature(geom, props) {
            if (!geom) return;
            features.push({ type: 'Feature', properties: props, geometry: geom });
            // Lines with height → thin wall polygon for extrusion
            if (props.height > 0 && geom.type === 'LineString' && geom.coordinates && geom.coordinates.length >= 2) {
              const wallW = (props.itemType === 'fence' || props.itemType === 'barricade') ? 0.6 : 1.8;
              const wall = lineToWallPolygon(geom.coordinates, wallW);
              if (wall) {
                features.push({
                  type: 'Feature',
                  properties: { ...props, itemType: props.itemType + '-wall', isWall: 1 },
                  geometry: wall
                });
              }
            }
            // Text / point with height → small footprint column
            if (props.height > 0 && geom.type === 'Point' && geom.coordinates) {
              const [lng, lat] = geom.coordinates;
              const d = 0.00002; // ~2m footprint
              const square = {
                type: 'Polygon',
                coordinates: [[
                  [lng - d, lat - d], [lng + d, lat - d],
                  [lng + d, lat + d], [lng - d, lat + d],
                  [lng - d, lat - d]
                ]]
              };
              features.push({
                type: 'Feature',
                properties: { ...props, itemType: (props.itemType || 'text') + '-col', isWall: 1 },
                geometry: square
              });
            }
          }

          if (item.type === 'group' && item.props && item.props.members) {
            item.props.members.forEach(m => {
              if (!m.geojson) return;
              const mh = getItemHeight(m) || height;
              pushFeature(m.geojson, {
                ...baseProps,
                itemType: m.type || 'group',
                color: (m.props && m.props.color) || baseProps.color,
                height: mh,
                text: (m.props && m.props.text) || ''
              });
            });
          } else if (item.geojson) {
            pushFeature(item.geojson, { ...baseProps, ...(item.props || {}), height });
          }
        });

        host.getMap().addSource(sourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features }
        });

        const opacity = layer.opacity;

        // Flat fill for polygons with no height
        host.getMap().addLayer({
          id: sourceId + '-fill',
          type: 'fill',
          source: sourceId,
          filter: [
            'all',
            ['==', ['geometry-type'], 'Polygon'],
            ['<=', ['coalesce', ['get', 'height'], 0], 0]
          ],
          paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': [
              'case',
              ['==', ['get', 'itemType'], 'mark-area'], opacity * 0.18,
              ['==', ['get', 'selected'], 1], opacity * 0.45,
              opacity * 0.32
            ]
          }
        });

        // 3D extrusions for items with height (polygons + line walls)
        host.getMap().addLayer({
          id: sourceId + '-extrusion',
          type: 'fill-extrusion',
          source: sourceId,
          filter: [
            'all',
            ['==', ['geometry-type'], 'Polygon'],
            ['>', ['coalesce', ['get', 'height'], 0], 0]
          ],
          paint: {
            'fill-extrusion-color': ['get', 'color'],
            'fill-extrusion-height': ['coalesce', ['get', 'height'], 0],
            'fill-extrusion-base': 0,
            // MapLibre: fill-extrusion-opacity must be a constant (no data expressions)
            'fill-extrusion-opacity': Math.min(0.95, (typeof opacity === 'number' ? opacity : 0.8) * 0.85)
          }
        });

        // Outline / lines — exclude fence/barricade (they use icon posts instead)
        host.getMap().addLayer({
          id: sourceId + '-line',
          type: 'line',
          source: sourceId,
          filter: [
            'all',
            ['in', ['geometry-type'], ['literal', ['LineString', 'Polygon']]],
            ['!', ['in', ['get', 'itemType'], ['literal', ['fence', 'barricade']]]]
          ],
          paint: {
            'line-color': ['get', 'color'],
            'line-width': [
              'case',
              ['==', ['get', 'itemType'], 'route'], 5,
              ['==', ['get', 'selected'], 1], ['+', ['coalesce', ['get', 'width'], 2.5], 1.5],
              ['==', ['get', 'itemType'], 'mark-area'], 3.5,
              ['coalesce', ['get', 'width'], 2.5]
            ],
            'line-opacity': [
              'case',
              ['==', ['get', 'itemType'], 'route'], opacity * 0.9,
              opacity
            ]
          }
        });
        // Thin base line under fence/barricade icons
        host.getMap().addLayer({
          id: sourceId + '-line-base',
          type: 'line',
          source: sourceId,
          filter: ['in', ['get', 'itemType'], ['literal', ['fence', 'barricade']]],
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 2,
            'line-opacity': opacity * 0.7
          }
        });

        // Icon posts along fence / barricade lines (lightweight 3D-ish feel when pitched)
        ensureFenceIcons();
        host.getMap().addLayer({
          id: sourceId + '-fence-icons',
          type: 'symbol',
          source: sourceId,
          filter: ['==', ['get', 'itemType'], 'fence'],
          layout: {
            'symbol-placement': 'line',
            'symbol-spacing': 18,
            'icon-image': 'fence-post',
            'icon-size': [
              'interpolate', ['linear'], ['zoom'],
              10, 0.7,
              14, 1.1,
              18, 1.6
            ],
            // Rotate with path direction, stand upright when the map is pitched
            'icon-rotation-alignment': 'map',
            'icon-pitch-alignment': 'viewport',
            'icon-keep-upright': true,
            'icon-anchor': 'bottom',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true
          },
          paint: { 'icon-opacity': opacity }
        });
        host.getMap().addLayer({
          id: sourceId + '-barricade-icons',
          type: 'symbol',
          source: sourceId,
          filter: ['==', ['get', 'itemType'], 'barricade'],
          layout: {
            'symbol-placement': 'line',
            'symbol-spacing': 16,
            'icon-image': 'barricade-post',
            'icon-size': [
              'interpolate', ['linear'], ['zoom'],
              10, 0.75,
              14, 1.15,
              18, 1.65
            ],
            'icon-rotation-alignment': 'map',
            'icon-pitch-alignment': 'viewport',
            'icon-keep-upright': true,
            'icon-anchor': 'bottom',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true
          },
          paint: { 'icon-opacity': opacity }
        });

        // Symbol text (backup) — font must exist in style glyphs
        host.getMap().addLayer({
          id: sourceId + '-text',
          type: 'symbol',
          source: sourceId,
          filter: [
            'all',
            ['==', ['geometry-type'], 'Point'],
            ['==', ['get', 'itemType'], 'text']
          ],
          layout: {
            'text-field': ['to-string', ['coalesce', ['get', 'text'], ['get', 'name'], '']],
            'text-font': ['Noto Sans Regular'],
            'text-size': 16,
            'text-anchor': 'center',
            'text-allow-overlap': true,
            'text-ignore-placement': true
          },
          paint: {
            'text-color': ['coalesce', ['get', 'color'], '#202124'],
            'text-halo-color': '#ffffff',
            'text-halo-width': 2,
            'text-opacity': opacity
          }
        });
      });

      // HTML markers for text items — always visible regardless of glyph atlas
      renderTextMarkers();

      applyLabelOrder();

      // Debounced durable content sync while in a share session
      if (host.getActiveShareScreen()) {
        clearTimeout(window._ssContentSyncTimer);
        window._ssContentSyncTimer = setTimeout(() => {
          try { host.pushShareScreenContent(); } catch (_) {}
        }, 350);
      }
    }

    function clearTextMarkers() {
      host.refs.textMarkers.forEach(m => {
        try { m.remove(); } catch (_) {}
      });
      host.refs.textMarkers = [];
    }

    /** Double-click a text tool label to edit its string in place */
    function beginEditTextItem(item) {
      if (!item || item.type !== 'text' || !item.geojson) return;
      const found = findItemById(item.id);
      if (found && found.layer.locked) {
        showInfo('This layer is locked.');
        return;
      }
      const box = document.getElementById('inline-text-box');
      const input = document.getElementById('inline-text-input');
      if (!box || !input || !host.getMap()) return;
      const coords = item.geojson.coordinates;
      const point = host.getMap().project(coords);
      box.style.display = 'block';
      box.style.left = point.x + 'px';
      box.style.top = (point.y - 14) + 'px';
      input.value = (item.props && (item.props.text || item.props.name)) || '';
      input.style.color = (item.props && item.props.color) || host.getActiveColor() || '#202124';
      input.focus();
      input.select();
      let finished = false;
      const finish = (cancel) => {
        if (finished) return;
        finished = true;
        const val = input.value.trim();
        box.style.display = 'none';
        input.removeEventListener('keydown', onKey);
        input.removeEventListener('blur', onBlur);
        if (!cancel && val) {
          if (!item.props) item.props = {};
          item.props.text = val;
          item.props.name = val;
          Mahp.history.push();
          syncUserLayersToMap();
          renderLayersList();
          try { if (typeof host.pushShareScreenPresence === 'function') host.pushShareScreenPresence(); } catch (_) {}
        } else if (!cancel && !val) {
          // empty → keep previous text
          renderTextMarkers();
        }
      };
      const onKey = (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); finish(false); }
        if (ev.key === 'Escape') { ev.preventDefault(); finish(true); }
      };
      const onBlur = () => setTimeout(() => finish(false), 150);
      input.addEventListener('keydown', onKey);
      input.addEventListener('blur', onBlur);
    }

    function renderTextMarkers() {
      clearTextMarkers();
      if (!host.getMap()) return;
      host.refs.userLayers.forEach(layer => {
        if (!layer.visible) return;
        layer.items.forEach(item => {
          if (item.type !== 'text' || !item.geojson || item.geojson.type !== 'Point') return;
          const coords = item.geojson.coordinates;
          if (!coords || coords.length < 2) return;
          const label = (item.props && (item.props.text || item.props.name)) || '';
          if (!label) return;
          const color = (item.props && item.props.color) || '#202124';
          const el = document.createElement('div');
          el.className = 'user-text-marker' + (host.refs.selectedItemIds.has(item.id) ? ' selected' : '');
          el.textContent = label;
          el.style.color = color;
          el.title = label;
          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (ev.shiftKey) {
              if (host.refs.selectedItemIds.has(item.id)) host.refs.selectedItemIds.delete(item.id);
              else host.refs.selectedItemIds.add(item.id);
            } else {
              host.refs.selectedItemIds = new Set([item.id]);
            }
            renderLayersList();
            renderTextMarkers();
          });
          el.addEventListener('dblclick', (ev) => {
            ev.stopPropagation();
            ev.preventDefault();
            beginEditTextItem(item);
          });
          const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat(coords)
            .addTo(host.getMap());
          host.refs.textMarkers.push(marker);
        });
      });
    }

    function ensureFenceIcons() {
      if (!host.getMap()) return;
      if (host.getMap().hasImage('fence-post') && host.getMap().hasImage('barricade-post')) {
        host.refs.fenceIconsReady = true;
        return;
      }

      // Synchronous canvas icons matching user SVGs so symbols never fail to appear
      function makeFenceCanvas() {
        const w = 28, h = 40;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        // two posts + center panel (user fence.svg proportions)
        ctx.fillStyle = '#5d4037';
        ctx.fillRect(2, 0, 6, 40);
        ctx.fillRect(20, 0, 6, 40);
        ctx.fillStyle = '#6d4c41';
        ctx.fillRect(8, 12, 12, 28);
        // slight highlight
        ctx.fillStyle = 'rgba(141,110,99,0.55)';
        ctx.fillRect(3, 0, 2, 40);
        ctx.fillRect(21, 0, 2, 40);
        return ctx.getImageData(0, 0, w, h);
      }

      function makeBarricadeCanvas() {
        const w = 36, h = 28;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        // two horizontal bars (user barricade.svg)
        ctx.fillStyle = '#e65100';
        ctx.fillRect(0, 1, 36, 11);
        ctx.fillRect(0, 16, 36, 11);
        // white stripe marks
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        [2, 12, 22].forEach(x => {
          ctx.fillRect(x, 3, 6, 7);
          ctx.fillRect(x, 18, 6, 7);
        });
        return ctx.getImageData(0, 0, w, h);
      }

      try {
        if (host.getMap().hasImage('fence-post')) host.getMap().removeImage('fence-post');
        if (host.getMap().hasImage('barricade-post')) host.getMap().removeImage('barricade-post');
      } catch (_) {}

      try {
        host.getMap().addImage('fence-post', makeFenceCanvas());
        host.getMap().addImage('barricade-post', makeBarricadeCanvas());
        host.refs.fenceIconsReady = true;
      } catch (e) {
        console.warn('Fence/barricade icon register failed', e);
        host.refs.fenceIconsReady = false;
      }

      // Optionally refine from /icons/*.svg when available (non-blocking)
      function upgradeFromSvg(url, imageId, width, height) {
        fetch(url).then(r => r.text()).then(svgText => {
          const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
          const objUrl = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, width, height);
            const scale = Math.min(width / img.width, height / img.height);
            const dw = img.width * scale, dh = img.height * scale;
            ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh);
            URL.revokeObjectURL(objUrl);
            try {
              if (host.getMap().hasImage(imageId)) host.getMap().removeImage(imageId);
              host.getMap().addImage(imageId, ctx.getImageData(0, 0, width, height));
              syncUserLayersToMap();
            } catch (err) { console.warn(err); }
          };
          img.onerror = () => URL.revokeObjectURL(objUrl);
          img.src = objUrl;
        }).catch(() => {});
      }
      upgradeFromSvg('/icons/fence.svg', 'fence-post', 28, 40);
      upgradeFromSvg('/icons/barricade.svg', 'barricade-post', 36, 28);
    }


    function applyLabelOrder() {
      if (!host.getMap()) return;
      const labelIds = ['index-labels-place', 'index-labels-street', 'index-labels-poi'];
      if (host.refs.labelsOnTop) {
        labelIds.forEach(id => {
          if (host.getMap().getLayer(id)) {
            try { host.getMap().moveLayer(id); } catch (_) {}
          }
        });
      } else {
        // Move user layers above labels
        host.refs.userLayers.forEach(layer => {
          ['-fill', '-extrusion', '-line', '-line-base', '-fence-icons', '-barricade-icons', '-text'].forEach(suffix => {
            const id = 'user-layer-' + layer.id + suffix;
            if (host.getMap().getLayer(id)) {
              try { host.getMap().moveLayer(id); } catch (_) {}
            }
          });
        });
      }
    }

    // ---------- Drawing tools ----------
    // Drawing tools → drawing/tools.js (Mahp.drawing.tools)

    function commitDraw(type, geometry, props = {}) {
      const layer = getActiveLayer();
      if (layer.locked) return;
      const defaultColors = {
        fence: '#5d4037',
        barricade: '#e65100',
        text: host.getActiveColor() || '#202124'
      };
      const defaultWidth = (Mahp.state && Mahp.state.lineWidth != null) ? Number(Mahp.state.lineWidth) : 2.5;
      const merged = {
        color: props.color || defaultColors[type] || host.getActiveColor() || '#1a73e8',
        name: props.name || undefined,
        height: props.height != null ? Number(props.height) : (type === 'fence' ? 2.5 : type === 'barricade' ? 1.5 : 0),
        width: props.width != null ? Number(props.width) : defaultWidth,
        ...props
      };
      if (merged.width == null) merged.width = defaultWidth;
      if (type === 'text') {
        merged.text = String(props.text || props.name || merged.text || '').trim();
        merged.name = merged.name || merged.text;
        if (!merged.text) return null;
      }
      const item = {
        id: uid(),
        type,
        geojson: geometry,
        props: merged
      };
      layer.items.push(item);
      host.refs.expandedLayers.add(layer.id);
      Mahp.history.push();
      renderLayersList();
      syncUserLayersToMap();
      try {
        if (host.getActiveShareScreen()) {
          host.pushShareScreenPresence();
          host.pushShareScreenContent();
        }
      } catch (_) {}
      return item;
    }

    // ---------- Export / Import ----------
    function exportLayers() {
      const payload = {
        type: 'mahp-layers',
        version: 2,
        exportedAt: new Date().toISOString(),
        labelsOnTop: host.refs.labelsOnTop,
        layers: host.refs.userLayers.map(l => ({
          id: l.id,
          name: l.name,
          visible: l.visible,
          locked: l.locked,
          opacity: l.opacity,
          items: l.items.map(it => ({
            id: it.id,
            type: it.type,
            // GeoJSON geometry already in [lng, lat]
            geometry: it.geojson,
            properties: it.props || {}
          }))
        }))
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mahp-layers-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(url);
    }

    function importLayers(file) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!data || !Array.isArray(data.layers)) {
            alert('Invalid layers file');
            return;
          }
          const newIds = [];
          data.layers.forEach(src => {
            const id = uid();
            newIds.push(id);
            host.refs.userLayers.push({
              id,
              name: src.name || 'Imported layer',
              visible: src.visible !== false,
              locked: !!src.locked,
              opacity: Math.min((host.MAX_LAYER_OPACITY), src.opacity != null ? src.opacity : (host.DEFAULT_LAYER_OPACITY)),
              items: (src.items || []).map(it => ({
                id: uid(),
                type: it.type || 'polyline',
                geojson: it.geometry || it.geojson,
                props: it.properties || it.props || {}
              }))
            });
            host.refs.activeLayerId = id;
            host.refs.expandedLayers.add(id);
          });
          if (typeof data.labelsOnTop === 'boolean') {
            host.refs.labelsOnTop = data.labelsOnTop;
            const cb = document.getElementById('labels-on-top');
            if (cb) cb.checked = host.refs.labelsOnTop;
          }
          renderLayersList();
          syncUserLayersToMap();
          // Zoom to imported content bounds
          zoomToLayers(newIds);
        } catch (err) {
          alert('Could not import: ' + err.message);
        }
      };
      reader.readAsText(file);
    }

    function zoomToLayers(layerIds) {
      if (!host.getMap()) return;
      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
      const visitCoords = (coords) => {
        if (typeof coords[0] === 'number') {
          const [lng, lat] = coords;
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        } else {
          coords.forEach(visitCoords);
        }
      };
      host.refs.userLayers.forEach(layer => {
        if (layerIds && !layerIds.includes(layer.id)) return;
        layer.items.forEach(item => {
          if (item.geojson && item.geojson.coordinates) visitCoords(item.geojson.coordinates);
        });
      });
      if (minLng < Infinity) {
        host.getMap().fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 60, duration: 800, maxZoom: 16 });
      }
    }

    if (typeof uid === "function") api.uid = uid;
    if (typeof ensureDefaultLayer === "function") api.ensureDefaultLayer = ensureDefaultLayer;
    if (typeof getActiveLayer === "function") api.getActiveLayer = getActiveLayer;
    if (typeof setupLayers === "function") api.setupLayers = setupLayers;
    if (typeof isScalableType === "function") api.isScalableType = isScalableType;
    if (typeof isHeightableType === "function") api.isHeightableType = isHeightableType;
    if (typeof getItemHeight === "function") api.getItemHeight = getItemHeight;
    if (typeof lineToWallPolygon === "function") api.lineToWallPolygon = lineToWallPolygon;
    if (typeof adjustHeightForIds === "function") api.adjustHeightForIds = adjustHeightForIds;
    if (typeof itemDisplayName === "function") api.itemDisplayName = itemDisplayName;
    if (typeof renderLayersList === "function") api.renderLayersList = renderLayersList;
    if (typeof reorderOrMoveItems === "function") api.reorderOrMoveItems = reorderOrMoveItems;
    if (typeof deleteItems === "function") api.deleteItems = deleteItems;
    if (typeof syncUserLayersToMap === "function") api.syncUserLayersToMap = syncUserLayersToMap;
    if (typeof clearTextMarkers === "function") api.clearTextMarkers = clearTextMarkers;
    if (typeof beginEditTextItem === "function") api.beginEditTextItem = beginEditTextItem;
    if (typeof renderTextMarkers === "function") api.renderTextMarkers = renderTextMarkers;
    if (typeof ensureFenceIcons === "function") api.ensureFenceIcons = ensureFenceIcons;
    if (typeof applyLabelOrder === "function") api.applyLabelOrder = applyLabelOrder;
    if (typeof exportLayers === "function") api.exportLayers = exportLayers;
    if (typeof importLayers === "function") api.importLayers = importLayers;
    if (typeof zoomToLayers === "function") api.zoomToLayers = zoomToLayers;
    if (typeof commitDraw === "function") api.commitDraw = commitDraw;
    if (typeof findItemById === "function") api.findItemById = findItemById;
    if (typeof scaleItemsByIds === "function") api.scaleItemsByIds = scaleItemsByIds;
    if (typeof groupSelectedItems === "function") api.groupSelectedItems = groupSelectedItems;
    if (typeof reorderOrMoveItems === "function") api.reorderOrMoveItems = reorderOrMoveItems;

    api.ensureDefault = api.ensureDefaultLayer;
    api.getActive = api.getActiveLayer;
    api.syncToMap = api.syncUserLayersToMap;
    api.setup = api.setupLayers;

    // Keep model surface in sync
    Mahp.layers.model = Mahp.layers.model || {};
    Mahp.layers.model.uid = api.uid;
    Mahp.layers.model.ensureDefault = api.ensureDefaultLayer;
    Mahp.layers.model.getActive = api.getActiveLayer;
    Mahp.layers.model.findItemById = api.findItemById || Mahp.layers.model.findItemById;

    api._installed = true;
    api._host = host;
    return api;
  }

  Mahp.layers.install = install;
})(typeof window !== "undefined" ? window : globalThis);
