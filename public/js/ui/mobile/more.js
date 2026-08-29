/**
 * ui/mobile/more.js
 * More menu: sharing mode UI, contribution flows, map preferences.
 */
(function (global) {
  'use strict';

  var Mahp = global.Mahp || (global.Mahp = {});
  Mahp.ui = Mahp.ui || {};
  Mahp.ui.mobile = Mahp.ui.mobile || {};

  function isMobile() {
    return document.documentElement.classList.contains('mahp-mobile');
  }

  function hasFeature(id) {
    return Mahp.hasFeature ? Mahp.hasFeature(id) : true;
  }

  function sheets() {
    return Mahp.ui.mobile.sheets;
  }

  function clickNav(action) {
    var nav = document.querySelector('.sidebar-nav .nav-item[data-action="' + action + '"]');
    if (nav && nav.style.display !== 'none') {
      nav.click();
      return true;
    }
    return false;
  }

  function clickTool(id) {
    var btn = document.getElementById(id);
    if (btn && btn.style.display !== 'none') {
      btn.click();
      return true;
    }
    return false;
  }

  /**
   * Open map.js panel content in a bottom tray (keeps live DOM + event handlers).
   * Uses the real #sidebar-panel so share-screen re-renders and form IDs keep working.
   */
  function openNavInTray(action, title) {
    var nav = document.querySelector('.sidebar-nav .nav-item[data-action="' + action + '"]');
    if (!nav) {
      if (sheets()) {
        sheets().open({
          title: title || 'Menu',
          height: 'half',
          html: '<p class="m-empty">Not available for this map key.</p>'
        });
      }
      return;
    }
    // Close More sheet first so it does not cover the panel tray
    if (sheets() && sheets().close) sheets().close();

    // Avoid toggle-close: if this action is already active and panel is open, just show tray
    var panel = document.getElementById('sidebar-panel');
    var already =
      panel &&
      panel.style.display !== 'none' &&
      nav.classList.contains('active');

    if (!already) {
      // If panel is open on another action, close first so next click always opens
      if (panel && panel.style.display !== 'none' && panel.style.display !== '') {
        var closeBtn = document.getElementById('sidebar-panel-close');
        if (closeBtn) closeBtn.click();
      }
      // Open the nav panel (map.js fills #generic-panel-content)
      nav.click();
    }

    setTimeout(function () {
      showPanelAsTray();
      var g = document.getElementById('generic-panel-content');
      if (g && (!g.innerHTML || !g.innerHTML.trim())) {
        // Retry once if content was empty (race with close/open)
        nav.click();
        setTimeout(showPanelAsTray, 120);
      }
    }, 120);
  }

  function showPanelAsTray() {
    var panel = document.getElementById('sidebar-panel');
    var sidebar = document.getElementById('sidebar');
    if (!panel) return;

    document.documentElement.classList.add('mahp-panel-tray');

    if (sidebar) {
      sidebar.style.setProperty('display', 'block', 'important');
      sidebar.style.position = 'fixed';
      sidebar.style.inset = '0';
      sidebar.style.zIndex = '42';
      sidebar.style.background = 'rgba(15,23,42,0.4)';
      sidebar.style.pointerEvents = 'auto';
      sidebar.style.width = '100%';
      sidebar.style.height = '100%';
    }

    panel.style.setProperty('display', 'flex', 'important');
    panel.style.flexDirection = 'column';
    panel.style.position = 'fixed';
    panel.style.left = '0';
    panel.style.right = '0';
    panel.style.bottom = 'calc(56px + env(safe-area-inset-bottom, 0px))';
    panel.style.top = 'auto';
    panel.style.width = '100%';
    panel.style.maxHeight = '70vh';
    panel.style.height = 'auto';
    panel.style.zIndex = '43';
    panel.style.pointerEvents = 'auto';
    panel.style.borderRadius = '16px 16px 0 0';
    panel.style.boxShadow = '0 -8px 32px rgba(15,23,42,0.18)';
    panel.style.background = '#fff';
    panel.style.overflow = 'hidden';

    // Soft handle bar for tray affordance
    if (!panel.querySelector('.m-tray-handle')) {
      var handle = document.createElement('div');
      handle.className = 'm-tray-handle';
      handle.setAttribute('aria-hidden', 'true');
      panel.insertBefore(handle, panel.firstChild);
    }

    var closer = function (e) {
      if (e.target === sidebar) {
        resetPanelTray();
        if (sidebar) sidebar.removeEventListener('click', closer);
      }
    };
    if (sidebar) {
      sidebar.addEventListener('click', closer);
    }
    var closeBtn = document.getElementById('sidebar-panel-close');
    if (closeBtn) {
      var once = function () {
        resetPanelTray();
        closeBtn.removeEventListener('click', once);
      };
      closeBtn.addEventListener('click', once);
    }
  }

  function resetPanelTray() {
    document.documentElement.classList.remove('mahp-panel-tray');
    var panel = document.getElementById('sidebar-panel');
    var sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.style.cssText = '';
    if (panel) {
      var handle = panel.querySelector('.m-tray-handle');
      if (handle) handle.remove();
      panel.style.cssText = '';
      panel.style.display = 'none';
    }
  }

  function openShareLink() {
    if (!hasFeature('share_embed')) {
      sheets().open({
        title: 'Share link',
        height: 'half',
        html: '<p class="m-empty">Sharing is not enabled for this key.</p>'
      });
      return;
    }
    openNavInTray('share', 'Share link');
  }

  function openShareScreen() {
    if (!hasFeature('share_screen') && !hasFeature('share_screen_create')) {
      sheets().open({
        title: 'Live share screen',
        height: 'half',
        html: '<p class="m-empty">Share screen is not enabled for this key.</p>'
      });
      return;
    }
    openNavInTray('sharescreen', 'Live share screen');
  }

  function openContribution(type) {
    var map = {
      missing_place: { action: 'missing', title: 'Add missing place', feat: 'missing_place' },
      business: { action: 'business', title: 'Add business', feat: 'business' },
      map_edit: { action: 'edit', title: 'Edit the map', feat: 'map_edit' }
    };
    var conf = map[type] || map.missing_place;
    if (conf.feat && !hasFeature(conf.feat)) {
      sheets().open({
        title: conf.title,
        height: 'half',
        html: '<p class="m-empty">Not enabled for this key.</p>'
      });
      return;
    }
    openNavInTray(conf.action, conf.title);
  }

  function open() {
    if (!sheets()) return;
    var sections = [
      {
        title: 'Map',
        items: [
          { action: 'saved', feat: 'saved_views', icon: 'fa-bookmark', label: 'Saved views' },
          { action: 'recents', feat: 'recents', icon: 'fa-clock-rotate-left', label: 'Recents' },
          { action: 'location', feat: 'trail', icon: 'fa-person-walking', label: 'Movement trail' },
          {
            action: 'landmarks',
            feat: 'nearest_landmark',
            icon: 'fa-landmark',
            label: 'Nearest landmarks'
          }
        ]
      },
      {
        title: 'Sharing',
        items: [
          { special: 'share', feat: 'share_embed', icon: 'fa-share-nodes', label: 'Share link' },
          {
            special: 'sharescreen',
            feat: 'share_screen',
            icon: 'fa-display',
            label: 'Live share screen'
          }
        ]
      },
      {
        title: 'Contribute',
        items: [
          {
            special: 'contrib-missing',
            feat: 'missing_place',
            icon: 'fa-map-pin',
            label: 'Add missing place'
          },
          {
            special: 'contrib-business',
            feat: 'business',
            icon: 'fa-store',
            label: 'Add business'
          },
          { special: 'contrib-edit', feat: 'map_edit', icon: 'fa-pen', label: 'Edit the map' }
        ]
      },
      // Satellite / 3D live on the Workspace tray (mobile); not repeated here
    ];

    var html = '<ul class="m-more-list">';
    sections.forEach(function (sec) {
      var itemsHtml = '';
      sec.items.forEach(function (it) {
        if (it.feat && !hasFeature(it.feat)) {
          // share_screen_create alone
          if (it.special === 'sharescreen' && hasFeature('share_screen_create')) {
            /* allow */
          } else return;
        }
        if (it.tool) {
          var el = document.getElementById(it.tool);
          if (el && el.style.display === 'none') return;
          itemsHtml +=
            '<li><button type="button" class="m-more-item" data-tool="' +
            it.tool +
            '"><i class="fa-solid ' +
            it.icon +
            '"></i><span>' +
            it.label +
            '</span></button></li>';
        } else if (it.special) {
          itemsHtml +=
            '<li><button type="button" class="m-more-item" data-special="' +
            it.special +
            '"><i class="fa-solid ' +
            it.icon +
            '"></i><span>' +
            it.label +
            '</span></button></li>';
        } else {
          var nav = document.querySelector(
            '.sidebar-nav .nav-item[data-action="' + it.action + '"]'
          );
          if (nav && nav.style.display === 'none') return;
          itemsHtml +=
            '<li><button type="button" class="m-more-item" data-action="' +
            it.action +
            '"><i class="fa-solid ' +
            it.icon +
            '"></i><span>' +
            it.label +
            '</span></button></li>';
        }
      });
      if (!itemsHtml) return;
      html += '<li class="m-more-section">' + sec.title + '</li>' + itemsHtml;
    });
    html += '</ul>';

    sheets().open({
      title: 'More',
      height: 'full',
      html: html,
      onOpen: function (body) {
        body.querySelectorAll('.m-more-item').forEach(function (item) {
          item.addEventListener('click', function () {
            var tool = item.getAttribute('data-tool');
            var action = item.getAttribute('data-action');
            var special = item.getAttribute('data-special');
            if (special === 'share') {
              openShareLink();
              return;
            }
            if (special === 'sharescreen') {
              openShareScreen();
              return;
            }
            if (special === 'contrib-missing') {
              openContribution('missing_place');
              return;
            }
            if (special === 'contrib-business') {
              openContribution('business');
              return;
            }
            if (special === 'contrib-edit') {
              openContribution('map_edit');
              return;
            }
            if (tool) {
              sheets().close();
              setTimeout(function () { clickTool(tool); }, 50);
              return;
            }
            if (action) {
              var label = (item.querySelector('span') && item.querySelector('span').textContent) || action;
              openNavInTray(action, label.trim());
            }
          });
        });
      }
    });
  }

  function setup() {
    // no-op; open() is entry point
  }

  Mahp.ui.mobile.more = {
    setup: setup,
    open: open,
    openShareLink: openShareLink,
    openShareScreen: openShareScreen,
    openContribution: openContribution,
    resetOverlay: resetPanelTray
  };
})(typeof window !== 'undefined' ? window : globalThis);
