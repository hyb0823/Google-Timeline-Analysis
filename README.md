# 🗺️ Google Timeline Analysis (Timeline Visualizer)

A high-performance, privacy-first web application for parsing, visualizing, and inspecting Google Location History & Timeline export data.

---

## 📌 Architecture Overview

This application is built with **React 19**, **TypeScript**, **Vite**, **Tailwind CSS**, and **Leaflet.js**. It parses complex Google Location History JSON exports (both legacy `Records.json` and modern semantic timeline exports), normalizes raw GPS traces, infers travel modes and gaps, and presents an interactive map inspector alongside an analytics dashboard.

```
                  ┌──────────────────────────────┐
                  │ Google Location History JSON │
                  └──────────────┬───────────────┘
                                 │
                                 ▼
                     ┌──────────────────────┐
                     │ parser.ts (Detector) │
                     └───────────┬──────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
       ┌──────────────────┐             ┌──────────────────┐
       │   ParsedItem[]   │             │ Available Dates  │
       └────────┬─────────┘             └────────┬─────────┘
                │                                │
        ┌───────┴────────────────────────────────┴───────┐
        │                 React App State                │
        └───────┬────────────────────────────────┬───────┘
                │                                │
                ▼                                ▼
    ┌───────────────────────┐        ┌───────────────────────┐
    │     OverviewTab       │        │     MapInspector      │
    │  (Analytics & Stats)  │        │   (Leaflet Map & UI)  │
    └───────────────────────┘        └───────────────────────┘
```

---

## 🧩 Key Components & Modules

### 1. `parser.ts`
* **Format Detection:** Automatically distinguishes between standard Google Timeline objects, flat semantic JSON arrays, and raw GPS location dumps (`Records.json`).
* **Timestamp & Coordinate Normalization:** Converts `$E7` latitude/longitude format (`1e7` multiplier) and ISO string/epoch millisecond timestamps to JavaScript `Date` objects.
* **Geodesic Interpolation & Gap Analysis:**
  * Uses Spherical Linear Interpolation (Slerp) to calculate great-circle paths for flight segments ([utils.ts](file:///d:/Gemini%20CLI%20test%20field/Map_history_Tracker/utils.ts)).
  * Detects missing gaps between visits/activities and automatically infers flight or driving travel segments based on distance (>50km / >250km) and speed (>200 km/h).
* **Speed Outlier Filtering:** Applies 95th percentile filtering (`getRobustStats`) to prevent GPS jitter and teleportation anomalies from corrupting travel classification.

### 2. `MapInspector.tsx`
* **Interactive Leaflet Map:** Renders activity polylines (colored by travel mode or high-contrast categorical palette in Focus Mode) and place visit markers.
* **Date Range Selector:** Supports multi-date range selection via interactive calendar and quick dropdown.
* **Zen Mode:** Provides a toggleable overlay hide feature (`isUIVisible`) for clean screenshot export and map viewing.
* **Point Sidebar:** Lists all visits and GPS path points in chronological sequence, enabling click-to-pan map inspection.

### 3. `OverviewTab.tsx`
* **Analytics Dashboard:** Summarizes total distance covered, duration spent traveling/visiting, and breakdown by activity type (Driving, Walking, Cycling, Flying, Train, Bus, etc.).
* **Temporal Filtering:** Supports filtering stats by year and month.

### 4. `CalendarWidget.tsx`
* **Custom Calendar Control:** Displays month grid with indicators for days containing location data, supporting single selection, range selection mode, and Shift+Click ranges.

---

## ⚡ Performance Considerations & Bottlenecks

When working with multi-year Google Timeline exports containing hundreds of thousands of GPS points:

| Area | Current Behavior | Bottleneck Impact | Recommended Solution |
| :--- | :--- | :--- | :--- |
| **Map Rendering** | Leaflet SVG Renderer + DOM `divIcon` markers | DOM overhead spikes with >500 markers / heavy polylines | Switch to `L.canvas()` renderer & `Leaflet.Canvas-Markers` |
| **Sidebar List** | Standard DOM map over `viewPoints` array | Creating thousands of `<button>` DOM nodes freezes browser | Implement Virtual Scrolling (`react-window`) |
| **Path Complexity** | Raw GPS coordinates rendered directly | Unnecessary detail causing high GPU canvas/SVG memory | Apply Ramer-Douglas-Peucker line simplification |
| **Data Parsing** | Synchronous parsing on main thread in `FileReader` | Blocks main thread for 1-5s on large (>50MB) files | Offload JSON parsing and normalization to a Web Worker |

---

## 🚀 Getting Started

### Installation
```bash
npm install
```

### Local Development Server
```bash
npm run dev
```
Open `http://localhost:3000/` in your browser.

### Build Production Bundle
```bash
npm run build
```
