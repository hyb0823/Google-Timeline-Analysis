import React, { useState } from 'react';
import { Upload, Map as MapIcon, Clock } from 'lucide-react';
import { ParsedItem } from './types';
import { detectAndNormalize } from './parser';
import { OverviewTab } from './components/OverviewTab';
import { MapInspector } from './components/MapInspector';
import { formatDistance } from './utils';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 text-center bg-red-50 text-red-700 font-sans">
          <h2 className="text-xl font-bold mb-2">Something went wrong while rendering the view</h2>
          <p className="text-sm font-mono bg-red-100 p-3 rounded max-w-xl mx-auto mb-4">{String(this.state.error?.message || this.state.error)}</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 bg-red-600 text-white rounded font-bold">Reload Page</button>
        </div>
      );
    }
    return this.props.children;
  }
}


const App = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'inspector'>('inspector');
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

  const getLatestActiveDate = (items: ParsedItem[], dates: string[]): string => {
    for (let i = dates.length - 1; i >= 0; i--) {
        const dateStr = dates[i];
        const dayItems = items.filter(it => it.dateStr === dateStr);
        const hasValidActivityOrVisit = dayItems.some(it => 
            (it.type === 'PLACE' && it.lat && it.lng) ||
            (it.type === 'ACTIVITY' && (it.path && it.path.length > 1 || (it.startLoc && it.endLoc)))
        );
        if (hasValidActivityOrVisit) return dateStr;
    }
    return dates[dates.length - 1] || '';
  };

  const parsePlacesFeatureCollection = (json: any, defaultCategory: 'SAVED' | 'LABELED' | 'REVIEWED' = 'SAVED', defaultIcon: string = '⭐'): import('./types').SavedPlace[] => {
    const places: import('./types').SavedPlace[] = [];
    if (!json) return places;

    const features = Array.isArray(json) ? json : (json.features || json.items || []);
    features.forEach((f: any, idx: number) => {
      const coords = f.geometry?.coordinates;
      const title = f.properties?.location?.name || f.properties?.name || f.properties?.title || 'Saved Point';
      const address = f.properties?.location?.address || f.properties?.address || f.properties?.description;
      const url = f.properties?.google_maps_url || f.properties?.url || f.properties?.location_url;
      
      let lat: number | null = null;
      let lng: number | null = null;
      if (coords && coords.length >= 2) {
        lat = coords[1];
        lng = coords[0];
      } else if (f.location || f.placeLocation) {
        const loc = f.location || f.placeLocation;
        if (loc.latitudeE7) { lat = loc.latitudeE7 / 1e7; lng = loc.longitudeE7 / 1e7; }
        else if (loc.lat) { lat = loc.lat; lng = loc.lng; }
        else if (loc.latitude) { lat = loc.latitude; lng = loc.longitude; }
      }

      if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
        let icon = defaultIcon;
        if (defaultCategory === 'LABELED') {
          const lowerName = String(title).toLowerCase();
          if (lowerName.includes('home')) icon = '🏠';
          else if (lowerName.includes('work')) icon = '💼';
          else icon = '📍';
        }

        places.push({
          id: `sp-${defaultCategory}-${idx}`,
          title,
          address,
          lat,
          lng,
          url,
          category: defaultCategory,
          icon
        });
      }
    });

    return places;
  };

  const handleLoadLocalTakeout = async () => {
    setLoading(true);
    try {
      const resHistory = await fetch('/Takeout/location-history.json');
      if (!resHistory.ok) throw new Error("File Takeout/location-history.json not found on server");
      const jsonHistory = await resHistory.json();
      const parsed = detectAndNormalize(jsonHistory);
      setData(parsed.items);
      setAvailableDates(parsed.availableDates);

      if (parsed.availableDates.length > 0) {
        const activeDate = getLatestActiveDate(parsed.items, parsed.availableDates);
        setSelectedDates(new Set([activeDate]));
        setLastInteractionDate(activeDate);
      }

      const allPlaces: import('./types').SavedPlace[] = [];

      // 1. Saved Places
      try {
        const resSaved = await fetch('/Takeout/Maps (your places)/Saved Places.json');
        if (resSaved.ok) {
          const jsonSaved = await resSaved.json();
          allPlaces.push(...parsePlacesFeatureCollection(jsonSaved, 'SAVED', '⭐'));
        }
      } catch (e) {}

      // 2. Labeled Places (Home, Work)
      try {
        const resLabeled = await fetch('/Takeout/Maps/My labeled places/Labeled places.json');
        if (resLabeled.ok) {
          const jsonLabeled = await resLabeled.json();
          allPlaces.push(...parsePlacesFeatureCollection(jsonLabeled, 'LABELED', '📍'));
        }
      } catch (e) {}

      // 3. Reviews
      try {
        const resReviews = await fetch('/Takeout/Maps (your places)/Reviews.json');
        if (resReviews.ok) {
          const jsonReviews = await resReviews.json();
          allPlaces.push(...parsePlacesFeatureCollection(jsonReviews, 'REVIEWED', '💬'));
        }
      } catch (e) {}

      setSavedPlaces(allPlaces);

      setActiveTab('inspector');
      setLoading(false);
    } catch (err: any) {
      alert("Could not auto-load Takeout file: " + err.message);
      setLoading(false);
    }
  };

  const parseCSVPlaces = (csvText: string, listName: string = 'Imported List'): import('./types').SavedPlace[] => {
    const lines = csvText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.replace(/^["']|["']$/g, '').trim().toLowerCase());
    const titleIdx = headers.findIndex(h => h.includes('title') || h.includes('name'));
    const latIdx = headers.findIndex(h => h.includes('lat') || h.includes('latitude'));
    const lngIdx = headers.findIndex(h => h.includes('lng') || h.includes('lon') || h.includes('longitude'));
    const urlIdx = headers.findIndex(h => h.includes('url') || h.includes('link'));
    const addressIdx = headers.findIndex(h => h.includes('address') || h.includes('location') || h.includes('note'));

    const places: import('./types').SavedPlace[] = [];

    for (let i = 1; i < lines.length; i++) {
        const row = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || lines[i].split(',');
        const cleanRow = row.map(cell => cell.replace(/^["']|["']$/g, '').trim());

        const title = (titleIdx !== -1 && cleanRow[titleIdx]) ? cleanRow[titleIdx] : `Saved Place #${i}`;
        let lat: number | null = null;
        let lng: number | null = null;

        if (latIdx !== -1 && lngIdx !== -1 && cleanRow[latIdx] && cleanRow[lngIdx]) {
            lat = parseFloat(cleanRow[latIdx]);
            lng = parseFloat(cleanRow[lngIdx]);
        } else {
            for (const cell of cleanRow) {
                if (cell.startsWith('geo:')) {
                    const parts = cell.replace('geo:', '').split(',');
                    if (parts.length >= 2) {
                        lat = parseFloat(parts[0]);
                        lng = parseFloat(parts[1]);
                        break;
                    }
                }
            }
        }

        if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
            places.push({
                id: `sp-csv-${listName}-${i}`,
                title,
                address: addressIdx !== -1 ? cleanRow[addressIdx] : undefined,
                lat,
                lng,
                url: urlIdx !== -1 ? cleanRow[urlIdx] : undefined,
                category: 'SAVED',
                icon: '⭐',
                listName
            });
        }
    }

    return places;
  };

  const handleSavedPlacesUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    let importedCount = 0;
    const fileList = Array.from(files);

    fileList.forEach((file, fIdx) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          let places: import('./types').SavedPlace[] = [];
          if (file.name.endsWith('.csv')) {
            places = parseCSVPlaces(text, file.name.replace('.csv', ''));
          } else {
            const json = JSON.parse(text);
            places = parsePlacesFeatureCollection(json, 'SAVED', '⭐');
          }
          setSavedPlaces(prev => [...prev, ...places]);
          importedCount += places.length;

          if (fIdx === fileList.length - 1) {
            alert(`Successfully imported ${importedCount} saved place(s) from ${fileList.length} file(s)!`);
          }
        } catch (err: any) {
          console.error("Error importing places from " + file.name, err);
        }
      };
      reader.readAsText(file);
    });
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

            // Select the most recent date that has active GPS track/visit points
            if (res.availableDates.length > 0) {
                const activeDate = getLatestActiveDate(res.items, res.availableDates);
                setSelectedDates(new Set([activeDate]));
                setLastInteractionDate(activeDate);
            }
            setActiveTab('inspector');
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

      if (d === 'ALL') {
          setSelectedDates(new Set(availableDates));
          return;
      }

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
          
          <div className="space-y-4">
            <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 bg-slate-50 hover:bg-blue-50/50 hover:border-blue-300 transition-all relative cursor-pointer group">
              <input type="file" accept=".json" onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
              <div className="transform group-hover:scale-105 transition-transform duration-200">
                <Upload className="w-10 h-10 text-slate-400 mx-auto mb-3 group-hover:text-blue-500" />
                <p className="font-semibold text-slate-700 text-sm">Click to Upload JSON File</p>
              </div>
            </div>

            <div className="relative flex py-2 items-center">
                <div className="flex-grow border-t border-slate-200"></div>
                <span className="flex-shrink mx-4 text-xs font-bold text-slate-400 uppercase">Or</span>
                <div className="flex-grow border-t border-slate-200"></div>
            </div>

            <button
               onClick={handleLoadLocalTakeout}
               className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-xl shadow-md transition-all flex items-center justify-center gap-2 text-sm"
            >
               ✨ Auto-Load Uploaded Takeout Data (14,256 items + Saved Places)
            </button>
          </div>

          {loading && <div className="mt-6 text-blue-600 flex justify-center items-center font-semibold text-sm"><Clock className="animate-spin w-4 h-4 mr-2"/> Processing dataset...</div>}
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
                  ⭐ Import Saved Places / Lists
                  <input type="file" accept=".json,.geojson,.csv" multiple onChange={handleSavedPlacesUpload} className="hidden" />
                </label>

                <button onClick={() => setData(null)} className="text-red-500 hover:bg-red-50 px-3 py-1.5 rounded">Close File</button>
            </div>
         </div>
      </header>

      <div className="flex-1 flex overflow-hidden bg-slate-50">
        <ErrorBoundary>
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
        </ErrorBoundary>
      </div>

    </div>
  );
};


export default App;