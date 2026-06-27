import * as Location from "expo-location";

export type WeatherMap = Record<string, number>; // dateKey → max temp °F

let cache: WeatherMap | null = null;
let cacheTs = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export async function getWeatherMap(): Promise<WeatherMap> {
  if (cache && Date.now() - cacheTs < CACHE_TTL_MS) return cache;

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") return {};

  const loc = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  const { latitude, longitude } = loc.coords;
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}` +
    `&daily=temperature_2m_max` +
    `&temperature_unit=fahrenheit` +
    `&timezone=auto` +
    `&past_days=92` +
    `&forecast_days=16`;

  const res = await fetch(url);
  if (!res.ok) return {};

  const json = (await res.json()) as {
    daily?: { time: string[]; temperature_2m_max: (number | null)[] };
  };

  const daily = json.daily;
  if (!daily) return {};

  const map: WeatherMap = {};
  daily.time.forEach((dateStr, i) => {
    const temp = daily.temperature_2m_max[i];
    if (temp !== null && temp !== undefined) {
      map[dateStr] = Math.round(temp);
    }
  });

  cache = map;
  cacheTs = Date.now();
  return map;
}
