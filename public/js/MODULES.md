# Frontend module map

`map.js` ~3.0k (down from 6.3k).

## Implemented ✅

| Module | ~Lines | Role |
|--------|------:|------|
| core/* | | features, state, storage, utils, history, map-bootstrap |
| search/search.js | 200 | Search |
| analysis/measure.js | 220 | Measure |
| analysis/route.js | 200 | Route |
| drawing/tools.js | 305 | Drawing tools |
| **layers/render.js** | **1220** | **Layers UI + MapLibre sync + import/export + commitDraw** |
| layers/model.js | | Facade over install |
| layers/panel.js | | UI facade |
| share/share-screen.js | 1866 | Live share + AV |

## Layers host bridge

```js
Mahp.layers.install({
  getMap,
  refs: { userLayers, activeLayerId, expandedLayers, selectedItemIds,
          labelsOnTop, textMarkers, fenceIconsReady },
  getActiveColor, DEFAULT_LAYER_OPACITY, MAX_LAYER_OPACITY,
  pushShareScreenPresence, pushShareScreenContent, getActiveShareScreen
})
```

`refs` uses getters/setters so the module mutates the same locals as map.js.

## Still in map.js

1. Select / move / resize + straighten/curve
2. Movement trails + landmarks  
3. Desktop sidebar / color palette / satellite / 3D
4. Contribution forms

## Mobile

- **Phase 2 shell ✅** — `ui/mobile/shell.js` + `css/mobile.css`
  - Bottom nav Map | Explore | Create | Layers | More
  - `html.mahp-mobile` layout; desktop unchanged
  - Create/More sheets; Layers reuses desktop panel overlay

## Next

1. Phase 3 bottom sheets (place details, search as sheet)
2. drawing/select.js + edit.js  
2. location/trail.js  
3. Phase 2 mobile shell  
