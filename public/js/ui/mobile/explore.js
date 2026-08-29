/**
 * ui/mobile/explore.js — search results + place details as bottom sheets.
 */
(function (global) {
  'use strict';

  var Mahp = global.Mahp || (global.Mahp = {});
  Mahp.ui = Mahp.ui || {};
  Mahp.ui.mobile = Mahp.ui.mobile || {};

  function isMobile() {
    return document.documentElement.classList.contains('mahp-mobile');
  }

  function sheets() {
    return Mahp.ui.mobile.sheets;
  }

  function esc(s) {
    return Mahp.escapeHtml ? Mahp.escapeHtml(s) : String(s || '');
  }

  function showResults(results, query) {
    if (!isMobile() || !sheets()) return;
    var resultsEl = document.getElementById('search-results');
    if (resultsEl) resultsEl.style.display = 'none';

    if (!results || !results.length) {
      sheets().open({
        title: 'Search',
        height: 'peek',
        html:
          '<p class="m-empty">No results for “' +
          esc(query) +
          '”</p>'
      });
      return;
    }

    var html = '<ul class="m-result-list">';
    results.forEach(function (r, i) {
      html +=
        '<li><button type="button" class="m-result-item" data-idx="' +
        i +
        '">' +
        '<span class="m-result-name">' +
        esc(r.name) +
        '</span>' +
        '<span class="m-result-type">' +
        esc(r.type || '') +
        '</span></button></li>';
    });
    html += '</ul>';

    sheets().open({
      title: 'Results',
      height: 'half',
      html: html,
      onOpen: function (body) {
        body.querySelectorAll('.m-result-item').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var idx = +btn.getAttribute('data-idx');
            var r = results[idx];
            if (!r) return;
            selectPlace({
              lat: +r.lat,
              lon: +r.lon,
              name: r.name,
              type: r.type
            });
          });
        });
      }
    });
  }

  function selectPlace(place) {
    if (!place) return;
    if (Mahp.search && Mahp.search.createSearchMarker) {
      Mahp.search.createSearchMarker(place.lon, place.lat, place.name);
    }
    var map = Mahp.state && Mahp.state.map;
    if (map) map.flyTo({ center: [place.lon, place.lat], zoom: 16 });
    if (Mahp.search && Mahp.search.addRecentSearch) {
      Mahp.search.addRecentSearch(place.name, place);
    }
    var input = document.getElementById('search-input');
    if (input) input.value = place.name;
    showPlaceDetails(place);
  }

  function showPlaceDetails(place) {
    if (!isMobile() || !sheets()) return;
    var canRoute = !Mahp.hasFeature || Mahp.hasFeature('route');
    var html =
      '<div class="m-place">' +
      '<div class="m-place-name">' +
      esc(place.name) +
      '</div>' +
      (place.type
        ? '<div class="m-place-type">' + esc(place.type) + '</div>'
        : '') +
      '<div class="m-place-coords">' +
      Number(place.lat).toFixed(5) +
      ', ' +
      Number(place.lon).toFixed(5) +
      '</div>' +
      '<div class="m-place-actions">' +
      '<button type="button" class="m-btn m-btn-secondary" id="m-place-goto">' +
      '<i class="fa-solid fa-location-arrow"></i> Go to</button>' +
      (canRoute
        ? '<button type="button" class="m-btn m-btn-primary" id="m-place-route">' +
          '<i class="fa-solid fa-route"></i> Route here</button>'
        : '') +
      '</div></div>';

    sheets().open({
      title: 'Place',
      height: 'peek',
      html: html,
      onOpen: function (body) {
        var gotoBtn = body.querySelector('#m-place-goto');
        if (gotoBtn) {
          gotoBtn.addEventListener('click', function () {
            var map = Mahp.state && Mahp.state.map;
            if (map) {
              map.flyTo({
                center: [place.lon, place.lat],
                zoom: Math.max(map.getZoom(), 15),
                essential: true
              });
            }
            if (Mahp.search && Mahp.search.createSearchMarker) {
              Mahp.search.createSearchMarker(place.lon, place.lat, place.name);
            }
            sheets().close();
          });
        }
        var routeBtn = body.querySelector('#m-place-route');
        if (routeBtn) {
          routeBtn.addEventListener('click', function () {
            var dest = { lat: place.lat, lon: place.lon, name: place.name };
            if (typeof window.showDestinationCard === 'function') {
              window.showDestinationCard(dest);
            }
            if (Mahp.route && typeof Mahp.route.routeFromMyLocationTo === 'function') {
              Mahp.route.routeFromMyLocationTo(dest);
            } else if (typeof window.routeFromMyLocationTo === 'function') {
              window.routeFromMyLocationTo(dest);
            } else {
              var btn = document.getElementById('btn-route');
              if (btn) btn.click();
              if (Mahp.showInfo) {
                Mahp.showInfo(
                  '<strong>Route</strong><p style="margin-top:6px;font-size:0.9rem;color:#5f6368">Destination: “' +
                    esc(place.name) +
                    '”. Tap your start point or use directions from your location.</p>'
                );
              }
            }
            sheets().close();
          });
        }
      }
    });
  }

  function setup() {
    if (!Mahp.search) return;
    Mahp.search._onResults = function (results, q) {
      if (!isMobile()) return;
      showResults(results, q);
    };
    Mahp.search._onPlaceSelect = function (place) {
      if (!isMobile()) return;
      showPlaceDetails(place);
    };
  }

  Mahp.ui.mobile.explore = {
    setup: setup,
    openSearch: function () {
      var input = document.getElementById('search-input');
      if (input) input.focus();
    },
    showResults: showResults,
    showPlaceDetails: showPlaceDetails
  };
})(typeof window !== 'undefined' ? window : globalThis);
