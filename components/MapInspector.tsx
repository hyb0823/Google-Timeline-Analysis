import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Calendar as CalendarIcon, LocateFixed, ChevronDown, Menu, X } from 'lucide-react';
import { DisplayPoint, ParsedItem } from '../types';
import { ACTIVITY_STYLES, formatDistance, formatDuration, safeGetStyle } from '../utils';
import { CalendarWidget } from './CalendarWidget';

interface MapInspectorProps {
  data: ParsedItem[];
  availableDates: string[];
  selectedDates: Set<string>;
  onDateToggle: (d: string, isShift: boolean) => void;
  onQuickJump: (d: string, isShift: boolean) => void;
}

export const MapInspector = ({ data, availableDates, selectedDates, onDateToggle, onQuickJump }: MapInspectorProps) => {
  const [viewPoints, setViewPoints] = useState<DisplayPoint[]>([]);
  const [autoFit, setAutoFit] = useState(true);
  const [isLeafletLoaded, setIsLeafletLoaded] = useState(false);
  const [isSidebarOpen, setSidebarOpen] = useState(false);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // --- Leaflet Loader ---
  useEffect(() => {
      if (window.L && window.L.map) { setIsLeafletLoaded(true); return; }
      const script = document.createElement('script'); script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; script.async = true;
      script.onload = () => { setTimeout(() => { if (window.L && window.L.map) setIsLeafletLoaded(true); }, 500); };
      document.head.appendChild(script);
  }, []);

  const filteredData = useMemo(() => {
      if (!data || selectedDates.size === 0) return [];
      return data.filter(item => selectedDates.has(item.dateStr))
                 .sort((a,b) => (a.startTime?.getTime() || 0) - (b.startTime?.getTime() || 0));
  }, [data, selectedDates]);

  useEffect(() => {
      if (filteredData.length === 0) {
          setViewPoints([]);
          return;
      }
      const points: DisplayPoint[] = [];
      let visitCounter = 1;
      let pathCounter = 1;

      filteredData.forEach(item => {
          if (item.type === 'PLACE' && item.lat && item.lng) {
              points.push({
                  id: `v-${item.id}`,
                  sequenceId: visitCounter++,
                  sequenceType: 'VISIT',
                  lat: item.lat,
                  lng: item.lng,
                  timestamp: item.startTime,
                  type: 'PLACE',
                  parentType: 'Visit',
                  parentActivity: item.name
              });
          } else if (item.type === 'ACTIVITY' && item.path) {
              const subType = item.subType || 'Travel';
              item.path.forEach((p, idx) => {
                  points.push({
                      id: `p-${item.id}-${idx}`,
                      sequenceId: pathCounter++,
                      sequenceType: 'PATH',
                      lat: p.lat,
                      lng: p.lng,
                      timestamp: p.timestamp || item.startTime,
                      type: 'POINT',
                      parentType: subType,
                      parentActivity: `${subType} (${formatDuration(item.duration)})`
                  });
              });
          }
      });
      setViewPoints(points);
  }, [filteredData]);

  const fitMapBounds = (map: any, points: DisplayPoint[]) => {
      if (!map || points.length === 0) return;
      const bounds = window.L.latLngBounds();
      points.forEach(p => bounds.extend([p.lat, p.lng]));
      if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [50, 50], maxZoom: 17 });
      }
  };

  const panToPoint = (p: DisplayPoint) => {
      if (mapInstanceRef.current) {
          mapInstanceRef.current.setView([p.lat, p.lng], 18, { animate: true });
      }
  };

  useEffect(() => {
      if (!isLeafletLoaded || typeof window.L === 'undefined' || !mapRef.current) return;

      if (mapInstanceRef.current) {
          mapInstanceRef.current.remove();
          mapInstanceRef.current = null;
      }

      const map = window.L.map(mapRef.current, { center: [0, 0], zoom: 2, zoomControl: false });
      window.L.control.zoom({ position: 'topright' }).addTo(map);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap', maxZoom: 19
      }).addTo(map);
      mapInstanceRef.current = map;

      resizeObserverRef.current = new ResizeObserver(() => { map.invalidateSize(); });
      resizeObserverRef.current.observe(mapRef.current);

      return () => {
          if (mapInstanceRef.current) {
            mapInstanceRef.current.remove();
            mapInstanceRef.current = null;
          }
          if (resizeObserverRef.current) {
            resizeObserverRef.current.disconnect();
          }
      };
  }, [isLeafletLoaded]);

  useEffect(() => {
      const map = mapInstanceRef.current;
      if (!map || selectedDates.size === 0) return;

      map.eachLayer((l: any) => { if (!l._url) map.removeLayer(l); });

      filteredData.forEach(item => {
          if (item.type === 'ACTIVITY' && item.path && item.path.length > 1) {
              const style = safeGetStyle(item.subType);
              window.L.polyline(item.path, { color: style.color, weight: 4, opacity: 0.6 }).addTo(map);
          }
      });

      const pointLayers = window.L.layerGroup().addTo(map);
      viewPoints.forEach(p => {
          const isVisit = p.sequenceType === 'VISIT';
          const color = isVisit ? '#EF4444' : safeGetStyle(p.parentType).color;
          const zIndex = isVisit ? 1000 : 100;

          const iconHtml = `
            <div style="background-color: ${color}; color: white; width: ${isVisit ? '28px' : '14px'}; height: ${isVisit ? '28px' : '14px'}; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: ${isVisit ? '12px' : '8px'}; font-weight: bold; border: ${isVisit ? '2px' : '1px'} solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">
                ${p.sequenceId}
            </div>`;

          const icon = window.L.divIcon({
              className: 'bg-transparent border-none',
              html: iconHtml,
              iconSize: isVisit ? [28, 28] : [14, 14],
              iconAnchor: isVisit ? [14, 14] : [7, 7]
          });

          window.L.marker([p.lat, p.lng], { icon, zIndexOffset: zIndex }).bindPopup(`
             <div class="text-xs">
                <div class="font-bold mb-1 border-b pb-1 flex justify-between">
                    <span>${isVisit ? 'Place Visit' : 'Travel Point'} #${p.sequenceId}</span>
                    <span style="color:${color}">${p.parentType}</span>
                </div>
                <div>${p.timestamp ? p.timestamp.toLocaleString() : 'No time'}</div>
                ${p.parentActivity ? `<div class="text-slate-500 mt-1">${p.parentActivity}</div>` : ''}
             </div>
          `).addTo(pointLayers);
      });

      if (autoFit) fitMapBounds(map, viewPoints);
      map.invalidateSize();

  }, [selectedDates, filteredData, viewPoints, autoFit]);

  return (
    <div className="flex h-full w-full relative overflow-hidden">
      {/* Responsive Sidebar */}
      <div className={`
          absolute inset-0 z-[2000] bg-white flex flex-col
          md:static md:w-[360px] md:border-r md:border-slate-200 md:shadow-xl
          transition-transform duration-300 ease-in-out
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
         {/* Mobile Header */}
         <div className="md:hidden p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 flex-shrink-0">
             <span className="font-bold text-slate-800 flex items-center gap-2">
                <CalendarIcon className="w-4 h-4"/> Inspector Options
             </span>
             <button onClick={() => setSidebarOpen(false)} className="p-2 bg-white border border-slate-200 rounded-lg shadow-sm text-slate-500 active:bg-slate-100">
                 <X className="w-5 h-5" />
             </button>
         </div>

         <div className="p-4 border-b border-slate-200 bg-slate-50">
             <div className="mb-4">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">Quick Date Jump</label>
                <div className="relative">
                    <select
                        onChange={(e) => {
                             const isShift = (e.nativeEvent as any).shiftKey;
                             onQuickJump(e.target.value, !!isShift);
                             // Auto close on mobile after selection
                             if (window.innerWidth < 768) setSidebarOpen(false);
                        }}
                        className="w-full appearance-none bg-white border border-slate-300 text-slate-700 py-2 px-3 pr-8 rounded leading-tight focus:outline-none focus:border-blue-500 text-sm"
                        value={selectedDates.size === 1 ? Array.from(selectedDates)[0] : 'none'}
                    >
                        <option value="none" disabled>Select a date...</option>
                        {availableDates.map(d => (
                            <option key={d} value={d}>{d}</option>
                        ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
                        <ChevronDown className="w-4 h-4" />
                    </div>
                </div>
             </div>

             <CalendarWidget
                availableDates={availableDates}
                selectedDates={selectedDates}
                onToggle={onDateToggle}
             />
         </div>

         <div className="flex-1 overflow-y-auto custom-scrollbar">
             <div className="sticky top-0 bg-white p-3 border-b border-slate-100 text-xs font-bold text-slate-500 flex justify-between items-center shadow-sm z-10">
                 <span>Timeline Log ({viewPoints.length})</span>
                 <div className="flex gap-2">
                     <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500"></span> Visits</span>
                     <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-400"></span> Path</span>
                 </div>
             </div>
             {viewPoints.length === 0 ? (
                 <div className="p-10 text-center text-slate-400 text-sm flex flex-col items-center">
                    <CalendarIcon className="w-8 h-8 mb-2 opacity-50"/>
                    Select dates from the calendar above to view data points.
                 </div>
             ) : (
                 <div className="divide-y divide-slate-50">
                     {viewPoints.map(p => {
                         const isPlace = p.sequenceType === 'VISIT';
                         return (
                             <button
                                key={p.id}
                                onClick={() => {
                                    panToPoint(p);
                                    setSidebarOpen(false); // Close sidebar on selection
                                }}
                                className={`w-full text-left px-4 py-3 hover:bg-blue-50 flex items-start gap-3 transition-colors group border-l-4 ${isPlace ? 'border-red-400 bg-red-50/30' : 'border-transparent'}`}
                             >
                                 <div className={`
                                    w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5 shadow-sm
                                    ${isPlace ? 'bg-red-500 text-white' : 'bg-slate-200 text-slate-600 group-hover:bg-blue-200 group-hover:text-blue-700'}
                                 `}>
                                     {p.sequenceId}
                                 </div>
                                 <div className="min-w-0 flex-1">
                                     <div className="flex items-center justify-between text-xs mb-1">
                                         <span className="font-mono font-medium text-slate-600">
                                             {p.timestamp ? p.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second: '2-digit'}) : '--:--:--'}
                                         </span>
                                         {isPlace && <span className="bg-red-100 text-red-600 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide">Visit</span>}
                                     </div>
                                     <div className="text-xs text-slate-700 font-medium truncate" title={p.parentActivity}>
                                         {isPlace ? p.parentActivity : <span className="font-normal text-slate-500">in {p.parentActivity}</span>}
                                     </div>
                                     <div className="text-[10px] text-slate-400 font-mono mt-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                         <LocateFixed className="w-3 h-3"/> {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                                     </div>
                                 </div>
                             </button>
                         );
                     })}
                 </div>
             )}
         </div>

         <div className="p-3 border-t border-slate-200 bg-slate-50 text-xs text-slate-500 flex justify-between font-medium flex-shrink-0">
             <span>{formatDistance(filteredData.reduce((acc, curr) => acc + (curr.distance || 0), 0))} total</span>
             <label className="flex items-center gap-2 cursor-pointer hover:text-slate-800">
                <input type="checkbox" checked={autoFit} onChange={e => setAutoFit(e.target.checked)} /> Auto-fit
             </label>
         </div>
      </div>

      {/* Map Container */}
      <div className="flex-1 relative bg-slate-200 w-full h-full">
          <div ref={mapRef} className="absolute inset-0" />

          {/* Mobile Sidebar Toggle */}
          <button 
             onClick={() => setSidebarOpen(true)}
             className="md:hidden absolute top-4 left-4 z-[1000] bg-white p-3 rounded-full shadow-lg border border-slate-200 text-slate-700 active:bg-slate-100"
          >
             <Menu className="w-6 h-6" />
          </button>

          {/* Legend - Responsive adjustment */}
          <div className="absolute bottom-6 left-4 right-4 md:left-6 md:right-auto md:w-auto bg-white p-3 rounded-lg shadow-lg z-[1000] border border-slate-200 text-xs">
            <div className="font-bold mb-2 text-slate-700">Activity Legend</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-500 border border-white shadow-sm"></span> Place Visit</div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{backgroundColor: ACTIVITY_STYLES.DRIVING.color}}></span> Driving</div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{backgroundColor: ACTIVITY_STYLES.WALKING.color}}></span> Walking</div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{backgroundColor: ACTIVITY_STYLES.FLYING.color}}></span> Flying</div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{backgroundColor: ACTIVITY_STYLES.TRAIN.color}}></span> Train</div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{backgroundColor: ACTIVITY_STYLES.BUS.color}}></span> Bus</div>
            </div>
          </div>
      </div>
    </div>
  );
};
