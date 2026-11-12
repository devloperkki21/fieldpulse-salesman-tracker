export type GeoPermissionState = 'granted' | 'prompt' | 'denied' | 'unsupported';

export interface CapturedLocation {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  place_name: string;
  address: string;
  capturedAt: string;
}

export async function getGeoPermissionState(): Promise<GeoPermissionState> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    return 'unsupported';
  }
  if (!navigator.permissions?.query) {
    return 'prompt';
  }
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status.state as GeoPermissionState;
  } catch {
    return 'prompt';
  }
}

export function formatCoords(lat: number, lng: number): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lng).toFixed(4)}° ${lngDir}`;
}

export function buildGoogleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

async function reverseGeocode(lat: number, lng: number): Promise<{ place_name: string; address: string }> {
  const fallback = formatCoords(lat, lng);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=16`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });
    if (!res.ok) return { place_name: fallback, address: fallback };
    const data = await res.json();
    const addr = data?.address || {};
    const locality =
      addr.suburb ||
      addr.neighbourhood ||
      addr.road ||
      addr.village ||
      addr.town ||
      addr.city_district ||
      '';
    const city = addr.city || addr.town || addr.state_district || addr.state || '';
    const shortName = [locality, city].filter(Boolean).join(', ') || data?.name || fallback;
    const fullAddress = data?.display_name || shortName;
    return {
      place_name: shortName.slice(0, 140),
      address: fullAddress.slice(0, 280),
    };
  } catch {
    return { place_name: fallback, address: fallback };
  } finally {
    clearTimeout(timeout);
  }
}

function getPosition(options: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

async function fetchNetworkLocationFallback(): Promise<CapturedLocation | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch('https://get.geojs.io/v1/ip/geo.json', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const latitude = Number(data?.latitude);
    const longitude = Number(data?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    const city = [data?.city, data?.region, data?.country].filter(Boolean).join(', ');
    const fallbackName = city || formatCoords(latitude, longitude);
    return {
      latitude,
      longitude,
      accuracy: null,
      place_name: fallbackName.slice(0, 140),
      address: fallbackName.slice(0, 280),
      capturedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function captureBrowserLocation(): Promise<CapturedLocation> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    throw new Error('Browser does not support Geolocation API.');
  }

  if (typeof window !== 'undefined' && !window.isSecureContext) {
    throw new Error(
      'Browser requires HTTPS or localhost to access GPS. Open on localhost or HTTPS.',
    );
  }

  let position: GeolocationPosition | null = null;
  let lastError: GeolocationPositionError | null = null;

  try {
    // Pass 1: High accuracy GPS (accept recent 1-min cached fix to avoid indoor hangs)
    position = await getPosition({
      enableHighAccuracy: true,
      timeout: 7000,
      maximumAge: 60000,
    });
  } catch (err) {
    const posErr = err as GeolocationPositionError;
    lastError = posErr;
    if (posErr && posErr.code === 1) {
      throw new Error(
        'Location permission denied. Please allow Location access in your browser site settings and retry.',
      );
    }

    // Pass 2: Standard accuracy (Wi-Fi / OS location — much faster & reliable on desktop/laptops)
    try {
      position = await getPosition({
        enableHighAccuracy: false,
        timeout: 12000,
        maximumAge: 300000,
      });
    } catch (err2) {
      lastError = err2 as GeolocationPositionError;
      if (lastError && lastError.code === 1) {
        throw new Error(
          'Location permission denied. Please allow Location access in your browser site settings and retry.',
        );
      }
    }
  }

  if (position) {
    const { latitude, longitude, accuracy } = position.coords;
    const geo = await reverseGeocode(latitude, longitude);
    return {
      latitude,
      longitude,
      accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
      place_name: geo.place_name,
      address: geo.address,
      capturedAt: new Date(position.timestamp || Date.now()).toISOString(),
    };
  }

  // Pass 3: If device OS location timed out / unavailable on desktop, try network geolocation fallback
  const networkLoc = await fetchNetworkLocationFallback();
  if (networkLoc) {
    return networkLoc;
  }

  if (lastError?.code === 2) {
    throw new Error('GPS signal unavailable right now. Turn on device location and retry.');
  }
  if (lastError?.code === 3) {
    throw new Error('Location request timed out. Turn on device location or retry.');
  }
  throw new Error(lastError?.message || 'Unable to fetch GPS location.');
}

