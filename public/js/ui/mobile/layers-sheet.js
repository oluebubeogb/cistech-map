/**
 * ui/mobile/layers-sheet.js
 * Layer name (collapse)
 *   item  [delete]
 *   item  [delete]
 */
(function (global) {
  'use strict';

  var Mahp = global.Mahp || (global.Mahp = {});
  Mahp.ui = Mahp.ui || {};
  Mahp.ui.mobile = Mahp.ui.mobile || {};

  // Local UI state — survives re-render of the sheet
  var collapsedIds = {}; // id -> true if collapsed
  var initedDefault = false;

  function esc(s) {
    return Mahp.escapeHtml ? Mahp.escapeHtml(s) : String(s == null ? '' : s);
  }

  function getLayers() {
    if (Mahp.layers && Mahp.layers._host && Mahp.layers._host.refs) {
      return Mahp.layers._host.refs.userLayers || [];
    }
    if (Mahp.state && Mahp.state.userLayers) return Mahp.state.userLayers;
    return [];
  }

  function getRefs() {
    return (Mahp.layers && Mahp.layers._host && Mahp.layers._host.refs) || null;
  }

  function itemName(item) {
    if (Mahp.layers && Mahp.layers.itemDisplayName) return Mahp.layers.itemDisplayName(item);
    if (item.props && item.props.name) return item.props.name;
    if (item.type === 'text' && item.props && item.props.text) return item.props.text;
    return String(item.type || 'item').replace(/-/g, ' ');
  }

  function refreshDesktop() {
    if (Mahp.layers && Mahp.layers.renderLayersList) Mahp.layers.renderLayersList();
    if (Mahp.layers && Mahp.layers.syncUserLayersToMap) Mahp.layers.syncUserLayersToMap();
  }

  function isExpanded(id) {
    return !collapsedIds[id];
  }

  function toggleExpand(id) {
    collapsedIds[id] = !collapsedIds[id];
  }

  function bindDblTapRename(el, onCommit) {
    var lastTap = 0;
    el.addEventListener('click', function (e) {
      var now = Date.now();
      if (now - lastTap < 350) {
        e.preventDefault();
        e.stopPropagation();
        startInlineEdit(el, onCommit);
        lastTap = 0;
      } else {
        lastTap = now;
      }
    });
  }

  function startInlineEdit(el, onCommit) {
    if (el.getAttribute('contenteditable') === 'true') return;
    var prev = el.textContent;
    el.setAttribute('contenteditable', 'true');
    el.focus();
    try {
      var range = document.createRange();
      range.selectNodeContents(el);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
    var done = function () {
      el.removeAttribute('contenteditable');
      el.removeEventListener('blur', done);
      el.removeEventListener('keydown', onKey);
      var val = (el.textContent || '').trim();
      if (!val) {
        el.textContent = prev;
        return;
      }
      onCommit(val);
    };
    var onKey = function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        el.blur();
      }
      if (ev.key === 'Escape') {
        el.textContent = prev;
        el.blur();
      }
    };
    el.addEventListener('blur', done);
    el.addEventListener('keydown', onKey);
  }

  function open() {
    if (!Mahp.ui.mobile.sheets) return;
    if (Mahp.layers && Mahp.layers.ensureDefaultLayer) Mahp.layers.ensureDefaultLayer();

    var layers = getLayers();
    var refs = getRefs();
    var activeId = refs ? refs.activeLayerId : null;

    // First open only: leave layers expanded (collapsedIds empty = all expanded)
    if (!initedDefault && layers.length) {
      initedDefault = true;
    }

    var html =
      '<div class="m-workspace-views">' +
      '<button type="button" class="m-workspace-view-btn" id="m-ws-satellite" data-tool="btn-satellite">' +
      '<i class="fa-solid fa-globe"></i><span>Satellite</span></button>' +
      '<button type="button" class="m-workspace-view-btn" id="m-ws-3d" data-tool="btn-3d">' +
      '<i class="fa-solid fa-cube"></i><span>3D</span></button>' +
      '</div>' +
      '<div class="m-layers-toolbar">' +
      '<button type="button" class="text-action" id="m-layer-add"><i class="fa-solid fa-plus"></i> Add layer</button>' +
      '</div>';

    if (!layers.length) {
      html += '<p class="m-empty">No layers yet.</p>';
    } else {
      html += '<ul class="m-layer-list m-layer-list-tree">';
      layers.forEach(function (layer) {
        var isActive = layer.id === activeId;
        var isExp = isExpanded(layer.id);
        var count = layer.items ? layer.items.length : 0;

        html +=
          '<li class="m-layer-block' +
          (isActive ? ' active' : '') +
          '" data-id="' +
          esc(layer.id) +
          '">' +
          '<div class="m-layer-parent">' +
          '<button type="button" class="m-layer-chevron" data-action="expand" aria-expanded="' +
          (isExp ? 'true' : 'false') +
          '"><i class="fa-solid fa-chevron-' +
          (isExp ? 'down' : 'right') +
          '"></i></button>' +
          '<button type="button" class="m-layer-vis" data-action="vis" title="Visibility">' +
          '<i class="fa-solid ' +
          (layer.visible !== false ? 'fa-eye' : 'fa-eye-slash') +
          '"></i></button>' +
          '<button type="button" class="m-layer-parent-main" data-action="activate">' +
          '<span class="m-layer-name" data-action="rename-layer">' +
          esc(layer.name) +
          '</span>' +
          '<span class="m-layer-count">' +
          count +
          '</span></button>' +
          '</div>';

        if (isExp) {
          if (count) {
            html += '<ul class="m-layer-children">';
            layer.items.forEach(function (item) {
              html +=
                '<li class="m-layer-child" data-item-id="' +
                esc(item.id) +
                '" data-layer-id="' +
                esc(layer.id) +
                '">' +
                '<span class="m-layer-child-name" data-action="rename-item">' +
                esc(itemName(item)) +
                '</span>' +
                '<button type="button" class="m-layer-child-del" data-action="delete-item" title="Delete" aria-label="Delete">' +
                '<i class="fa-solid fa-trash-can"></i></button>' +
                '</li>';
            });
            html += '</ul>';
          } else {
            html += '<p class="m-layer-empty">No items</p>';
          }
        }

        html += '</li>';
      });
      html += '</ul>';
    }

    Mahp.ui.mobile.sheets.open({
      title: 'Workspace',
      height: 'half',
      html: html,
      onOpen: function (body) {
        var add = body.querySelector('#m-layer-add');
        if (add) {
          add.addEventListener('click', function () {
            var btn = document.getElementById('btn-add-layer');
            if (btn) btn.click();
            setTimeout(open, 80);
          });
        }

        // Satellite / 3D at top of Workspace tray (mobile only)
        body.querySelectorAll('.m-workspace-view-btn').forEach(function (vb) {
          var toolId = vb.getAttribute('data-tool');
          var src = toolId ? document.getElementById(toolId) : null;
          if (src && src.classList.contains('active')) vb.classList.add('active');
          if (src && src.style.display === 'none') vb.style.display = 'none';
          vb.addEventListener('click', function () {
            if (src) src.click();
            // Reflect active state after toggle
            setTimeout(function () {
              body.querySelectorAll('.m-workspace-view-btn').forEach(function (b) {
                var tid = b.getAttribute('data-tool');
                var el = tid ? document.getElementById(tid) : null;
                b.classList.toggle('active', !!(el && el.classList.contains('active')));
              });
            }, 50);
          });
        });

        body.querySelectorAll('.m-layer-block').forEach(function (block) {
          var id = block.getAttribute('data-id');

          var expBtn = block.querySelector('[data-action="expand"]');
          if (expBtn) {
            expBtn.addEventListener('click', function (e) {
              e.preventDefault();
              e.stopPropagation();
              toggleExpand(id);
              open();
            });
          }

          // Tapping the layer name row also toggles collapse (common mobile pattern)
          var parentMain = block.querySelector('[data-action="activate"]');
          if (parentMain) {
            parentMain.addEventListener('click', function (e) {
              // If double-tap rename target, don't toggle
              if (e.target && e.target.getAttribute && e.target.getAttribute('data-action') === 'rename-layer') {
                // still allow single-tap to activate + toggle via chevron only for rename span
              }
              var r = getRefs();
              if (r) r.activeLayerId = id;
              refreshDesktop();
              // Activate only — collapse is chevron; avoid fighting rename
              open();
            });
          }

          var vis = block.querySelector('[data-action="vis"]');
          if (vis) {
            vis.addEventListener('click', function (e) {
              e.preventDefault();
              e.stopPropagation();
              var list = getLayers();
              for (var i = 0; i < list.length; i++) {
                if (list[i].id === id) {
                  list[i].visible = list[i].visible === false;
                  break;
                }
              }
              refreshDesktop();
              open();
            });
          }

          var nameEl = block.querySelector('[data-action="rename-layer"]');
          if (nameEl) {
            bindDblTapRename(nameEl, function (val) {
              var list = getLayers();
              for (var i = 0; i < list.length; i++) {
                if (list[i].id === id) {
                  list[i].name = val;
                  break;
                }
              }
              refreshDesktop();
            });
          }
        });

        body.querySelectorAll('.m-layer-child').forEach(function (row) {
          var itemId = row.getAttribute('data-item-id');
          var layerId = row.getAttribute('data-layer-id');

          var nameEl = row.querySelector('[data-action="rename-item"]');
          if (nameEl) {
            bindDblTapRename(nameEl, function (val) {
              var list = getLayers();
              for (var i = 0; i < list.length; i++) {
                if (list[i].id !== layerId) continue;
                var items = list[i].items || [];
                for (var j = 0; j < items.length; j++) {
                  if (items[j].id === itemId) {
                    if (!items[j].props) items[j].props = {};
                    items[j].props.name = val;
                    if (items[j].type === 'text') items[j].props.text = val;
                    break;
                  }
                }
              }
              refreshDesktop();
            });
          }

          var del = row.querySelector('[data-action="delete-item"]');
          if (del) {
            del.addEventListener('click', function (e) {
              e.preventDefault();
              e.stopPropagation();
              if (Mahp.layers && Mahp.layers.deleteItems) {
                Mahp.layers.deleteItems([itemId]);
              } else {
                var list = getLayers();
                for (var i = 0; i < list.length; i++) {
                  if (list[i].id !== layerId) continue;
                  list[i].items = (list[i].items || []).filter(function (it) {
                    return it.id !== itemId;
                  });
                }
                refreshDesktop();
              }
              setTimeout(open, 50);
            });
          }

          row.addEventListener('click', function (e) {
            if (e.target.closest('[data-action="delete-item"]')) return;
            var r = getRefs();
            if (!r || !r.selectedItemIds) return;
            r.selectedItemIds.clear();
            r.selectedItemIds.add(itemId);
            refreshDesktop();
          });
        });
      }
    });
  }

  Mahp.ui.mobile.layersSheet = {
    setup: function () {},
    open: open
  };
})(typeof window !== 'undefined' ? window : globalThis);
