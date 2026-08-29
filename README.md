# Mahp — Modern Customizable Map Service

Self-hosted map platform with:

- Modern thicker roads & customizable style (forest, road, street, building colors…)
- Collapsible left navigation (Saved, Recents, Contributions, Timeline, Share/Embed, etc.)
- Secret developer console for API keys + style editing
- Public embeddable map + REST API (search, distance, routes)
- Font Awesome icons for POI types
- Cloudflare Tunnel ready (`map.collab.name.ng`)

Default center: **Umuahia, Nigeria**.

---

## Quick Start

```bash
cd mahp-final   # or whatever you named the folder
npm install
npm start
```

| URL | Purpose |
|-----|---------|
| http://localhost:3847/ | Main map |
| http://localhost:3847/devmapxt27yxtf819 | **Dev console** (secret path) |
| http://localhost:3847/monitor | Usage monitor |
| http://localhost:3847/embed | Embeddable map |
| http://localhost:3847/api/docs | API docs |

Demo API key: `mahp_live_demo_abc123xyz789`

---

## Cloudflare Tunnel → map.collab.name.ng

```bash
cloudflared tunnel login
cloudflared tunnel create mahp-map
cloudflared tunnel route dns mahp-map map.collab.name.ng
cloudflared tunnel run --url http://localhost:3847 mahp-map
```

---

## Changing the secret Dev path

Edit `config/app.json` → `devPath`, **or** use the Dev console → App Config, then **restart** the server.

---

## API (like a normal map API)

```
Header:  X-API-Key: your_key
Query:   ?api_key=your_key
```

| Endpoint | Auth | Description |
|----------|------|-------------|
| GET /api/config | No | Center, zoom, icons |
| GET /api/style | No | Colors + icons |
| GET /api/maplibre-style | No | Full MapLibre style |
| GET /api/search?q= | Yes | Place search |
| GET /api/distance?lat1&lon1&lat2&lon2 | Yes | Distance |
| GET /api/route?from_lat&from_lon&to_lat&to_lon | Yes | Simple route |
| GET /api/docs | No | Docs |

**Embed example:**

```html
<iframe
  src="https://map.collab.name.ng/embed?api_key=YOUR_KEY&features=search,zoom,routes"
  width="100%" height="500">
</iframe>
```

Features: `search`, `zoom`, `routes`, `measure`, `menu`, `fullscreen`

---

## Project layout

```
mahp-final/
├── config/app.json          # Port, secret path, center
├── data/
│   ├── api-keys.json
│   └── map-style.json       # Colors, icons, road widths
├── public/
│   ├── index.html           # Full map + left menu
│   ├── embed.html
│   ├── dev.html             # Developer console
│   ├── monitor.html
│   ├── css/map.css
│   └── js/map.js
└── src/
    ├── server.js
    └── routes/
        ├── api.js
        ├── dev.js
        └── monitor.js
```
