# Exercise 2 — Weather Maps

**Live Weather Overlays on Google Maps**

---

## Objective

Build a weather visualization app that overlays real-time weather data on a styled Google Map. You'll learn how to work with tile-based weather APIs, custom map styling, and animated overlays.

## What You'll Use

| Tool | Purpose |
|---|---|
| **Google Maps JavaScript API** | Base map with custom styling |
| **OpenWeatherMap API** | Weather tile layers + current weather data |
| **Express.js** | Server-side API proxy to avoid CORS |
| **Canvas API** | Animated wind particle overlay |

## What You'll Build

- A Google Map with a sidebar for toggling weather layers
- Five weather overlay types: clouds, precipitation, temperature, wind, and pressure
- Each layer reskins the base map to match (warm tones for temperature, muted tones for rain, etc.)
- An animated wind particle system that shows wind direction and speed in real time
- Click-for-weather: tap anywhere on the map to fetch current conditions at that point
- A weather info card showing temperature, humidity, wind, pressure, and cloud cover

## Key Concepts

- Google Maps custom styling (hiding labels, recoloring land/water)
- Tile overlay layers (`ImageMapType`)
- Proxying third-party APIs through your own server
- Canvas-based animation with `requestAnimationFrame`
- Inverse Distance Weighting (IDW) interpolation for wind data
