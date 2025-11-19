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

const interpolateTimestamps = (path: GeoPoint[], start: Date, end: Date) => {
    if (!path || path.length < 1) return;
    
    // Ensure first and last have timestamps
    if (!path[0].timestamp) path[0].timestamp = start;
    if (!path[path.length - 1].timestamp) path[path.length - 1].timestamp = end;

    const startTime = path[0].timestamp!.getTime();
    const endTime = path[path.length - 1].timestamp!.getTime();
    const duration = endTime - startTime;

    if (duration <= 0) return;

    // Calculate cumulative distance for distribution to be more accurate
    let totalDist = 0;
    const dists = [0]; 
    for (let i = 0; i < path.length - 1; i++) {
        const d = getDistanceFromLatLonInKm(path[i].lat, path[i].lng, path[i+1].lat, path[i+1].lng);
        totalDist += d;
        dists.push(totalDist);
    }

    if (totalDist === 0) {
        // Fallback to linear index-based interpolation if no distance
        const step = duration / (path.length - 1);
        for (let i = 1; i < path.length - 1; i++) {
            if (!path[i].timestamp) {
                path[i].timestamp = new Date(startTime + (i * step));
            }
        }
        return;
    }

    // Interpolate based on distance fraction
    for (let i = 1; i < path.length - 1; i++) {
        if (!path[i].timestamp) {
            const fraction = dists[i] / totalDist;
            path[i].timestamp = new Date(startTime + (fraction * duration));
        }
    }
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
                
                // INTERPOLATION: Ensure all points have timestamps
                if (validPath.length > 0 && time.start && time.end) {
                    interpolateTimestamps(validPath, time.start, time.end);
                }

                const startLoc = parseGeo(act?.start || act?.startLocation || act?.origin) || validPath[0];
                const endLoc = parseGeo(act?.end || act?.endLocation || act?.destination) || validPath[validPath.length-1];

                let effectiveDist = distMeters;
                if ((!effectiveDist || effectiveDist === 0) && startLoc && endLoc) {
                     effectiveDist = getDistanceFromLatLonInKm(startLoc.lat, startLoc.lng, endLoc.lat, endLoc.lng) * 1000;
                }

                const km = effectiveDist / 1000;
                const hours = time.durationMs / 3600000;
                const speedKmH = hours > 0 ? km / hours : 0;

                // --- STRICTER ACTIVITY VERIFICATION ---

                // 1. Walking / Running / Cycling logic
                if (['WALKING', 'RUNNING'].includes(type)) {
                    if (speedKmH > 20) type = 'CYCLING'; // Likely cycling if > 20km/h sustained
                    if (speedKmH > 50) type = 'DRIVING'; // Likely driving if > 50km/h
                }
                else if (type === 'CYCLING') {
                    if (speedKmH > 70) type = 'DRIVING';
                }

                // 2. Driving vs Flying vs Train
                else if (type === 'DRIVING') {
                    if (speedKmH > 300 && km > 50) {
                        type = 'TRAIN'; // High speed train
                        if (speedKmH > 500) type = 'FLYING';
                    }
                }

                // 3. Flying check
                else if (type === 'FLYING') {
                    // If speed is too slow or dist too short, it's likely driving (e.g. taxiing or error)
                    if (speedKmH < 50 || km < 20) {
                        type = 'DRIVING';
                    } else {
                        // If flying but no path, fake a straight line for visualization
                        if (validPath.length < 2 && startLoc && endLoc) {
                             validPath = [startLoc, endLoc];
                             validPath[0].timestamp = time.start;
                             validPath[1].timestamp = time.end;
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