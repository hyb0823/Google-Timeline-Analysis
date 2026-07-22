export interface GeoPoint {
  lat: number;
  lng: number;
  timestamp?: Date;
}

export interface ParsedItem {
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

export interface DisplayPoint {
  id: string;
  parentId?: string;
  sequenceId: number;
  sequenceType: 'VISIT' | 'PATH';
  lat: number;
  lng: number;
  timestamp: Date | null;
  type: 'PLACE' | 'POINT';
  parentType: string;
  subType?: string;
  parentActivity?: string;
}

export interface SavedPlace {
  id: string;
  title: string;
  address?: string;
  lat: number;
  lng: number;
  url?: string;
  listName?: string;
  category?: 'SAVED' | 'LABELED' | 'REVIEWED';
  icon?: string;
}



export interface ActivityStyles {
  [key: string]: { color: string; label: string };
}

export interface ActivityStat {
  count: number;
  dist: number;
  duration: number;
}

declare global {
  interface Window {
    L: any;
  }
}