import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Calendar as CalendarIcon, LocateFixed, ChevronDown, Menu, X, Filter, Zap, Target, Eye, EyeOff, Star } from 'lucide-react';
import { DisplayPoint, ParsedItem, SavedPlace } from '../types';
import { ACTIVITY_STYLES, formatDistance, formatDuration, safeGetStyle, getGeodesicPath, simplifyPath } from '../utils';
import { CalendarWidget } from './CalendarWidget';

// High-contrast categorical palette for differentiating segments
const CATEGORICAL_COLORS = [
  '#2563eb', // Blue
  '#dc2626', // Red
  '#16a34a', // Green
  '#d97706', // Orange
  '#7c3aed', // Purple
  '#0891b2', // Cyan
  '#db2777', // Pink
  '#4f46e5', // Indigo
  '#059669', // Emerald
  '#78350f', // Amber Dark
];

interface MapInspectorProps {
  data: ParsedItem[];
  availableDates: string[];
  selectedDates: Set<string>;
  onDateToggle: (d: string, isShift: boolean) => void;
  onQuickJump: (d: string, isShift: boolean) => void;
  rangeModeActive: boolean;
  setRangeModeActive: (active: boolean) => void;
  lastInteractionDate: string | null;
  onUpdateItemType?: (itemId: string, newType: string) => void;
  savedPlaces?: SavedPlace[];
}

export const MapInspector = ({ 
  data, 
  availableDates, 
  selectedDates, 
  onDateToggle, 
  onQuickJump,
  rangeModeActive,
  setRangeModeActive,
  lastInteractionDate,
  onUpdateItemType,
  savedPlaces = []
}: MapInspectorProps) => {
  const [viewPoints, setViewPoints] = useState<DisplayPoint[]>([]);
  const [autoFit, setAutoFit] = useState(true);
  const [isLeafletLoaded, setIsLeafletLoaded] = useState(false);
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [isUIVisible, setIsUIVisible] = useState(true);

  // Initialize all types as visible by default
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(new Set(['VISIT', ...Object.keys(ACTIVITY_STYLES)]));

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // --- Focus Mode Logic ---
  const focusedType = useMemo(() => {
    const travelTypes = Array.from(visibleTypes).filter(t => t !== 'VISIT');
    return travelTypes.length === 1 ? travelTypes[0] : null;
  }, [visibleTypes]);

  const filteredData = useMemo(() => {
      if (!data || selectedDates.size === 0) return [];
      return data.filter(item => selectedDates.has(item.dateStr))
                 .sort((a,b) => (a.startTime?.getTime() || 0) - (b.startTime?.getTime() || 0));
  }, [data, selectedDates]);

  const focusStats = useMemo(() => {
    if (!focusedType) return null;
    const items = filteredData.filter(d => d.subType === focusedType);
    const dist = items.reduce((acc, curr) => acc + (curr.distance || 0), 0);
    return { type: focusedType, dist, count: items.length };
  }, [focusedType, filteredData]);

  // --- Leaflet Loader ---
  useEffect(() => {
      if (window.L && window.L.map) { setIsLeafletLoaded(true); return; }
      const script = document.createElement('script'); script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; script.async = true;
      script.onload = () => { setTimeout(() => { if (window.L && window.L.map) setIsLeafletLoaded(true); }, 500); };
      document.head.appendChild(script);
  }, []);

  const toggleType = (type: string) => {
      const next = new Set(visibleTypes);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      setVisibleTypes(next);
  };

  const toggleAllTypes = () => {
      const allTypes = ['VISIT', ...Object.keys(ACTIVITY_STYLES)];
      if (visibleTypes.size === allTypes.length) {
          setVisibleTypes(new Set());
      } else {
          setVisibleTypes(new Set(allTypes));
      }
  };

  const visibleData = useMemo(() => {
      return filteredData.filter(item => {
          if (item.type === 'PLACE') return visibleTypes.has('VISIT');
          if (item.type === 'ACTIVITY') return visibleTypes.has(item.subType || 'UNKNOWN');
          return false;
      });
  }, [filteredData, visibleTypes]);

  useEffect(() => {
      if (visibleData.length === 0) {
          setViewPoints([]);
          return;
      }
      const points: DisplayPoint[] = [];
      let visitCounter = 1;
      let pathCounter = 1;

      visibleData.forEach(item => {
          if (item.type === 'PLACE' && item.lat && item.lng) {
              points.push({
                  id: `v-${item.id}`,
                  parentId: item.id,
                  sequenceId: visitCounter++,
                  sequenceType: 'VISIT',
                  lat: item.lat,
                  lng: item.lng,
                  timestamp: item.startTime,
                  type: 'PLACE',
                  parentType: 'Visit',
                  subType: 'VISIT',
                  parentActivity: item.name
              });
          } else if (item.type === 'ACTIVITY' && item.path) {
              const subType = item.subType || 'UNKNOWN';
              const showPoints = item.subType !== 'FLYING';
              
              if (showPoints && item.path.length > 0) {
                  // Only push raw points to map layer if segment is expanded or single point
                  const isExpanded = expandedSegmentIds.has(item.id);
                  if (isExpanded) {
                      item.path.forEach((p, idx) => {
                          points.push({
                              id: `p-${item.id}-${idx}`,
                              parentId: item.id,
                              sequenceId: pathCounter++,
                              sequenceType: 'PATH',
                              lat: p.lat,
                              lng: p.lng,
                              timestamp: p.timestamp || item.startTime,
                              type: 'POINT',
                              parentType: subType,
                              subType: subType,
                              parentActivity: `${safeGetStyle(subType).label} (Pt ${idx + 1}/${item.path.length})`
                          });
                      });
                  } else {
                      points.push({
                          id: `p-${item.id}-0`,
                          parentId: item.id,
                          sequenceId: pathCounter++,
                          sequenceType: 'PATH',
                          lat: item.path[0].lat,
                          lng: item.path[0].lng,
                          timestamp: item.path[0].timestamp || item.startTime,
                          type: 'POINT',
                          parentType: subType,
                          subType: subType,
                          parentActivity: `${safeGetStyle(subType).label} (${formatDuration(item.duration)})`
                      });
                  }
              } else if (item.path.length > 0) {
                  points.push({
                     id: `p-${item.id}-start`,
                     parentId: item.id,
                     sequenceId: pathCounter++,
                     sequenceType: 'PATH',
                     lat: item.path[0].lat,
                     lng: item.path[0].lng,
                     timestamp: item.startTime,
                     type: 'POINT',
                     parentType: subType,
                     subType: subType,
                     parentActivity: `${safeGetStyle(subType).label} Start`
                  });
              }
          }
      });
      setViewPoints(points);
  }, [visibleData, expandedSegmentIds]);

  const fitMapBounds = (map: any, currentVisible: ParsedItem[]) => {
      if (!map || currentVisible.length === 0) return;
      const bounds = window.L.latLngBounds();
      currentVisible.forEach(item => {
          if (item.type === 'ACTIVITY' && item.path) {
              item.path.forEach(p => bounds.extend([p.lat, p.lng]));
          } else if (item.type === 'PLACE' && item.lat) {
              bounds.extend([item.lat, item.lng]);
          }
      });

      if (savedPlaces && savedPlaces.length > 0) {
          savedPlaces.forEach(sp => bounds.extend([sp.lat, sp.lng]));
      }
      
      if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [50, 50], maxZoom: 17, animate: true });
      }
  };

  const panToCoords = (lat: number, lng: number) => {
      if (mapInstanceRef.current) {
          mapInstanceRef.current.setView([lat, lng], 17, { animate: true });
      }
  };

  const panToPoint = (p: DisplayPoint) => {
      panToCoords(p.lat, p.lng);
  };

  useEffect(() => {
      if (!isLeafletLoaded || typeof window.L === 'undefined' || !mapRef.current) return;

      if (mapInstanceRef.current) {
          mapInstanceRef.current.remove();
          mapInstanceRef.current = null;
      }

      // Enable hardware-accelerated 2D Canvas rendering for ultra-fast performance
      const map = window.L.map(mapRef.current, { center: [0, 0], zoom: 2, zoomControl: false, preferCanvas: true });
      window.L.control.zoom({ position: 'topright' }).addTo(map);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap', maxZoom: 19
      }).addTo(map);
      mapInstanceRef.current = map;

      resizeObserverRef.current = new ResizeObserver(() => { map.invalidateSize(); });
      resizeObserverRef.current.observe(mapRef.current);

      return () => {
          if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; }
          if (resizeObserverRef.current) resizeObserverRef.current.disconnect();
      };
  }, [isLeafletLoaded]);

  useEffect(() => {
      const map = mapInstanceRef.current;
      if (!map) return;

      map.eachLayer((l: any) => { if (!l._url) map.removeLayer(l); });

      // Render Saved Places
      if (savedPlaces && savedPlaces.length > 0) {
          const starIconHtml = `<div style="background-color: #F59E0B; color: white; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.35);">⭐</div>`;
          const starIcon = window.L.divIcon({ className: 'bg-transparent border-none', html: starIconHtml, iconSize: [26, 26], iconAnchor: [13, 13] });

          savedPlaces.forEach(sp => {
              const marker = window.L.marker([sp.lat, sp.lng], { icon: starIcon, zIndexOffset: 2000 }).addTo(map);
              marker.bindPopup(`<b>⭐ ${sp.title}</b>${sp.address ? `<br/><span style="font-size:11px;color:#666;">${sp.address}</span>` : ''}`);
          });
      }

      if (selectedDates.size === 0) return;

      // Group segments for categorical indexing
      const segmentsOfType = visibleData.filter(d => d.subType === focusedType);

      visibleData.forEach(item => {
          if (item.type === 'ACTIVITY' && item.path && item.path.length > 1) {
              const isFocused = focusedType === item.subType;
              const style = safeGetStyle(item.subType);
              
              // Use categorical color if this specific type is in focus mode (specifically air travel)
              let color = style.color;
              if (isFocused && focusedType === 'FLYING') {
                const index = segmentsOfType.indexOf(item);
                color = CATEGORICAL_COLORS[index % CATEGORICAL_COLORS.length];
              }

              // Bold, crisp line weights optimized for 4K / High-DPI displays
              const weight = isFocused ? 7.0 : (item.subType === 'FLYING' ? 3.5 : 5.0);
              const opacity = isFocused ? 0.95 : 0.75;
              
              if (item.subType === 'FLYING' && item.startLoc && item.endLoc) {
                  const curvedPath = getGeodesicPath(item.startLoc, item.endLoc);
                  
                  const lineOptions: any = { 
                      color: color, 
                      weight: weight, 
                      opacity: opacity,
                      dashArray: '6, 10',
                      lineCap: 'round'
                  };

                  window.L.polyline(curvedPath, lineOptions).addTo(map);

                  const dotOptions = {
                    radius: isFocused ? 7 : 5,
                    fillColor: 'white',
                    fillOpacity: 1,
                    color: color,
                    weight: isFocused ? 3 : 2,
                    interactive: false
                  };

                  window.L.circleMarker([item.startLoc.lat, item.startLoc.lng], dotOptions).addTo(map);
                  window.L.circleMarker([item.endLoc.lat, item.endLoc.lng], dotOptions).addTo(map);

              } else {
                  // Apply Ramer-Douglas-Peucker line simplification for lightning-fast polyline rendering
                  const simplified = simplifyPath(item.path, 0.00008);
                  window.L.polyline(simplified.map(p => [p.lat, p.lng]), { 
                      color: color, 
                      weight: weight, 
                      opacity: opacity,
                      lineCap: 'round',
                      lineJoin: 'round'
                  }).addTo(map);
              }
          }
      });

      const pointLayers = window.L.layerGroup().addTo(map);
      viewPoints.forEach(p => {
          if (p.parentType === 'FLYING') return;
          const isVisit = p.sequenceType === 'VISIT';
          const color = isVisit ? '#EF4444' : safeGetStyle(p.parentType).color;
          const zIndex = isVisit ? 1000 : 100;
          
          const iconHtml = `<div style="background-color: ${color}; color: white; width: ${isVisit ? '22px' : '12px'}; height: ${isVisit ? '22px' : '12px'}; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: ${isVisit ? '10px' : '0px'}; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">${isVisit ? p.sequenceId : ''}</div>`;
          const icon = window.L.divIcon({ className: 'bg-transparent border-none', html: iconHtml, iconSize: isVisit ? [22, 22] : [12, 12], iconAnchor: isVisit ? [11, 11] : [6, 6] });
          window.L.marker([p.lat, p.lng], { icon, zIndexOffset: zIndex }).addTo(pointLayers);
      });

      if (autoFit && visibleData.length > 0) fitMapBounds(map, visibleData);
      map.invalidateSize();

  }, [selectedDates, visibleData, viewPoints, autoFit, focusedType, savedPlaces]);



  return (
    <div className="flex h-full w-full relative overflow-hidden bg-slate-900">
      <style>{`
        .leaflet-container { 
            background: #f8fafc !important; 
            transition: filter 0.4s ease;
        }
        .focus-active .leaflet-layer {
            filter: grayscale(1) brightness(1.2) contrast(0.85);
        }
        @media (orientation: landscape) and (max-height: 500px) {
            .sidebar-landscape {
                width: 280px !important;
                height: 100% !important;
                inset: 0 auto 0 0 !important;
            }
            .focus-badge-landscape {
                top: 8px !important;
                transform: translateX(-50%) scale(0.75) !important;
            }
            .legend-landscape {
                bottom: 8px !important;
                max-height: 45vh !important;
                width: 260px !important;
                border-radius: 1.5rem !important;
            }
        }
      `}</style>

      {/* Sidebar */}
      <div className={`
          absolute inset-0 z-[2000] bg-white flex flex-col
          lg:static lg:w-[360px] lg:border-r lg:border-slate-200 lg:shadow-xl
          transition-transform duration-300 ease-in-out sidebar-landscape
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
         <div className="lg:hidden p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 flex-shrink-0">
             <span className="font-bold text-slate-800 flex items-center gap-2 text-sm uppercase tracking-tight">
                <CalendarIcon className="w-4 h-4 text-blue-500"/> Timeline Settings
             </span>
             <button onClick={() => setSidebarOpen(false)} className="p-2 bg-white border border-slate-200 rounded-lg shadow-sm text-slate-500 active:scale-95">
                 <X className="w-5 h-5" />
             </button>
         </div>

         <div className="p-4 border-b border-slate-200 bg-slate-50">
             <div className="mb-4">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">Quick Date Jump</label>
                <div className="relative">
                    <select
                        onChange={(e) => onQuickJump(e.target.value, false)}
                        className="w-full appearance-none bg-white border border-slate-300 text-slate-700 py-2 px-3 pr-8 rounded leading-tight focus:outline-none focus:border-blue-500 text-sm"
                        value={selectedDates.size === 1 ? Array.from(selectedDates)[0] : 'none'}
                    >
                        <option value="none" disabled>Select a date...</option>
                        {availableDates.map(d => <option key={d} value={d}>{d}</option>)}
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
                rangeModeActive={rangeModeActive}
                setRangeModeActive={setRangeModeActive}
                lastInteractionDate={lastInteractionDate}
             />
         </div>

         <div className="flex-1 overflow-y-auto custom-scrollbar">
             {visibleData.length === 0 ? (
                 <div className="p-10 text-center text-slate-400 text-sm flex flex-col items-center">
                    <CalendarIcon className="w-8 h-8 mb-2 opacity-30"/>
                    {selectedDates.size === 0 ? "Select dates above." : "No matching activities found."}
                 </div>
             ) : (
                 <div className="divide-y divide-slate-100">
                     {visibleData.map((item, seqIdx) => {
                         const isPlace = item.type === 'PLACE';
                         const style = isPlace ? { color: '#EF4444', label: 'Visit' } : safeGetStyle(item.subType);
                         const isExpanded = expandedSegmentIds.has(item.id);
                         const pointCount = item.path ? item.path.length : 0;

                         if (isPlace) {
                             return (
                                 <div
                                    key={item.id}
                                    onClick={() => {
                                        if (item.lat && item.lng) panToCoords(item.lat, item.lng);
                                        if (window.innerWidth < 1024) setSidebarOpen(false);
                                    }}
                                    className="w-full text-left px-4 py-3 hover:bg-red-50/50 flex items-start gap-3 transition-colors cursor-pointer border-l-4 border-red-500 bg-red-50/20"
                                 >
                                     <div className="w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 shadow-sm">
                                         {seqIdx + 1}
                                     </div>
                                     <div className="min-w-0 flex-1">
                                         <div className="flex items-center justify-between text-xs mb-1">
                                             <span className="font-mono font-semibold text-slate-600">
                                                 {item.startTime ? item.startTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--:--'}
                                             </span>
                                             <span className="bg-red-100 text-red-600 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-tight">Visit</span>
                                         </div>
                                         <div className="text-xs text-slate-800 font-bold truncate">{item.name || 'Unknown Place'}</div>
                                     </div>
                                 </div>
                             );
                         }

                         return (
                             <div key={item.id} className="border-l-4 border-slate-200 hover:border-blue-400 bg-white transition-colors">
                                 <div
                                    onClick={() => {
                                        if (item.startLoc) panToCoords(item.startLoc.lat, item.startLoc.lng);
                                        if (window.innerWidth < 1024) setSidebarOpen(false);
                                    }}
                                    className="px-4 py-3 flex items-start gap-3 cursor-pointer hover:bg-blue-50/50 transition-colors"
                                 >
                                     <div 
                                       className="w-6 h-6 rounded-full text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 shadow-sm"
                                       style={{ backgroundColor: style.color }}
                                     >
                                         {seqIdx + 1}
                                     </div>
                                     <div className="min-w-0 flex-1">
                                         <div className="flex items-center justify-between text-xs mb-1">
                                             <span className="font-mono font-semibold text-slate-600">
                                                 {item.startTime ? item.startTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--:--'}
                                             </span>
                                             <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
                                                 <select
                                                     value={item.subType || 'UNKNOWN'}
                                                     onChange={(e) => onUpdateItemType && onUpdateItemType(item.id, e.target.value)}
                                                     className="appearance-none bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 text-[10px] font-bold py-0.5 pl-2 pr-5 rounded cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                 >
                                                     {Object.entries(ACTIVITY_STYLES).map(([typeKey, styleObj]) => (
                                                         <option key={typeKey} value={typeKey}>
                                                             {styleObj.label}
                                                         </option>
                                                     ))}
                                                 </select>
                                                 <ChevronDown className="w-3 h-3 text-slate-500 absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />
                                             </div>
                                         </div>
                                         <div className="flex items-center justify-between text-xs">
                                             <span className="text-slate-700 font-semibold truncate">
                                                 {style.label} ({formatDuration(item.duration)})
                                             </span>
                                             {item.distance ? (
                                                 <span className="text-[10px] text-slate-400 font-mono font-medium ml-2 shrink-0">
                                                     {formatDistance(item.distance)}
                                                 </span>
                                             ) : null}
                                         </div>
                                         {pointCount > 0 && (
                                             <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleExpandSegment(item.id);
                                                }}
                                                className="mt-2 text-[10px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 bg-blue-50 px-2 py-0.5 rounded-full transition-colors"
                                             >
                                                {isExpanded ? '▼ Hide Raw Points' : `▶ Expand ${pointCount} Raw Points`}
                                             </button>
                                         )}
                                     </div>
                                 </div>

                                 {/* Expanded Sub-List of Raw Points */}
                                 {isExpanded && item.path && (
                                     <div className="bg-slate-50 border-t border-slate-100 px-4 py-2 space-y-1 text-xs">
                                         {item.path.map((pt, pIdx) => (
                                             <div
                                                key={pIdx}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    panToCoords(pt.lat, pt.lng);
                                                    if (window.innerWidth < 1024) setSidebarOpen(false);
                                                }}
                                                className="flex items-center justify-between py-1 px-2 rounded hover:bg-blue-100/70 text-slate-700 cursor-pointer font-mono text-[11px] transition-colors"
                                             >
                                                <span className="font-semibold text-blue-700">Pt {pIdx + 1}</span>
                                                <span className="text-slate-500 text-[10px]">
                                                    {pt.timestamp ? pt.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'}) : `${pt.lat.toFixed(4)}, ${pt.lng.toFixed(4)}`}
                                                </span>
                                             </div>
                                         ))}
                                     </div>
                                 )}
                             </div>
                         );
                      })}
                 </div>
             )}
         </div>
      </div>

      {/* Map Container */}
      <div className={`flex-1 relative bg-slate-200 w-full h-full ${focusedType ? 'focus-active' : ''}`}>
          <div ref={mapRef} className="absolute inset-0" />

          {/* Focus Notification UI */}
          <div className={`absolute top-6 left-1/2 -translate-x-1/2 z-[1001] pointer-events-none w-full max-w-sm px-4 focus-badge-landscape transition-all duration-500 ease-in-out ${isUIVisible && focusedType && focusStats ? 'translate-y-0 opacity-100' : '-translate-y-32 opacity-0'}`}>
              <div className="bg-white/95 backdrop-blur-xl border border-white shadow-xl rounded-2xl px-6 py-4 flex items-center gap-5">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-lg ring-4 ring-white" style={{backgroundColor: focusedType === 'FLYING' ? '#3B82F6' : safeGetStyle(focusedType || '').color}}>
                  {focusedType === 'FLYING' ? '✈️' : <Zap className="w-6 h-6"/>}
                </div>
                <div className="flex-1">
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1 flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5 text-blue-500"/> Tracking {safeGetStyle(focusedType || '').label}
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xl font-black text-slate-800 tracking-tight leading-none">{formatDistance(focusStats?.dist || 0)}</span>
                    <span className="text-xs font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">{focusStats?.count} segments</span>
                  </div>
                </div>
              </div>
          </div>

          {/* Zen Toggle Button */}
          <button 
            onClick={() => setIsUIVisible(!isUIVisible)}
            className="absolute top-4 right-4 z-[1002] bg-white/95 backdrop-blur-sm p-3 rounded-full shadow-lg border border-slate-200 text-slate-700 active:scale-90 transition-all hover:bg-white"
            title={isUIVisible ? "Hide Overlays (Zen Mode)" : "Show Overlays"}
          >
             {isUIVisible ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5 text-blue-600" />}
          </button>

          {/* Mobile Sidebar Toggle */}
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden absolute top-4 left-4 z-[1000] bg-white p-3 rounded-full shadow-lg border border-slate-200">
             <Menu className="w-6 h-6 text-slate-700" />
          </button>

          {/* Floating Action Bar / Legend */}
          <div className={`absolute bottom-8 left-1/2 -translate-x-1/2 lg:left-8 lg:translate-x-0 bg-white/95 backdrop-blur-md p-4 rounded-3xl shadow-xl z-[1000] border border-white/50 w-[90%] lg:w-72 max-h-[50vh] overflow-y-auto custom-scrollbar legend-landscape transition-all duration-500 ease-in-out ${isUIVisible ? 'translate-y-0 opacity-100' : 'translate-y-64 opacity-0'}`}>
            <div className="flex items-center justify-between mb-4 px-1">
                <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">Activity Filters</span>
                <button onClick={toggleAllTypes} className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-full hover:bg-blue-100 transition-colors">
                    {visibleTypes.size === Object.keys(ACTIVITY_STYLES).length + 1 ? 'Hide All' : 'Show All'}
                </button>
            </div>
            
            <div className="grid grid-cols-2 gap-2">
                <button 
                    onClick={() => toggleType('VISIT')}
                    className={`flex items-center gap-3 p-2 rounded-xl border transition-all ${visibleTypes.has('VISIT') ? 'bg-red-50 border-red-200 shadow-sm' : 'bg-transparent border-slate-100 opacity-50 grayscale'}`}
                >
                    <span className="w-4 h-4 rounded-full bg-red-500 border-2 border-white shadow-sm shrink-0"></span> 
                    <span className={`text-[11px] font-bold ${visibleTypes.has('VISIT') ? 'text-red-700' : 'text-slate-500'}`}>Visits</span>
                </button>
                {Object.entries(ACTIVITY_STYLES).map(([type, style]) => {
                    const active = visibleTypes.has(type);
                    const isFocus = focusedType === type;
                    return (
                        <button 
                            key={type}
                            onClick={() => toggleType(type)}
                            className={`flex items-center gap-3 p-2 rounded-xl border transition-all ${active ? 'bg-slate-50 border-slate-200 shadow-sm' : 'bg-transparent border-slate-100 opacity-50 grayscale'} ${isFocus ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
                        >
                            <span className="w-4 h-4 rounded-full border-2 border-white shadow-sm shrink-0" style={{backgroundColor: style.color}}></span>
                            <span className={`text-[11px] font-bold ${active ? 'text-slate-800' : 'text-slate-400'}`}>{style.label}</span>
                        </button>
                    )
                })}
            </div>
          </div>
      </div>
    </div>
  );
};