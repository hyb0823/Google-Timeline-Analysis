import { ParsedItem, GeoPoint } from './types';
import { getDistanceFromLatLonInKm } from './utils';

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
        if (input.timestamp) {
             if (typeof input.timestamp === 'string' && /^\d+$/.test(input.timestamp)) {
                 time = new Date(parseInt(input.timestamp));
             } else {
                 time = new Date(input.timestamp);
             }
        }
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
    if (['IN PASSENGER VEHICLE', 'PASSENGER VEHICLE', 'IN CAR', 'DRIVING', 'MOTORCYCLING', 'CAR', 'MOVING', 'VEHICLE'].includes(t)) return 'DRIVING';
    if (['IN TRAIN', 'TRAIN', 'SUBWAY', 'IN SUBWAY', 'TRAM', 'IN TRAM', 'RAIL', 'HEAVY RAIL', 'LIGHT RAIL', 'METRO', 'UNDERGROUND'].includes(t)) return 'TRAIN';
    if (['IN BUS', 'BUS'].includes(t)) return 'BUS';
    if (['IN FERRY', 'FERRY', 'BOAT'].includes(t)) return 'FERRY';
    if (['FLYING', 'IN FLIGHT', 'PLANE', 'AIR'].includes(t)) return 'FLYING';
    if (['RUNNING'].includes(t)) return 'RUNNING';
    if (['WALKING', 'ON FOOT', 'HIKING'].includes(t)) return 'WALKING';
    if (['CYCLING', 'ON BICYCLE'].includes(t)) return 'CYCLING';
    return 'UNKNOWN';
};

const interpolateTimestamps = (path: GeoPoint[], start: Date, end: Date) => {
    if (!path || path.length < 1) return;
    
    // 1. Ensure boundaries have timestamps
    if (!path[0].timestamp) path[0].timestamp = start;
    if (!path[path.length - 1].timestamp) path[path.length - 1].timestamp = end;

    // 2. Find all anchors (indices that already have timestamps)
    const anchors: number[] = [];
    for (let i = 0; i < path.length; i++) {
        if (path[i].timestamp) anchors.push(i);
    }

    // 3. Interpolate between anchors
    for (let k = 0; k < anchors.length - 1; k++) {
        const idx1 = anchors[k];
        const idx2 = anchors[k+1];
        
        // Skip if adjacent
        if (idx2 === idx1 + 1) continue;

        const t1 = path[idx1].timestamp!.getTime();
        const t2 = path[idx2].timestamp!.getTime();
        const timeDiff = t2 - t1;
        
        if (timeDiff <= 0) continue;

        // Calculate cumulative distance for this segment
        let segmentDist = 0;
        const dists: number[] = [0];
        for (let i = idx1; i < idx2; i++) {
            const d = getDistanceFromLatLonInKm(path[i].lat, path[i].lng, path[i+1].lat, path[i+1].lng);
            segmentDist += d;
            dists.push(segmentDist);
        }

        // Interpolate based on distance fraction
        for (let i = idx1 + 1; i < idx2; i++) {
            const fraction = segmentDist > 0 ? dists[i - idx1] / segmentDist : (i - idx1) / (idx2 - idx1);
            path[i].timestamp = new Date(t1 + (fraction * timeDiff));
        }
    }
};

const createSlice = (original: ParsedItem, startIdx: number, endIdx: number): ParsedItem | null => {
    if (!original.path || startIdx > endIdx) return null;
    const path = original.path.slice(startIdx, endIdx + 1);
    
    // Allow single point slices. This prevents data loss when a massive jump
    // splits a 2-point activity into two 1-point activities.
    if (path.length < 1) return null;
    
    const s = path[0];
    const e = path[path.length-1];
    if (!s.timestamp || !e.timestamp) return null;

    const startT = s.timestamp;
    const endT = e.timestamp;
    
    let dist = 0;
    for(let i=0; i<path.length-1; i++) {
        dist += getDistanceFromLatLonInKm(path[i].lat, path[i].lng, path[i+1].lat, path[i+1].lng);
    }
    dist = dist * 1000; // meters

    return {
        ...original,
        id: `${original.id}-seg-${startIdx}`,
        path: path,
        startLoc: s,
        endLoc: e,
        startTime: startT,
        endTime: endT,
        duration: Math.max(0, endT.getTime() - startT.getTime()),
        distance: dist,
        isDetailed: true,
        subType: original.subType
    };
};

const getRobustStats = (path: GeoPoint[]) => {
    let totalDist = 0;
    const speeds: number[] = [];
    
    for (let i = 0; i < path.length - 1; i++) {
        const p1 = path[i];
        const p2 = path[i+1];
        const d = getDistanceFromLatLonInKm(p1.lat, p1.lng, p2.lat, p2.lng);
        totalDist += d;
        
        if (p1.timestamp && p2.timestamp) {
             const t = (p2.timestamp.getTime() - p1.timestamp.getTime()) / 3600000; // hours
             // Filter noise: extremely short time or distance might produce erratic speeds
             if (t > 0.0002 && d > 0.002) { 
                 speeds.push(d/t);
             }
        }
    }
    
    let maxSpeed = 0;
    if (speeds.length > 0) {
        speeds.sort((a,b) => a - b);
        // Use 95th percentile to ignore GPS jumps/outliers
        const idx = Math.floor(speeds.length * 0.95);
        maxSpeed = speeds[idx];
    }
    
    const totalTimeH = path.length > 1 && path[0].timestamp && path[path.length-1].timestamp 
        ? (path[path.length-1].timestamp!.getTime() - path[0].timestamp!.getTime()) / 3600000
        : 0;

    return { maxSpeed, totalDist, avgSpeed: totalTimeH > 0 ? totalDist / totalTimeH : 0 };
};

const reclassifyItem = (item: ParsedItem): ParsedItem => {
    let type = item.subType || 'UNKNOWN';
    if (!item.path || item.path.length < 2) return item;

    const stats = getRobustStats(item.path);
    const maxSpeed = stats.maxSpeed;
    const avgSpeed = stats.avgSpeed;

    // Only intervene for impossible walking speeds if it's still impossible after splitting.
    if (['WALKING', 'RUNNING', 'ON FOOT'].includes(type)) {
        // Extremely conservative check. 
        if (maxSpeed > 120 || avgSpeed > 60) {
            type = 'DRIVING';
        }
    }
    
    item.subType = type;
    item.speedKmH = avgSpeed;
    return item;
};

const splitActivity = (item: ParsedItem): ParsedItem[] => {
    if (!item.path || item.path.length < 2) return [reclassifyItem(item)];

    const points = item.path;
    const splits: number[] = [];
    const isFlight = item.subType === 'FLYING';

    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i+1];
        if (!p1.timestamp || !p2.timestamp) continue;

        const gapMs = p2.timestamp.getTime() - p1.timestamp.getTime();
        const distKm = getDistanceFromLatLonInKm(p1.lat, p1.lng, p2.lat, p2.lng);

        // Time thresholds
        const timeThreshold = isFlight ? 12 * 60 * 60 * 1000 : 20 * 60 * 1000;

        let shouldSplit = gapMs > timeThreshold;

        // CRITICAL: If distance is huge and we are not flying, this is likely a missing flight
        // or teleportation (bad timestamps). We MUST split here to prevent this "Jump" from
        // being calculated as "Walking at 5000km/h".
        // Use a higher threshold (150km) to avoid breaking up long road trips with sparse data.
        if (!isFlight && distKm > 150) {
            shouldSplit = true;
        }

        if (shouldSplit) {
             splits.push(i);
        }
    }

    if (splits.length === 0) return [reclassifyItem(item)];

    const result: ParsedItem[] = [];
    let startIdx = 0;
    
    splits.forEach(splitIdx => {
        if (splitIdx >= startIdx) {
            const slice = createSlice(item, startIdx, splitIdx);
            if (slice) result.push(reclassifyItem(slice));
            startIdx = splitIdx + 1;
        }
    });

    if (startIdx < points.length) {
        const slice = createSlice(item, startIdx, points.length - 1);
        if (slice) result.push(reclassifyItem(slice));
    }

    return result.length > 0 ? result : [reclassifyItem(item)];
};

export const detectAndNormalize = (json: any) => {
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

    const initialNormalized: ParsedItem[] = [];
    const uniqueDays = new Set<string>();

    const getLocalDate = (dateObj: Date | null) => {
        if(!dateObj) return 'UNKNOWN';
        // USE UTC to avoid timezone shifting issues when grouping days
        return dateObj.getUTCFullYear() + '-' +
               String(dateObj.getUTCMonth() + 1).padStart(2, '0') + '-' +
               String(dateObj.getUTCDate()).padStart(2, '0');
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
                 
                 // Construct GeoPoints for start/end to enable gap linking
                 const placeLoc = { lat: loc.lat, lng: loc.lng, timestamp: time.start };
                 const placeEndLoc = { lat: loc.lat, lng: loc.lng, timestamp: time.end || time.start };
                 
                 initialNormalized.push({
                     id: `place-${index}`, type: 'PLACE', name: String(name), lat: loc.lat, lng: loc.lng,
                     startTime: time.start, endTime: time.end, duration: time.durationMs, raw: item,
                     dateStr: dateStr,
                     startLoc: placeLoc,
                     endLoc: placeEndLoc
                 });
             }
        }

        if (act) {
            const rawType = act?.topCandidate?.type || act?.activityType;
            let type = normalizeActivityType(rawType);
            const time = parseTime(act, item.startTime, item.endTime);
            const distMeters = parseFloat(act?.distanceMeters || act?.distance || 0);

            if (time.start && time.end) {
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
                
                if (validPath.length > 0) {
                    interpolateTimestamps(validPath, time.start, time.end);
                }

                const startLoc = parseGeo(act?.start || act?.startLocation || act?.origin) || validPath[0];
                const endLoc = parseGeo(act?.end || act?.endLocation || act?.destination) || validPath[validPath.length-1];

                let effectiveDist = distMeters;
                if ((!effectiveDist || effectiveDist === 0) && startLoc && endLoc) {
                     effectiveDist = getDistanceFromLatLonInKm(startLoc.lat, startLoc.lng, endLoc.lat, endLoc.lng) * 1000;
                }

                const parsedAct: ParsedItem = {
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
                    isDetailed: validPath.length > 1,
                    raw: item,
                    dateStr: dateStr
                };

                const segments = splitActivity(parsedAct);
                segments.forEach(seg => initialNormalized.push(seg));
            }
        }
    });

    timelinePaths.forEach((tp, i) => {
        if (!tp.claimed && tp.startTime) {
             const dateStr = getLocalDate(tp.startTime);
             uniqueDays.add(dateStr);
             interpolateTimestamps(tp.points, tp.startTime, tp.endTime || tp.startTime);
             
             // Ensure raw paths have startLoc/endLoc for gap filling
             const s = tp.points[0];
             const e = tp.points[tp.points.length-1];
             
             initialNormalized.push({
                id: `tl-path-${i}`,
                type: 'ACTIVITY',
                subType: 'RAW_PATH',
                distance: 0,
                duration: (tp.endTime && tp.startTime) ? tp.endTime - tp.startTime : 0,
                startTime: tp.startTime,
                endTime: tp.endTime,
                path: tp.points,
                startLoc: s,
                endLoc: e,
                isDetailed: true,
                raw: tp.raw,
                isFallback: true,
                dateStr: dateStr
             });
        }
    });

    initialNormalized.sort((a, b) => (a.startTime?.getTime() || 0) - (b.startTime?.getTime() || 0));

    // --- Post-Processing: Fill Gaps with Flights/Driving ---
    // This handles "Teleportation" where timestamps are wrong or GPS skipped a trip.
    const finalItems: ParsedItem[] = [];
    
    for (let i = 0; i < initialNormalized.length; i++) {
        const curr = initialNormalized[i];
        finalItems.push(curr);

        if (i < initialNormalized.length - 1) {
            const next = initialNormalized[i+1];
            // We can now check endLoc/startLoc safely for all item types (Place, Activity, Raw Path)
            if (curr.endLoc && next.startLoc && curr.endTime && next.startTime) {
                 const dist = getDistanceFromLatLonInKm(curr.endLoc.lat, curr.endLoc.lng, next.startLoc.lat, next.startLoc.lng);
                 const timeDiff = next.startTime.getTime() - curr.endTime.getTime();
                 const hours = timeDiff / 3600000;
                 
                 // Calculate speed if time is positive
                 const speed = hours > 0 ? dist / hours : 0; 

                 // Logic: Connect only significant large gaps (> 50km) to avoid noise.
                 if (dist > 50) {
                     let inferredType = 'DRIVING';

                     // User defined threshold: 200 km/h for flights.
                     // Added constraint: Distance must be substantial (> 250km) to be a flight.
                     // This avoids classifying short GPS jumps or fast regional travel as flights.
                     if (speed > 200 && dist > 250 && speed < 1500) {
                         inferredType = 'FLYING';
                     }
                     // If it's absurdly fast, it's an error/teleportation.
                     else if (speed >= 1500) {
                         inferredType = 'UNKNOWN';
                     }

                     finalItems.push({
                         id: `inferred-gap-${curr.id}-${next.id}`,
                         type: 'ACTIVITY',
                         subType: inferredType,
                         startTime: curr.endTime,
                         endTime: next.startTime,
                         startLoc: curr.endLoc,
                         endLoc: next.startLoc,
                         path: [curr.endLoc, next.startLoc],
                         distance: dist * 1000,
                         duration: Math.max(0, timeDiff),
                         isDetailed: false,
                         isFallback: true,
                         raw: {},
                         dateStr: curr.dateStr,
                         speedKmH: speed
                     });
                 }
            }
        }
    }

    const stats = { format: formatType, activityCounts: {} as Record<string, number> };
    finalItems.forEach(item => {
        const key = item.type === 'PLACE' ? 'PLACES' : (item.subType || 'UNKNOWN');
        stats.activityCounts[key] = (stats.activityCounts[key] || 0) + 1;
    });

    return { items: finalItems, meta: stats, availableDates: Array.from(uniqueDays).sort() };
};