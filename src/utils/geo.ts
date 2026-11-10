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

export function captureBrowserLocation(): Promise<CapturedLocation> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject(new Error('Browser does not support Geolocation API.'));
      return;
    }

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      reject(
        new Error(
          'Browser requires HTTPS or localhost to access GPS. Open on localhost or HTTPS.',
        ),
      );
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        const geo = await reverseGeocode(latitude, longitude);
        resolve({
          latitude,
          longitude,
          accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
          place_name: geo.place_name,
          address: geo.address,
          capturedAt: new Date(position.timestamp || Date.now()).toISOString(),
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(
            new Error(
              'Location permission denied. Please allow Location access in your browser site settings and retry.',
            ),
          );
          return;
        }
        if (err.code === err.POSITION_UNAVAILABLE) {
          reject(new Error('GPS signal unavailable right now. Turn on device location and retry.'));
          return;
        }
        if (err.code === err.TIMEOUT) {
          reject(new Error('Location request timed out. Move near open sky or retry.'));
          return;
        }
        reject(new Error(err.message || 'Unable to fetch GPS location.'));
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      },
    );
  });
}

