/**
 * ui/mobile/shell.js — Phase 2 mobile shell
 * Bottom nav: Map | Explore | Create | Workspace | More
 * Activates on narrow / touch viewports without breaking desktop.
 */
(function (global) {
  'use strict';

  var Mahp = global.Mahp || (global.Mahp = {});
  Mahp.ui = Mahp.ui || {};
  Mahp.ui.mobile = Mahp.ui.mobile || {};

  var MQ = '(max-width: 768px), ((hover: none) and (pointer: coarse) and (max-width: 1024px))';
  var activeTab = 'map';
  var mounted = false;
  var mqList = null;

  function hasFeature(id) {
    if (Mahp.hasFeature) return Mahp.hasFeature(id);
    return true;
  }

  function shouldActivate() {
    try {
      return window.matchMedia(MQ).matches;
    } catch (_) {
      return window.innerWidth <= 768;
    }
  }

  function setMobileClass(on) {
    document.documentElement.classList.toggle('mahp-mobile', !!on);
  }

  function resizeMap() {
    try {
      var map = Mahp.state && Mahp.state.map;
      if (map && typeof map.resize === 'function') {
        setTimeout(function () {
          map.resize();
        }, 50);
      }
    } catch (_) {}
  }

  function ensureDom() {
    if (document.getElementById('m-bottom-nav')) return;

    var nav = document.createElement('nav');
    nav.id = 'm-bottom-nav';
    nav.className = 'm-bottom-nav';
    nav.setAttribute('role', 'navigation');
    nav.setAttribute('aria-label', 'Main');
    nav.innerHTML =
      tabBtn('map', 'fa-map', 'Map') +
      tabBtn('explore', 'fa-magnifying-glass', 'Explore') +
      tabBtn('create', 'fa-plus', 'Create') +
      tabBtn('layers', 'fa-layer-group', 'Workspace') +
      tabBtn('more', 'fa-ellipsis', 'More');
    document.body.appendChild(nav);

    var backdrop = document.createElement('div');
    backdrop.id = 'm-sheet-backdrop';
    backdrop.className = 'm-sheet-backdrop';
    document.body.appendChild(backdrop);

    var sheet = document.createElement('div');
    sheet.id = 'm-sheet';
    sheet.className = 'm-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.innerHTML =
      '<div class="m-sheet-handle" aria-hidden="true"></div>' +
      '<div class="m-sheet-header">' +
      '<h2 id="m-sheet-title">Menu</h2>' +
      '<button type="button" class="m-sheet-close" id="m-sheet-close" aria-label="Close">' +
      '<i class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="m-sheet-body" id="m-sheet-body"></div>';
    document.body.appendChild(sheet);

    nav.addEventListener('click', onNavClick);
    backdrop.addEventListener('click', closeSheet);
    document.getElementById('m-sheet-close').addEventListener('click', closeSheet);
  }

  function tabBtn(id, icon, label) {
    return (
      '<button type="button" class="m-nav-tab" data-tab="' +
      id +
      '" aria-label="' +
      label +
      '">' +
      '<i class="fa-solid ' +
      icon +
      '"></i><span>' +
      label +
      '</span></button>'
    );
  }

  function onNavClick(e) {
    var btn = e.target.closest('.m-nav-tab');
    if (!btn) return;
    var tab = btn.getAttribute('data-tab');
    setTab(tab);
  }

  function highlightTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.m-nav-tab').forEach(function (el) {
      el.classList.toggle('active', el.getAttribute('data-tab') === tab);
    });
  }

  function setTab(tab) {
    highlightTab(tab);
    if (tab === 'map') {
      closeSheet();
      blurSearch();
      return;
    }
    if (tab === 'explore') {
      closeSheet();
      focusSearch();
      return;
    }
    if (tab === 'create') {
      openCreateSheet();
      return;
    }
    if (tab === 'layers') {
      closeSheet();
      openLayers();
      return;
    }
    if (tab === 'more') {
      openMoreSheet();
    }
  }

  function focusSearch() {
    var input = document.getElementById('search-input');
    if (!input) return;
    input.focus();
    try {
      input.scrollIntoView({ block: 'nearest' });
    } catch (_) {}
  }

  function blurSearch() {
    var input = document.getElementById('search-input');
    if (input) input.blur();
    var results = document.getElementById('search-results');
    if (results) results.style.display = 'none';
  }

  function openSheet(title, html) {
    if (Mahp.ui.mobile.sheets && Mahp.ui.mobile.sheets.open) {
      Mahp.ui.mobile.sheets.open({ title: title, html: html, height: 'half' });
      return;
    }
    var sheet = document.getElementById('m-sheet');
    var backdrop = document.getElementById('m-sheet-backdrop');
    var body = document.getElementById('m-sheet-body');
    var titleEl = document.getElementById('m-sheet-title');
    if (!sheet || !body) return;
    titleEl.textContent = title;
    body.innerHTML = html;
    sheet.classList.add('open');
    backdrop.classList.add('open');
    sheet.style.display = 'flex';
  }

  function closeSheet() {
    if (Mahp.ui.mobile.sheets && Mahp.ui.mobile.sheets.close) {
      Mahp.ui.mobile.sheets.close();
    } else {
      var sheet = document.getElementById('m-sheet');
      var backdrop = document.getElementById('m-sheet-backdrop');
      if (sheet) {
        sheet.classList.remove('open');
        setTimeout(function () {
          if (sheet && !sheet.classList.contains('open')) sheet.style.display = 'none';
        }, 280);
      }
      if (backdrop) backdrop.classList.remove('open');
    }
    if (activeTab === 'create' || activeTab === 'more' || activeTab === 'layers') {
      highlightTab('map');
    }
    resetDesktopPanelOverlay();
  }

  function clickDesktopTool(id) {
    var btn = document.getElementById(id);
    if (btn && btn.style.display !== 'none') {
      btn.click();
      return true;
    }
    return false;
  }

  function openCreateSheet() {
    if (Mahp.ui.mobile.create && Mahp.ui.mobile.create.openMenu) {
      Mahp.ui.mobile.create.openMenu();
      return;
    }
    openSheet('Create', '<p class="m-empty">Create menu unavailable.</p>');
  }

  function openLayers() {
    if (!hasFeature('layers')) {
      openSheet('Workspace', '<p class="m-empty">Workspace not available for this key.</p>');
      return;
    }
    if (Mahp.ui.mobile.layersSheet && Mahp.ui.mobile.layersSheet.open) {
      Mahp.ui.mobile.layersSheet.open();
      return;
    }
    openSheet('Workspace', '<p class="m-empty">Workspace sheet unavailable.</p>');
  }

  function showDesktopPanelAsOverlay() {
    var panel = document.getElementById('sidebar-panel');
    var sidebar = document.getElementById('sidebar');
    if (!panel) return;
    // Temporarily reveal panel full-width over map
    if (sidebar) {
      sidebar.style.display = 'block';
      sidebar.style.position = 'fixed';
      sidebar.style.inset = '0';
      sidebar.style.zIndex = '42';
      sidebar.style.background = 'transparent';
      sidebar.style.pointerEvents = 'none';
    }
    panel.style.display = 'flex';
    panel.style.position = 'fixed';
    panel.style.left = '0';
    panel.style.right = '0';
    panel.style.bottom = 'calc(56px + env(safe-area-inset-bottom, 0px))';
    panel.style.top = 'auto';
    panel.style.width = '100%';
    panel.style.maxHeight = '70vh';
    panel.style.zIndex = '43';
    panel.style.pointerEvents = 'auto';
    panel.style.borderRadius = '16px 16px 0 0';
    panel.style.boxShadow = '0 -4px 24px rgba(15,23,42,0.12)';

    var closeBtn = document.getElementById('sidebar-panel-close');
    if (closeBtn) {
      var once = function () {
        resetDesktopPanelOverlay();
        highlightTab('map');
        closeBtn.removeEventListener('click', once);
      };
      closeBtn.addEventListener('click', once);
    }
  }

  function resetDesktopPanelOverlay() {
    var panel = document.getElementById('sidebar-panel');
    var sidebar = document.getElementById('sidebar');
    if (sidebar) {
      sidebar.style.cssText = '';
    }
    if (panel) {
      panel.style.cssText = '';
      panel.style.display = 'none';
    }
  }

  function openMoreSheet() {
    if (Mahp.ui.mobile.more && Mahp.ui.mobile.more.open) {
      Mahp.ui.mobile.more.open();
      return;
    }
    openSheet('More', '<p class="m-empty">More menu unavailable.</p>');
  }


  function applyMode() {
    var on = shouldActivate();
    setMobileClass(on);
    if (on) {
      ensureDom();
      ensureUserChip();
      highlightTab(activeTab || 'map');
    } else {
      closeSheet();
      resetDesktopPanelOverlay();
    }
    resizeMap();
  }


  function ensureUserChip() {
    if (document.getElementById('m-user-chip')) return;
    var top = document.querySelector('.top-bar');
    if (!top) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'm-user-chip';
    btn.title = 'Your name';
    btn.setAttribute('aria-label', 'Your name');
    btn.innerHTML = '<i class="fa-solid fa-user"></i>';
    btn.addEventListener('click', function () {
      if (typeof Mahp.openUserNameOverlay === 'function') {
        Mahp.openUserNameOverlay({});
        return;
      }
      if (Mahp.share && Mahp.share.screen && Mahp.share.screen._host &&
          typeof Mahp.share.screen._host.openUserNameOverlay === 'function') {
        Mahp.share.screen._host.openUserNameOverlay({});
        return;
      }
      var d = document.getElementById('btn-user-name');
      if (d) d.click();
    });
    top.appendChild(btn);
  }

  function setup() {
    if (mounted) {
      applyMode();
      return;
    }
    mounted = true;
    ensureDom();
    applyMode();
    try {
      if (Mahp.ui.mobile.explore && Mahp.ui.mobile.explore.setup) Mahp.ui.mobile.explore.setup();
      if (Mahp.ui.mobile.create && Mahp.ui.mobile.create.setup) Mahp.ui.mobile.create.setup();
      if (Mahp.ui.mobile.layersSheet && Mahp.ui.mobile.layersSheet.setup) Mahp.ui.mobile.layersSheet.setup();
      if (Mahp.ui.mobile.more && Mahp.ui.mobile.more.setup) Mahp.ui.mobile.more.setup();
    } catch (e) {
      console.warn('mobile phase3 setup', e);
    }

    mqList = window.matchMedia(MQ);
    var onChange = function () {
      applyMode();
    };
    if (mqList.addEventListener) mqList.addEventListener('change', onChange);
    else if (mqList.addListener) mqList.addListener(onChange);

    window.addEventListener('orientationchange', function () {
      setTimeout(applyMode, 200);
    });
    window.addEventListener('resize', function () {
      // debounce lightly
      clearTimeout(setup._rt);
      setup._rt = setTimeout(applyMode, 150);
    });
  }

  Mahp.ui.mobile.shell = {
    shouldActivate: shouldActivate,
    setup: setup,
    setTab: setTab,
    closeSheet: closeSheet,
    applyMode: applyMode,
    ensureDom: ensureDom
  };
})(typeof window !== 'undefined' ? window : globalThis);
