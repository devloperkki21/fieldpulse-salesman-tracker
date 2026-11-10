import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { formatRelativeTime } from '../utils/format';

export interface MapMarkerItem {
  id: number;
  name: string;
  territory: string;
  latitude: number;
  longitude: number;
  place_name: string;
  punched_at: string;
  accuracy: number | null;
}

interface LiveMapProps {
  markers: MapMarkerItem[];
  focusId?: number | null;
  heightClass?: string;
}

export function LiveMap({ markers, focusId = null, heightClass = 'h-72 sm:h-80' }: LiveMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
    }).setView([23.5937, 78.9629], 5);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerGroupRef.current = group;

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();
    if (markers.length === 0) return;

    const bounds: Array<[number, number]> = [];
    markers.forEach((m) => {
      const isFocused = focusId === m.id;
      const icon = L.divIcon({
        className: 'custom-salesman-pin',
        html: `<div style="display:flex;align-items:center;gap:4px;transform:translate(-14px,-14px);">
          <div style="width:28px;height:28px;border-radius:9999px;background:${
            isFocused ? '#0D9488' : '#111315'
          };border:2.5px solid #ffffff;box-shadow:0 3px 10px rgba(0,0,0,0.22);display:flex;align-items:center;justify-content:center;color:#ffffff;font-family:'Plus Jakarta Sans',sans-serif;font-weight:700;font-size:11px;">
            ${m.name.slice(0, 1).toUpperCase()}
          </div>
          <span style="background:#ffffff;border:1px solid #E5E3DC;padding:2px 6px;border-radius:6px;font-size:11px;font-weight:600;color:#111315;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.08);">
            ${m.name.split(' ')[0]}
          </span>
        </div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      const marker = L.marker([m.latitude, m.longitude], { icon });
      marker.bindPopup(
        `<div style="font-family:'Plus Jakarta Sans',sans-serif;min-width:170px;">
          <div style="font-weight:700;font-size:13px;color:#111315;">${m.name}</div>
          <div style="font-size:11px;color:#5D646E;margin-bottom:4px;">${m.territory || 'Field Sales'}</div>
          <div style="font-size:12px;color:#111315;">${m.place_name || 'Live GPS Pin'}</div>
          <div style="font-size:11px;color:#0F766E;margin-top:4px;">Punched ${formatRelativeTime(m.punched_at)}</div>
        </div>`,
      );
      marker.addTo(group);
      bounds.push([m.latitude, m.longitude]);
    });

    const focused = focusId ? markers.find((m) => m.id === focusId) : null;
    if (focused) {
      map.setView([focused.latitude, focused.longitude], 13, { animate: true });
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 12);
    } else {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
    }
  }, [markers, focusId]);

  return (
    <div className={`relative w-full overflow-hidden rounded-2xl border border-[#E5E3DC] bg-[#F3F2ED] ${heightClass}`}>
      <div ref={containerRef} className="h-full w-full z-0" />
      {markers.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-medium text-[#5D646E]">
          No live GPS punches recorded yet
        </div>
      )}
    </div>
  );
}

