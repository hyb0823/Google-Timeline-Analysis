import { ActivityStyles, GeoPoint } from './types';

export const ACTIVITY_STYLES: ActivityStyles = {
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

export const safeGetStyle = (type: string | undefined) => {
    const t = type || 'UNKNOWN';
    return ACTIVITY_STYLES[t] || ACTIVITY_STYLES['UNKNOWN'];
};

export const formatDuration = (ms: number) => {
    if (!ms || isNaN(ms)) return "0m";
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
};

export const formatDistance = (meters: number) => {
  if (!meters) return "0 km";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
};

export const deg2rad = (deg: number) => {
  return deg * (Math.PI/180)
}

export const getDistanceFromLatLonInKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
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

// --- Geodesic / Great Circle Math for Curved Flight Paths ---

const toRad = (d: number) => d * Math.PI / 180;
const toDeg = (r: number) => r * 180 / Math.PI;

interface Point3D { x: number; y: number; z: number; }

const toVector = (lat: number, lng: number): Point3D => {
    const phi = toRad(lat);
    const theta = toRad(lng);
    const x = Math.cos(phi) * Math.cos(theta);
    const y = Math.cos(phi) * Math.sin(theta);
    const z = Math.sin(phi);
    return { x, y, z };
};

const toLatLng = (v: Point3D): { lat: number; lng: number } => {
    const lat = toDeg(Math.asin(v.z));
    const lng = toDeg(Math.atan2(v.y, v.x));
    return { lat, lng };
};

// Spherical Linear Interpolation (Slerp)
export const getGeodesicPath = (start: GeoPoint, end: GeoPoint, segments: number = 50): [number, number][] => {
    const p1 = toVector(start.lat, start.lng);
    const p2 = toVector(end.lat, end.lng);

    // Angle between vectors
    let dot = p1.x * p2.x + p1.y * p2.y + p1.z * p2.z;
    // Clamp dot product to [-1, 1] to avoid NaN errors
    dot = Math.max(-1, Math.min(1, dot));
    
    const theta = Math.acos(dot);
    
    // If points are very close, return straight line
    if (theta < 1e-6) {
        return [[start.lat, start.lng], [end.lat, end.lng]];
    }

    const path: [number, number][] = [];
    
    for (let i = 0; i <= segments; i++) {
        const f = i / segments;
        const a = Math.sin((1 - f) * theta) / Math.sin(theta);
        const b = Math.sin(f * theta) / Math.sin(theta);

        const x = a * p1.x + b * p2.x;
        const y = a * p1.y + b * p2.y;
        const z = a * p1.z + b * p2.z;

        const p = toLatLng({ x, y, z });
        path.push([p.lat, p.lng]);
    }

    return path;
};

// --- Ramer-Douglas-Peucker (RDP) Line Simplification ---

const getPerpendicularDistance = (point: GeoPoint, lineStart: GeoPoint, lineEnd: GeoPoint) => {
    const dx = lineEnd.lng - lineStart.lng;
    const dy = lineEnd.lat - lineStart.lat;

    if (dx === 0 && dy === 0) {
        const dLat = point.lat - lineStart.lat;
        const dLng = point.lng - lineStart.lng;
        return Math.sqrt(dLat * dLat + dLng * dLng);
    }

    const u = ((point.lng - lineStart.lng) * dx + (point.lat - lineStart.lat) * dy) / (dx * dx + dy * dy);

    let nearestLat: number;
    let nearestLng: number;

    if (u < 0) {
        nearestLat = lineStart.lat;
        nearestLng = lineStart.lng;
    } else if (u > 1) {
        nearestLat = lineEnd.lat;
        nearestLng = lineEnd.lng;
    } else {
        nearestLat = lineStart.lat + u * dy;
        nearestLng = lineStart.lng + u * dx;
    }

    const dLat = point.lat - nearestLat;
    const dLng = point.lng - nearestLng;
    return Math.sqrt(dLat * dLat + dLng * dLng);
};

export const simplifyPath = (points: GeoPoint[], tolerance: number = 0.00008): GeoPoint[] => {
    if (!points || points.length <= 2) return points;

    let maxDist = 0;
    let maxIdx = 0;
    const end = points.length - 1;

    for (let i = 1; i < end; i++) {
        const dist = getPerpendicularDistance(points[i], points[0], points[end]);
        if (dist > maxDist) {
            maxDist = dist;
            maxIdx = i;
        }
    }

    if (maxDist > tolerance) {
        const left = simplifyPath(points.slice(0, maxIdx + 1), tolerance);
        const right = simplifyPath(points.slice(maxIdx), tolerance);
        return [...left.slice(0, left.length - 1), ...right];
    } else {
        return [points[0], points[end]];
    }
};