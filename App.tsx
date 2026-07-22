import React, { useState } from 'react';
import { Upload, Map as MapIcon, Clock } from 'lucide-react';
import { ParsedItem } from './types';
import { detectAndNormalize } from './parser';
import { OverviewTab } from './components/OverviewTab';
import { MapInspector } from './components/MapInspector';
import { formatDistance } from './utils';

const App = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'inspector'>('overview');
  const [data, setData] = useState<ParsedItem[] | null>(null);
  const [loading, setLoading] = useState(false);

  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [lastInteractionDate, setLastInteractionDate] = useState<string | null>(null);
  const [rangeModeActive, setRangeModeActive] = useState(false);

  const [savedPlaces, setSavedPlaces] = useState<import('./types').SavedPlace[]>([]);

  const handleUpdateItemType = (itemId: string, newType: string) => {
    if (!data) return;
    setData(prevData => {
      if (!prevData) return null;
      return prevData.map(item => {
        if (item.id === itemId) {
          return { ...item, subType: newType };
        }
        return item;
      });
    });
  };

  const handleSavedPlacesUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const json = JSON.parse(text);
        const places: import('./types').SavedPlace[] = [];

        // Support GeoJSON format (including Google Takeout Saved Places.json)
        if (json.type === 'FeatureCollection' && Array.isArray(json.features)) {
          json.features.forEach((f: any, idx: number) => {
            const coords = f.geometry?.coordinates;
            if (coords && coords.length >= 2) {
              const title = f.properties?.location?.name || f.properties?.name || f.properties?.title || 'Saved Place';
              const address = f.properties?.location?.address || f.properties?.address || f.properties?.description;
              const url = f.properties?.google_maps_url || f.properties?.url || f.properties?.location_url;
              places.push({
                id: `sp-${idx}`,
                title,
                address,
                lat: coords[1],
                lng: coords[0],
                url
              });
            }
          });
        }

        // Support Google Takeout Saved Places JSON format (array or items)
        else {
          const items = Array.isArray(json) ? json : (json.features || json.items || Object.values(json).find(v => Array.isArray(v)) as any[] || []);
          items.forEach((item: any, idx: number) => {
            const title = item.title || item.name || item.properties?.name || 'Saved Place';
            const loc = item.geometry?.coordinates ? { lat: item.geometry.coordinates[1], lng: item.geometry.coordinates[0] }
                     : (item.location || item.placeLocation || item);
            let lat: number | null = null;
            let lng: number | null = null;
            if (loc) {
              if (loc.latitudeE7) { lat = loc.latitudeE7 / 1e7; lng = loc.longitudeE7 / 1e7; }
              else if (loc.lat) { lat = loc.lat; lng = loc.lng; }
              else if (loc.latitude) { lat = loc.latitude; lng = loc.longitude; }
            }
            if (lat && lng) {
              places.push({
                id: `sp-${idx}`,
                title,
                address: item.address || item.properties?.address,
                lat,
                lng,
                url: item.url || item.googleMapsUrl
              });
            }
          });
        }
        setSavedPlaces(places);
        alert(`Successfully imported ${places.length} saved places!`);
      } catch (err: any) {
        alert("Error importing saved places: " + err.message);
      }
    };
    reader.readAsText(file);
  };

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
          setRangeModeActive(false);
          return;
      }

      let newSet = new Set(selectedDates);
      const isRangeTriggered = isShift || rangeModeActive;

      if (isRangeTriggered && lastInteractionDate && availableDates.includes(lastInteractionDate)) {
          const idx1 = availableDates.indexOf(lastInteractionDate);
          const idx2 = availableDates.indexOf(d);
          if (idx1 !== -1 && idx2 !== -1) {
              const start = Math.min(idx1, idx2);
              const end = Math.max(idx1, idx2);
              const range = availableDates.slice(start, end + 1);
              range.forEach(date => newSet.add(date));
          }
          if (rangeModeActive) setRangeModeActive(false);
      } else {
          if (newSet.has(d)) newSet.delete(d);
          else newSet.add(d);
      }

      setSelectedDates(newSet);
      setLastInteractionDate(d);
  };

  const handleQuickJump = (d: string, isShift: boolean) => {
      if (!d || d === 'none') return;

      if (isShift && lastInteractionDate && availableDates.includes(lastInteractionDate)) {
          const idx1 = availableDates.indexOf(lastInteractionDate);
          const idx2 = availableDates.indexOf(d);
          if (idx1 !== -1 && idx2 !== -1) {
              const start = Math.min(idx1, idx2);
              const end = Math.max(idx1, idx2);
              const range = availableDates.slice(start, end + 1);
              const newSet = new Set(selectedDates);
              range.forEach(date => newSet.add(date));
              setSelectedDates(newSet);
          }
      } else {
          setSelectedDates(new Set([d]));
      }
      setLastInteractionDate(d);
  };

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
                <label className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-3 py-1.5 rounded cursor-pointer transition-colors">
                  ⭐ Import Saved Places
                  <input type="file" accept=".json,.geojson,.csv" onChange={handleSavedPlacesUpload} className="hidden" />
                </label>
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
             <MapInspector 
               data={data} 
               availableDates={availableDates} 
               selectedDates={selectedDates} 
               onDateToggle={handleDateToggle}
               onQuickJump={handleQuickJump}
               rangeModeActive={rangeModeActive}
               setRangeModeActive={setRangeModeActive}
               lastInteractionDate={lastInteractionDate}
               onUpdateItemType={handleUpdateItemType}
               savedPlaces={savedPlaces}
             />
          )}
      </div>
    </div>
  );
};


export default App;