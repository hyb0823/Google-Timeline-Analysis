import React, { useState, useMemo } from 'react';
import { Calendar as CalendarIcon, BarChart3 } from 'lucide-react';
import { ParsedItem, ActivityStat } from '../types';
import { formatDistance, formatDuration, safeGetStyle } from '../utils';

export const OverviewTab = ({ data, availableDates }: { data: ParsedItem[], availableDates: string[] }) => {
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

    const getMonthName = (m: string) => {
        const date = new Date(2000, parseInt(m) - 1, 1);
        return date.toLocaleString('default', { month: 'long' });
    };

    return (
        <div className="max-w-5xl mx-auto p-8">
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