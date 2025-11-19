import { ActivityStyles } from './types';

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