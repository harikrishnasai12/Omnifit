"""
Today's weather where the user is, from Open-Meteo (free, no key).

Only a coarse position (rounded to ~10 km) is sent, and results are cached
for 30 minutes per position. Used to steer fabric and layering choices.
"""

import logging
import time
from typing import Optional

import httpx

logger = logging.getLogger("omnifit.weather")

WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
CACHE_SECONDS = 30 * 60
MAX_CACHE = 1000

_cache: dict[tuple, tuple[float, Optional[dict]]] = {}

# WMO weather codes grouped into what matters for clothing
_RAIN_CODES = set(range(51, 68)) | set(range(80, 83)) | {95, 96, 99}
_SNOW_CODES = set(range(71, 78)) | {85, 86}


def coarse(latitude: float, longitude: float) -> tuple[float, float]:
    return round(latitude, 1), round(longitude, 1)


async def get_weather(client: httpx.AsyncClient, latitude: float, longitude: float) -> Optional[dict]:
    key = coarse(latitude, longitude)
    cached = _cache.get(key)
    if cached and time.time() - cached[0] < CACHE_SECONDS:
        return cached[1]

    summary = None
    try:
        response = await client.get(
            WEATHER_URL,
            params={
                "latitude": key[0],
                "longitude": key[1],
                "current": "temperature_2m,relative_humidity_2m,weather_code",
                "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
                "timezone": "auto",
                "forecast_days": 1,
            },
            timeout=8.0,
        )
        response.raise_for_status()
        data = response.json()
        current, daily = data.get("current") or {}, data.get("daily") or {}

        high = (daily.get("temperature_2m_max") or [None])[0]
        low = (daily.get("temperature_2m_min") or [None])[0]
        rain_chance = (daily.get("precipitation_probability_max") or [0])[0] or 0
        code = (daily.get("weather_code") or [current.get("weather_code")])[0]

        summary = {
            "temperature": round(current.get("temperature_2m")) if current.get("temperature_2m") is not None else None,
            "high": round(high) if high is not None else None,
            "low": round(low) if low is not None else None,
            "humidity": current.get("relative_humidity_2m"),
            "rain_chance": int(rain_chance),
            "rain": code in _RAIN_CODES or rain_chance >= 50,
            "snow": code in _SNOW_CODES,
        }
        summary["feel"] = describe(summary)
    except (httpx.HTTPError, ValueError, TypeError, IndexError) as error:
        logger.warning("Weather lookup failed: %s", type(error).__name__)

    if len(_cache) >= MAX_CACHE:
        _cache.clear()
    _cache[key] = (time.time(), summary)
    return summary


def describe(weather: dict) -> str:
    """"hot", "warm", "mild", "cool" or "cold", from today's high."""
    high = weather.get("high")
    if high is None:
        return "mild"
    if high >= 32:
        return "hot"
    if high >= 26:
        return "warm"
    if high >= 18:
        return "mild"
    if high >= 10:
        return "cool"
    return "cold"


def weather_prompt_section(weather: Optional[dict]) -> str:
    if not weather or weather.get("high") is None:
        return ""

    advice = {
        "hot": "Prefer breathable fabrics (cotton, linen, light blends), lighter colours and open footwear where "
               "the occasion allows; avoid heavy layers.",
        "warm": "Prefer breathable fabrics; a light layer at most.",
        "mild": "Light layers work well.",
        "cool": "Add a layer (jacket, sweater, shawl) and closed footwear.",
        "cold": "Warm layers: knits, jackets or coats, and closed footwear.",
    }[weather["feel"]]

    rain = (" Rain is likely: avoid suede and delicate fabrics, prefer quick-dry fabrics and footwear with grip, "
            "and skip light-coloured bottoms that show splashes." if weather.get("rain") else "")
    humid = " It is humid: avoid heavy synthetics." if (weather.get("humidity") or 0) >= 70 and weather["feel"] in ("hot", "warm") else ""

    return f"""WEATHER where the user is today: high {weather['high']}°C, low {weather.get('low')}°C,
{weather.get('rain_chance', 0)}% chance of rain. {advice}{rain}{humid}
The occasion comes first: for a formal or traditional event, keep the right outfit and choose the most
weather-suitable fabric for it (for example a cotton-silk kurta rather than heavy brocade in heat)."""
