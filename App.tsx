import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Upload, Map as MapIcon, Activity, Calendar as CalendarIcon, AlertCircle, MapPin, 
  Clock, X, CheckCircle, Database, Terminal, RefreshCw, ChevronDown, ChevronLeft, ChevronRight,
  BarChart3, LayoutDashboard, List, LocateFixed, ArrowRight, ZoomIn, Plane, Car, Footprints, 
  MousePointerClick, Layers, PieChart, Trash2, Navigation
} from 'lucide-react';

// --- TYPES ---
declare global {
  interface Window {
    L: any;
  }
}

interface GeoPoint {
  lat: number;
  lng: number;
  timestamp?: Date;
}

interface ParsedItem {
  id: string;
  type: 'PLACE' | 'ACTIVITY';
  subType?: string;
  name?: string;
  lat?: number;
  lng?: number;
  startTime: Date | null;
  endTime: Date | null;
  duration: number;
  distance?: number;
  startLoc?: GeoPoint;
  endLoc?: GeoPoint;
  path?: GeoPoint[];
  isDetailed?: boolean;
  raw: any;
  dateStr: string;
  isFallback?: boolean;
  speedKmH?: number;
}

// A flattened representation for the UI
interface DisplayPoint {
  id: string; // Unique ID for React keys
  sequenceId: number; // The visible number (1, 2, 3...)
  sequenceType: 'VISIT' | 'PATH'; // Which counter it belongs to
  lat: number;
  lng: number;
  timestamp: Date | null;
  type: 'PLACE' | 'POINT';
  parentType: string;
  parentActivity?: string;
}

interface ActivityStyles {
  [key: string]: { color: string; label: string };
}

interface ActivityStat {
  count: number;
  dist: number;
  duration: number;
}

// --- 1. HELPERS & CONFIG ---

const ACTIVITY_STYLES: ActivityStyles = {
    'DRIVING': { color: '#3B82F6', label: 'Driving' },      
    'WALKING': { color: '#10B981', label: 'Walking' },      
    'RUNNING': { color: '#F59E0B', label: 'Running' },      
    'CYCLING': { color: '#8B5CF6', label: 'Cycling' },      
    'TRAIN':   { color: '#EC4899', label: 'Train' },   
    'BUS':     { color: '#EF4444', label: 'Bus' },          
    'FERRY':   { color: '#06B6D4', label: 'Ferry' },        
    'FLYING':  { color: '#6366F1', label: 'Flying' },       
    'RAW_PATH':{ color: '#64748B', label: 'Raw Path' },     
    'UNKNOWN': { color: '#94A3B8', label: 'Travel' }        
};

const safeGetStyle = (type: string | undefined) => {
    const t = type || 'UNKNOWN';
    return ACTIVITY_STYLES[t] || ACTIVITY_STYLES['UNKNOWN'];
};

const formatDuration = (ms: number) => {
    if (!ms || isNaN(ms)) return "0m";
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
};

const formatDistance = (meters: number) => {
  if (!meters) return "0 km";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
};

const getDistanceFromLatLonInKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371; 
  const dLat = deg2rad(lat2-lat1);
  const dLon = deg2rad(lon2-lon1); 
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  const d = R * c; 
  return d;
}

const deg2rad = (deg: number) => {
  return deg * (Math.PI/180)
}

const parseGeo = (input: any): GeoPoint | null => {
    if (!input) return null;
    
    let lat: number | null = null;
    let lng: number | null = null;
    let time: Date | undefined = undefined;

    if (typeof input === 'string' && input.startsWith('geo:')) {
        const parts = input.replace('geo:', '').split(',');
        if (parts.length === 2) {
            lat = parseFloat(parts[0]);
            lng = parseFloat(parts[1]);
        }
    } else if (typeof input === 'object') {
        if (input.latitudeE7 !== undefined || input.latE7 !== undefined) {
            lat = (input.latitudeE7 ?? input.latE7) / 1e7;
            lng = (input.longitudeE7 ?? input.lngE7) / 1e7;
        } else if (input.latitude !== undefined || input.lat !== undefined) {
            lat = input.latitude ?? input.lat;
            lng = input.longitude ?? input.lng;
        }
        
        // Try to extract timestamp from point if available
        if (input.timestamp) time = new Date(input.timestamp);
        else if (input.timestampMs) time = new Date(parseInt(input.timestampMs));
    }

    if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return null; 

    return { lat, lng, timestamp: time };
};

const parseTime = (obj: any, fallbackStart?: any, fallbackEnd?: any) => {
    let start: Date | null = null;
    let end: Date | null = null;
    
    const parseTs = (val: any) => {
        if (!val) return null;
        if (typeof val === 'string' && /^\d+$/.test(val)) return new Date(parseInt(val));
        return new Date(val);
    };

    if (obj?.timestamp) start = parseTs(obj.timestamp);
    else if (obj?.duration?.startTimestamp) start = new Date(obj.duration.startTimestamp);
    else if (obj?.startTime) start = new Date(obj.startTime);

    if (obj?.duration?.endTimestamp) end = new Date(obj.duration.endTimestamp);
    else if (obj?.endTime) end = new Date(obj.endTime);
    
    if (!start && fallbackStart) start = new Date(fallbackStart);
    if (!end && fallbackEnd) end = new Date(fallbackEnd);

    if (start && !end) end = start;
    
    if (start && isNaN(start.getTime())) start = null;
    if (end && isNaN(end.getTime())) end = null;

    return { start, end, durationMs: (start && end) ? end.getTime() - start.getTime() : 0 };
};

const normalizeActivityType = (rawType: any) => {
    const t = String(rawType || 'UNKNOWN').toUpperCase().replace('_', ' ');
    if (['IN PASSENGER VEHICLE', 'PASSENGER VEHICLE', 'IN CAR', 'DRIVING', 'MOTORCYCLING', 'CAR', 'MOVING'].includes(t)) return 'DRIVING';
    if (['IN TRAIN', 'TRAIN', 'SUBWAY', 'TRAM', 'RAIL'].includes(t)) return 'TRAIN';
    if (['IN BUS', 'BUS'].includes(t)) return 'BUS';
    if (['IN FERRY', 'FERRY', 'BOAT'].includes(t)) return 'FERRY';
    if (['FLYING', 'IN FLIGHT', 'PLANE', 'AIR'].includes(t)) return 'FLYING';
    if (['WALKING', 'ON FOOT', 'HIKING', 'RUNNING'].includes(t)) return 'WALKING';
    if (['CYCLING', 'ON BICYCLE'].includes(t)) return 'CYCLING';
    return 'UNKNOWN';
};

// --- 3. PARSER LOGIC ---

const detectAndNormalize = (json: any) => {
    let rawItems: any[] = [];
    let formatType = "Unknown";

    if (json.locations && Array.isArray(json.locations)) {
        rawItems = json.locations;
        formatType = "Raw GPS (Records.json)";
    } else if (Array.isArray(json)) {
        rawItems = json;
        formatType = "Flat Array / New Semantic";
    } else if (json.timelineObjects) {
        rawItems = json.timelineObjects;
        formatType = "Standard Timeline";
    } else {
        const vals = Object.values(json);
        const arr = vals.find(v => Array.isArray(v));
        if (arr) { rawItems = arr as any[]; formatType = "Inferred Array"; }
    }

    if (rawItems.length === 0) throw new Error("No data found in file.");

    const timelinePaths: any[] = [];
    rawItems.forEach(item => {
        if (item.timelinePath && Array.isArray(item.timelinePath)) {
            const time = parseTime(item);
            const points = item.timelinePath.map((p: any) => p.point || p).map(parseGeo).filter((p: any) => p);
            if (points.length > 0) {
                timelinePaths.push({
                    startTime: time.start,
                    endTime: time.end,
                    points: points,
                    raw: item,
                    claimed: false
                });
            }
        }
    });

    const normalized: ParsedItem[] = [];
    const stats = { format: formatType, activityCounts: {} as Record<string, number> };
    const uniqueDays = new Set<string>();

    const getLocalDate = (dateObj: Date | null) => {
        if(!dateObj) return 'UNKNOWN';
        return dateObj.getFullYear() + '-' + 
               String(dateObj.getMonth() + 1).padStart(2, '0') + '-' + 
               String(dateObj.getDate()).padStart(2, '0');
    };

    rawItems.forEach((item, index) => {
        const act = item.activity || item.activitySegment;
        const visit = item.visit || item.placeVisit;

        if (visit) {
             const time = parseTime(visit, item.startTime, item.endTime);
             let name = "Unknown Place";
             let loc: GeoPoint | null = null;
             if (visit.topCandidate) {
                 name = visit.topCandidate.semanticType || visit.topCandidate.placeID || "Place";
                 loc = parseGeo(visit.topCandidate.placeLocation);
             } else if (visit.location) {
                 name = visit.location.name || visit.location.address || "Place";
                 loc = parseGeo(visit.location);
             }
             if (loc && time.start) {
                 const dateStr = getLocalDate(time.start);
                 uniqueDays.add(dateStr);
                 normalized.push({
                     id: `place-${index}`, type: 'PLACE', name: String(name), lat: loc.lat, lng: loc.lng,
                     startTime: time.start, endTime: time.end, duration: time.durationMs, raw: item,
                     dateStr: dateStr
                 });
             }
        }
        
        if (act) {
            const rawType = act?.topCandidate?.type || act?.activityType;
            let type = normalizeActivityType(rawType);
            const time = parseTime(act, item.startTime, item.endTime);
            const distMeters = parseFloat(act?.distanceMeters || act?.distance || 0);

            if (time.start) {
                const dateStr = getLocalDate(time.start);
                uniqueDays.add(dateStr);

                let path: GeoPoint[] = [];
                if (act.simplifiedRawPath?.points) path = act.simplifiedRawPath.points.map(parseGeo);
                else if (act.waypointPath?.waypoints) path = act.waypointPath.waypoints.map(parseGeo);
                else if (act.transitPath?.transitStops) path = act.transitPath.transitStops.map((s: any) => s.location).map(parseGeo);
                
                if (path.length < 2) {
                    const relevantPaths = timelinePaths.filter(tp => 
                        !tp.claimed && tp.startTime && tp.endTime && time.start && time.end &&
                        ((tp.startTime >= time.start && tp.startTime < time.end) || 
                         (tp.endTime > time.start && tp.endTime <= time.end) ||
                         (tp.startTime <= time.start && tp.endTime >= time.end))
                    );
                    if (relevantPaths.length > 0) {
                        path = [];
                        relevantPaths.forEach(rp => {
                            path = [...path, ...rp.points];
                            rp.claimed = true;
                        });
                    }
                }
                
                let validPath = path.filter(p => p !== null);
                const startLoc = parseGeo(act?.start || act?.startLocation || act?.origin) || validPath[0];
                const endLoc = parseGeo(act?.end || act?.endLocation || act?.destination) || validPath[validPath.length-1];
                
                // --- SPEED & TYPE VERIFICATION ---
                let effectiveDist = distMeters;
                // Fallback: Calculate distance from lat/lng if missing/zero but points exist
                if ((!effectiveDist || effectiveDist === 0) && startLoc && endLoc) {
                     effectiveDist = getDistanceFromLatLonInKm(startLoc.lat, startLoc.lng, endLoc.lat, endLoc.lng) * 1000;
                }

                const km = effectiveDist / 1000;
                const hours = time.durationMs / 3600000;
                const speedKmH = hours > 0 ? km / hours : 0;

                // 1. Check walking/cycling speed
                // Threshold: 50km/h (World Class Cyclist Sprint is ~70km/h, simple cycling < 30km/h)
                if (['WALKING', 'RUNNING', 'CYCLING'].includes(type)) {
                    // Only reclassify if we have significant duration/distance to rule out GPS jitter
                    if (speedKmH > 50 && time.durationMs > 60000) {
                        type = 'DRIVING'; 
                    }
                }
                
                // 2. Check Driving speed
                // Threshold: 300km/h (Fastest trains/supercars)
                if (type === 'DRIVING' && speedKmH > 300 && time.durationMs > 120000) {
                     type = 'FLYING'; 
                }

                // 3. Check Flying validity
                if (type === 'FLYING') {
                    // If really short (<10km) OR really slow (<30km/h), likely taxiing/driving
                    // Using 30km/h to be conservative (taxiing is usually slow)
                    if (km < 10 || speedKmH < 30) {
                        type = 'DRIVING';
                    } else {
                        // Ensure basic path for flights if missing
                        if (validPath.length < 2 && startLoc && endLoc) {
                             validPath = [startLoc, endLoc];
                        }
                    }
                }

                normalized.push({
                    id: `act-${index}`,
                    type: 'ACTIVITY',
                    subType: type,
                    distance: effectiveDist,
                    duration: time.durationMs,
                    startTime: time.start,
                    endTime: time.end,
                    startLoc,
                    endLoc,
                    path: validPath,
                    isDetailed: validPath.length > 2, 
                    raw: item,
                    dateStr: dateStr,
                    speedKmH
                });
            }
        }
    });

    timelinePaths.forEach((tp, i) => {
        if (!tp.claimed && tp.startTime) {
             const dateStr = getLocalDate(tp.startTime);
             uniqueDays.add(dateStr);
             normalized.push({
                id: `tl-path-${i}`,
                type: 'ACTIVITY',
                subType: 'RAW_PATH',
                distance: 0, 
                duration: (tp.endTime && tp.startTime) ? tp.endTime - tp.startTime : 0,
                startTime: tp.startTime,
                endTime: tp.endTime,
                path: tp.points,
                isDetailed: true,
                raw: tp.raw,
                isFallback: true,
                dateStr: dateStr
             });
        }
    });

    // Sort
    normalized.sort((a, b) => (a.startTime?.getTime() || 0) - (b.startTime?.getTime() || 0));
    
    normalized.forEach(item => {
        const key = item.type === 'PLACE' ? 'PLACES' : (item.subType || 'UNKNOWN');
        stats.activityCounts[key] = (stats.activityCounts[key] || 0) + 1;
    });

    return { items: normalized, meta: stats, availableDates: Array.from(uniqueDays).sort() };
};


// --- 4. COMPONENTS ---

const CalendarWidget = ({ 
  availableDates, 
  selectedDates, 
  onToggle 
}: { 
  availableDates: string[]; 
  selectedDates: Set<string>; 
  onToggle: (d: string, isShift: boolean) => void; 
}) => {
    // Default view to most recent selected date or last available date
    const initialDate = useMemo(() => {
        if (selectedDates.size > 0) {
            const last = Array.from(selectedDates).sort().pop();
            return last ? new Date(last) : new Date();
        }
        if (availableDates.length > 0) {
            return new Date(availableDates[availableDates.length - 1]);
        }
        return new Date();
    }, []); // Intentionally empty dep array to only set once on mount if possible

    const [viewDate, setViewDate] = useState(initialDate);

    const monthDates = useMemo(() => {
        const y = viewDate.getFullYear();
        const m = viewDate.getMonth();
        const firstDay = new Date(y, m, 1);
        const lastDay = new Date(y, m + 1, 0);
        const daysInMonth = lastDay.getDate();
        const startDay = firstDay.getDay(); // 0 = Sun
        
        const days = [];
        for(let i=0; i<startDay; i++) days.push(null);
        for(let i=1; i<=daysInMonth; i++) {
            const str = `${y}-${String(m+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`;
            days.push({ num: i, str, hasData: availableDates.includes(str) });
        }
        return days;
    }, [viewDate, availableDates]);

    const changeMonth = (delta: number) => {
        setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1));
    };

    return (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-4">
            <div className="flex items-center justify-between mb-4">
                <button onClick={() => changeMonth(-1)} className="p-1 hover:bg-slate-100 rounded"><ChevronLeft className="w-4 h-4"/></button>
                <span className="font-bold text-slate-700 text-sm">
                    {viewDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
                </span>
                <button onClick={() => changeMonth(1)} className="p-1 hover:bg-slate-100 rounded"><ChevronRight className="w-4 h-4"/></button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-xs mb-2 text-center text-slate-400 font-medium">
                {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => <div key={d}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
                {monthDates.map((d, i) => {
                    if (!d) return <div key={i} className="h-8" />;
                    const isSelected = selectedDates.has(d.str);
                    return (
                        <button 
                            key={i}
                            disabled={!d.hasData}
                            onClick={(e) => d.hasData && onToggle(d.str, e.shiftKey)}
                            className={`h-8 rounded-full flex items-center justify-center text-xs transition-all relative
                                ${isSelected ? 'bg-blue-600 text-white font-bold shadow-md z-10' : ''}
                                ${!isSelected && d.hasData ? 'hover:bg-blue-50 text-slate-700 font-medium bg-slate-50' : ''}
                                ${!isSelected && !d.hasData ? 'text-slate-300 cursor-default' : ''}
                            `}
                            title={d.str}
                        >
                            {d.num}
                            {d.hasData && !isSelected && <span className="absolute bottom-1 w-1 h-1 bg-blue-400 rounded-full opacity-50"></span>}
                        </button>
                    )
                })}
            </div>
            <div className="mt-2 text-[10px] text-slate-400 text-center flex justify-between items-center">
               <span>{selectedDates.size} days selected <span className="text-slate-300 ml-1">(Shift+Click for range)</span></span>
               {selectedDates.size > 0 && (
                   <button onClick={() => onToggle('CLEAR', false)} className="text-red-500 hover:underline">Clear</button>
               )}
            </div>
        </div>
    );
};

const OverviewTab = ({ data, availableDates }: { data: ParsedItem[], availableDates: string[] }) => {
    const [selectedYear, setSelectedYear] = useState('ALL');
    const [selectedMonth, setSelectedMonth] = useState('ALL');

    const years = useMemo(() => {
        const y = new Set(availableDates.map(d => d.split('-')[0]));
        return Array.from(y).sort().reverse();
    }, [availableDates]);

    const months = useMemo(() => {
        if (selectedYear === 'ALL') return [];
        const relevant = availableDates.filter(d => d.startsWith(selectedYear));
        const m = new Set(relevant.map(d => d.split('-')[1]));
        return Array.from(m).sort();
    }, [selectedYear, availableDates]);

    const filteredData = useMemo(() => {
        let res = data;
        if (selectedYear !== 'ALL') {
            res = res.filter(d => d.dateStr.startsWith(selectedYear));
            if (selectedMonth !== 'ALL') {
                res = res.filter(d => d.dateStr.split('-')[1] === selectedMonth);
            }
        }
        return res;
    }, [data, selectedYear, selectedMonth]);

    const stats = useMemo(() => {
        const s = {
            totalDist: 0,
            totalTime: 0,
            activities: {} as Record<string, ActivityStat>
        };
        filteredData.forEach(d => {
            s.totalDist += (d.distance || 0);
            s.totalTime += (d.duration || 0);
            const k = d.type === 'PLACE' ? 'VISITS' : (d.subType || 'UNKNOWN');
            if (!s.activities[k]) s.activities[k] = { count: 0, dist: 0, duration: 0 };
            s.activities[k].count++;
            s.activities[k].dist += (d.distance || 0);
            s.activities[k].duration += (d.duration || 0);
        });
        return s;
    }, [filteredData]);

    // Helper for month names
    const getMonthName = (m: string) => {
        const date = new Date(2000, parseInt(m) - 1, 1);
        return date.toLocaleString('default', { month: 'long' });
    };

    return (
        <div className="max-w-5xl mx-auto p-8">
             {/* Filters */}
             <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-8 flex items-center gap-4 sticky top-0 z-10">
                <div className="flex items-center gap-2">
                    <CalendarIcon className="w-5 h-5 text-slate-400"/>
                    <span className="font-bold text-slate-700 text-sm">Filter Period:</span>
                </div>
                <select 
                    value={selectedYear} 
                    onChange={(e) => { setSelectedYear(e.target.value); setSelectedMonth('ALL'); }}
                    className="bg-slate-50 border border-slate-300 text-slate-700 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2"
                >
                    <option value="ALL">All Time</option>
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>

                {selectedYear !== 'ALL' && (
                    <select 
                        value={selectedMonth} 
                        onChange={(e) => setSelectedMonth(e.target.value)}
                        className="bg-slate-50 border border-slate-300 text-slate-700 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2"
                    >
                        <option value="ALL">All Months</option>
                        {months.map(m => <option key={m} value={m}>{getMonthName(m)}</option>)}
                    </select>
                )}
                
                <div className="ml-auto text-xs text-slate-500 font-medium">
                    Showing {filteredData.length} items
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <div className="text-slate-500 text-sm font-medium mb-1">Total Distance</div>
                    <div className="text-3xl font-bold text-slate-800">{formatDistance(stats.totalDist)}</div>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <div className="text-slate-500 text-sm font-medium mb-1">Total Duration</div>
                    <div className="text-3xl font-bold text-slate-800">{formatDuration(stats.totalTime)}</div>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <div className="text-slate-500 text-sm font-medium mb-1">Data Points</div>
                    <div className="text-3xl font-bold text-slate-800">{filteredData.length}</div>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 font-bold text-slate-700 flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-slate-400"/> Activity Breakdown
                </div>
                <div className="p-6">
                    <div className="space-y-4">
                        {(Object.entries(stats.activities) as [string, ActivityStat][])
                           .sort((a, b) => b[1].dist - a[1].dist)
                           .map(([key, val]) => {
                               const style = key === 'VISITS' ? { color: '#EF4444', label: 'Visits' } : safeGetStyle(key);
                               const percent = stats.totalDist > 0 ? (val.dist / stats.totalDist) * 100 : 0;
                               return (
                                   <div key={key} className="flex items-center gap-4">
                                       <div className="w-32 text-sm font-medium text-slate-700 flex items-center gap-2">
                                           <div className="w-3 h-3 rounded-full" style={{backgroundColor: style.color}}></div>
                                           {style.label}
                                       </div>
                                       <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                                           <div className="h-full rounded-full" style={{width: `${Math.max(percent, 2)}%`, backgroundColor: style.color}}></div>
                                       </div>
                                       <div className="w-48 text-right text-xs text-slate-500 font-mono">
                                           {key !== 'VISITS' && formatDistance(val.dist)} • {formatDuration(val.duration)} • {val.count}x
                                       </div>
                                   </div>
                               )
                           })}
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- 5. MAIN DASHBOARD ---

const Dashboard = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'inspector'>('overview');
  const [data, setData] = useState<ParsedItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [lastInteractionDate, setLastInteractionDate] = useState<string | null>(null);
  
  const [viewPoints, setViewPoints] = useState<DisplayPoint[]>([]);
  
  const [autoFit, setAutoFit] = useState(true);
  const [isLeafletLoaded, setIsLeafletLoaded] = useState(false);

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // --- Leaflet Loader ---
  useEffect(() => {
      if (window.L && window.L.map) { setIsLeafletLoaded(true); return; }
      if (!document.querySelector('link[href*="leaflet.css"]')) {
          const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(link);
      }
      const script = document.createElement('script'); script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; script.async = true;
      script.onload = () => { setTimeout(() => { if (window.L && window.L.map) setIsLeafletLoaded(true); }, 500); };
      document.head.appendChild(script);
  }, []);

  const filteredData = useMemo(() => {
      if (!data || selectedDates.size === 0) return [];
      // Sort filtered data by start time to ensure correct sequencing across days
      return data.filter(item => selectedDates.has(item.dateStr))
                 .sort((a,b) => (a.startTime?.getTime() || 0) - (b.startTime?.getTime() || 0));
  }, [data, selectedDates]);

  // Calculate Flattened Points with Separate Sequences
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

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true);
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const text = e.target?.result as string;
            const json = JSON.parse(text);
            const res = detectAndNormalize(json);
            setData(res.items);
            setAvailableDates(res.availableDates);

            if (res.availableDates.length > 0) {
                const last = res.availableDates[res.availableDates.length - 1];
                setSelectedDates(new Set([last]));
                setLastInteractionDate(last);
            }
            setLoading(false);
        } catch (err: any) {
            alert("Error: " + err.message);
            setLoading(false);
        }
    };
    reader.readAsText(file);
  };

  const handleDateToggle = (d: string, isShift: boolean) => {
      if (d === 'CLEAR') {
          setSelectedDates(new Set());
          setLastInteractionDate(null);
          return;
      }

      let newSet = new Set(selectedDates);

      // Shift-Click Range Selection
      if (isShift && lastInteractionDate && availableDates.includes(lastInteractionDate)) {
          const idx1 = availableDates.indexOf(lastInteractionDate);
          const idx2 = availableDates.indexOf(d);
          if (idx1 !== -1 && idx2 !== -1) {
              const start = Math.min(idx1, idx2);
              const end = Math.max(idx1, idx2);
              const range = availableDates.slice(start, end + 1);
              range.forEach(date => newSet.add(date));
          }
      } else {
          // Normal Toggle
          if (newSet.has(d)) newSet.delete(d);
          else newSet.add(d);
      }

      setSelectedDates(newSet);
      setLastInteractionDate(d);
  };

  const handleQuickJump = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const d = e.target.value;
      if (d && d !== 'none') {
          setSelectedDates(new Set([d]));
          setLastInteractionDate(d);
      }
  };

  // --- MAP LOGIC ---
  
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
      // Only init map if we are in inspector tab and have data
      if (activeTab !== 'inspector' || !isLeafletLoaded || typeof window.L === 'undefined' || !mapRef.current) return;

      // cleanup previous map instance
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
  }, [activeTab, isLeafletLoaded]);

  // Render Map Data
  useEffect(() => {
      if (activeTab !== 'inspector') return;
      const map = mapInstanceRef.current;
      if (!map || selectedDates.size === 0) return;

      map.eachLayer((l: any) => { if (!l._url) map.removeLayer(l); });

      // Draw Polylines
      filteredData.forEach(item => {
          if (item.type === 'ACTIVITY' && item.path && item.path.length > 1) {
              const style = safeGetStyle(item.subType);
              window.L.polyline(item.path, { color: style.color, weight: 4, opacity: 0.6 }).addTo(map);
          }
      });

      // Draw Markers
      const pointLayers = window.L.layerGroup().addTo(map);
      
      viewPoints.forEach(p => {
          const isVisit = p.sequenceType === 'VISIT';
          const color = isVisit ? '#EF4444' : safeGetStyle(p.parentType).color;
          const zIndex = isVisit ? 1000 : 100; 
          
          const iconHtml = `
            <div style="
                background-color: ${color}; 
                color: white; 
                width: ${isVisit ? '28px' : '14px'}; 
                height: ${isVisit ? '28px' : '14px'}; 
                border-radius: 50%; 
                display: flex; 
                align-items: center; 
                justify-content: center; 
                font-size: ${isVisit ? '12px' : '8px'}; 
                font-weight: bold; 
                border: ${isVisit ? '2px' : '1px'} solid white; 
                box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            ">
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

  }, [activeTab, selectedDates, filteredData, viewPoints, autoFit]);

  if (!data) return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 font-sans">
        <div className="bg-white p-10 rounded-2xl shadow-xl max-w-lg w-full text-center border border-slate-100">
          <div className="bg-blue-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-8 ring-8 ring-blue-50/50">
            <MapIcon className="w-10 h-10 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-3 tracking-tight">Timeline Visualizer</h1>
          <p className="text-slate-500 mb-8 text-base leading-relaxed">
            Upload your Google Location History JSON file to analyze your trips.
          </p>
          <div className="border-2 border-dashed border-slate-200 rounded-xl p-10 bg-slate-50 hover:bg-blue-50/50 hover:border-blue-300 transition-all relative cursor-pointer group">
            <input type="file" accept=".json" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
            <div className="transform group-hover:scale-105 transition-transform duration-200">
              <Upload className="w-12 h-12 text-slate-400 mx-auto mb-4 group-hover:text-blue-500" />
              <p className="font-semibold text-slate-700">Click to Upload JSON</p>
            </div>
          </div>
          {loading && <div className="mt-6 text-blue-600 flex justify-center items-center"><Clock className="animate-spin w-4 h-4 mr-2"/> Parsing...</div>}
        </div>
      </div>
  );

  return (
    <div className="h-screen flex flex-col font-sans text-slate-900 overflow-hidden">
      {/* Header & Tabs */}
      <header className="bg-white border-b border-slate-200 shadow-sm z-[500] flex-shrink-0">
         <div className="flex items-center justify-between px-4 py-2">
            <div className="flex items-center gap-3">
                <div className="bg-indigo-600 p-1.5 rounded text-white"><MapIcon className="w-5 h-5"/></div>
                <span className="font-bold text-lg">Timeline Inspector</span>
            </div>
            <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-lg">
                <button 
                    onClick={() => setActiveTab('overview')}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'overview' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    Overview
                </button>
                <button 
                    onClick={() => setActiveTab('inspector')}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'inspector' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    Map Inspector
                </button>
            </div>
            <div className="flex items-center gap-4 text-sm">
                <button onClick={() => setData(null)} className="text-red-500 hover:bg-red-50 px-3 py-1.5 rounded">Close File</button>
            </div>
         </div>
      </header>

      <div className="flex-1 flex overflow-hidden bg-slate-50">
          {activeTab === 'overview' && (
              <div className="flex-1 overflow-y-auto">
                  <OverviewTab data={data} availableDates={availableDates} />
              </div>
          )}

          {activeTab === 'inspector' && (
            <>
              {/* Sidebar */}
              <div className="w-[360px] bg-white border-r border-slate-200 flex flex-col flex-shrink-0 z-[400] shadow-xl">
                 
                 <div className="p-4 border-b border-slate-200 bg-slate-50">
                     <div className="mb-4">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">Quick Date Jump</label>
                        <div className="relative">
                            <select 
                                onChange={handleQuickJump}
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
                        onToggle={handleDateToggle} 
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
                                        onClick={() => panToPoint(p)}
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
                 
                 <div className="p-3 border-t border-slate-200 bg-slate-50 text-xs text-slate-500 flex justify-between font-medium">
                     <span>{formatDistance(filteredData.reduce((acc, curr) => acc + (curr.distance || 0), 0))} total</span>
                     <label className="flex items-center gap-2 cursor-pointer hover:text-slate-800">
                        <input type="checkbox" checked={autoFit} onChange={e => setAutoFit(e.target.checked)} /> Auto-fit
                     </label>
                 </div>
              </div>

              {/* Map Area */}
              <div className="flex-1 relative bg-slate-200">
                  <div ref={mapRef} className="absolute inset-0" />
                  
                  {/* Floating Legend */}
                  <div className="absolute bottom-6 left-6 bg-white p-3 rounded-lg shadow-lg z-[1000] border border-slate-200 text-xs">
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
            </>
          )}
      </div>
    </div>
  );
};

export default Dashboard;