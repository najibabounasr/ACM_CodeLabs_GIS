# Exercise 1 — Base Maps

**2D, 3D City, Globe, and Google 3D Tiles**

---

## Objective

Build a single-page app with four different map views, each using a different rendering approach. You'll learn how the same geographic area looks across 2D raster tiles, 3D vector tiles with extruded buildings, a full 3D globe, and Google's photorealistic 3D Tiles.

## What You'll Use

| Tool | Purpose |
|---|---|
| **Leaflet** | 2D raster tile map |
| **MapLibre GL JS** | 3D vector map with terrain and building extrusions |
| **CesiumJS** | 3D globe with atmosphere and lighting |
| **Google Maps API** | Photorealistic 3D Tiles (requires API key) |
| **OpenStreetMap** | Tile source for all non-Google views |
| **AWS Terrain Tiles** | Elevation data for the 3D city view |

## What You'll Build

- A tab-based UI that switches between four map panels
- A 2D map with standard OSM tiles
- A 3D city view with terrain elevation, building extrusions, and pitch/terrain controls
- A CesiumJS globe with OSM imagery and auto-rotation
- A Google 3D Tiles globe with photorealistic buildings
- A shared navigation bar that flies all views to the same city

## Key Concepts

- Raster tiles vs. vector tiles
- Fill-extrusion layers for 3D buildings
- Terrain sources and elevation encoding (Terrarium RGB)
- Lazy-loading heavy libraries (CesiumJS is ~8 MB)
- Camera controls: pitch, bearing, zoom, rotation
