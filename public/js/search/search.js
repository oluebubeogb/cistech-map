/**
 * search/search.js
 * Place search UI + marker + recents persistence.
 */
(function (global) {
  'use strict';

  var Mahp = global.Mahp || (global.Mahp = {});

  var searchMarker = null;
  var deps = {
    iconForType: null
  };

  function getMap() {
    return (Mahp.state && Mahp.state.map) || null;
  }

  function getSearchPinConfig() {
    return (Mahp.state && Mahp.state.searchPinConfig) || {
      color: '#2563eb',
      size: 32,
      borderColor: '#ffffff',
      borderWidth: 3
    };
  }

  function configure(opts) {
    opts = opts || {};
    if (typeof opts.iconForType === 'function') deps.iconForType = opts.iconForType;
  }

  function clearSearchMarker() {
    if (searchMarker) {
      try {
        searchMarker.remove();
      } catch (_) {}
      searchMarker = null;
    }
    if (Mahp.state) Mahp.state.searchMarker = null;
  }

  function createSearchMarker(lon, lat, name) {
    clearSearchMarker();
    var map = getMap();
    if (!map) return;

    var cfg = getSearchPinConfig();
    var size = cfg.size || 32;
    var color = cfg.color || '#2563eb';
    var border = cfg.borderColor || '#ffffff';
    var borderW = cfg.borderWidth || 3;

    var makeEl = Mahp.makeCircleIconEl;
    var el = makeEl
      ? makeEl(color, 'fa-location-dot', size, borderW, border)
      : document.createElement('div');

    searchMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([lon, lat])
      .setPopup(new maplibregl.Popup({ offset: 16 }).setHTML('<strong>' + name + '</strong>'))
      .addTo(map);

    searchMarker.togglePopup();
    if (Mahp.state) Mahp.state.searchMarker = searchMarker;
  }

  function addRecentSearch(query, result) {
    if (!query || !String(query).trim()) return;
    var key = (Mahp.LS && Mahp.LS.RECENTS) || 'mahp_recents';
    var load = Mahp.loadJSON || function () {
      return [];
    };
    var save = Mahp.saveJSON || function () {};
    var recents = load(key, []);
    var q = String(query).trim();
    recents = recents.filter(function (r) {
      return r.q.toLowerCase() !== q.toLowerCase();
    });
    recents.unshift({
      q: q,
      name: (result && result.name) || q,
      lat: result && result.lat,
      lon: result && result.lon,
      ts: Date.now()
    });
    save(key, recents.slice(0, 30));
  }

  function iconForType(type) {
    if (deps.iconForType) return deps.iconForType(type);
    var icons = (Mahp.state && Mahp.state.iconsConfig) || {};
    return icons[type] || icons.default || { fa: 'fa-map-marker-alt', color: '#e74c3c' };
  }

  function setup() {
    if (Mahp.hasFeature && !Mahp.hasFeature('search')) return;

    var input = document.getElementById('search-input');
    var resultsEl =
      document.getElementById('search-results') ||
      document.querySelector('.search-results');
    if (!input) return;

    var debounce = null;
    input.addEventListener('input', function () {
      var q = input.value.trim();
      clearTimeout(debounce);
      if (!q) {
        if (resultsEl) resultsEl.style.display = 'none';
        return;
      }
      debounce = setTimeout(function () {
        doSearch(q);
      }, 280);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (resultsEl) resultsEl.style.display = 'none';
        input.blur();
      }
    });

    var clearBtn = document.getElementById('search-clear') || document.querySelector('.clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        input.value = '';
        if (resultsEl) resultsEl.style.display = 'none';
        clearSearchMarker();
      });
    }

    function doSearch(q) {
      var key = Mahp.getApiKey ? Mahp.getApiKey() : '';
      fetch('/api/search?q=' + encodeURIComponent(q) + '&api_key=' + encodeURIComponent(key))
        .then(function (res) {
          return res.json();
        })
        .then(function (data) {
          if (!resultsEl) return;
          if (!data.results || !data.results.length) {
            resultsEl.innerHTML =
              '<div style="padding:16px;color:#5f6368">No results</div>';
            resultsEl.style.display = 'block';
            if (typeof Mahp.search._onResults === 'function') {
              try {
                Mahp.search._onResults([], q);
              } catch (_) {}
            }
            return;
          }
          resultsEl.innerHTML = data.results
            .map(function (r) {
              var conf = iconForType(r.type);
              return (
                '<div class="search-result-item" data-lat="' +
                r.lat +
                '" data-lon="' +
                r.lon +
                '" data-name="' +
                r.name +
                '">' +
                '<i class="fa-solid ' +
                conf.fa +
                '" style="background:' +
                conf.color +
                '"></i>' +
                '<div><div class="name">' +
                r.name +
                '</div><div class="type">' +
                r.type +
                '</div></div></div>'
              );
            })
            .join('');
          resultsEl.style.display = 'block';

          var resultList = data.results.slice();
          if (typeof Mahp.search._onResults === 'function') {
            try {
              Mahp.search._onResults(resultList, q);
            } catch (err) {
              console.warn(err);
            }
          }

          resultsEl.querySelectorAll('.search-result-item').forEach(function (el) {
            el.addEventListener('click', function () {
              var lat = +el.dataset.lat;
              var lon = +el.dataset.lon;
              var name = el.dataset.name;
              var place = { lat: lat, lon: lon, name: name };
              createSearchMarker(lon, lat, name);
              var map = getMap();
              if (map) map.flyTo({ center: [lon, lat], zoom: 16 });
              resultsEl.style.display = 'none';
              input.value = name;
              addRecentSearch(name, { name: name, lat: lat, lon: lon });
              if (typeof Mahp.search._onPlaceSelect === 'function') {
                try {
                  Mahp.search._onPlaceSelect(place);
                } catch (err2) {
                  console.warn(err2);
                }
              }
            });
          });
        })
        .catch(function (e) {
          console.error(e);
        });
    }
  }

  Mahp.search = {
    configure: configure,
    setup: setup,
    setupSearch: setup,
    clearSearchMarker: clearSearchMarker,
    createSearchMarker: createSearchMarker,
    addRecentSearch: addRecentSearch,
    _onResults: null,
    _onPlaceSelect: null
  };
})(typeof window !== 'undefined' ? window : globalThis);
