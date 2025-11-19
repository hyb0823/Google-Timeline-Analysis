import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface CalendarWidgetProps {
  availableDates: string[];
  selectedDates: Set<string>;
  onToggle: (d: string, isShift: boolean) => void;
}

export const CalendarWidget = ({
  availableDates,
  selectedDates,
  onToggle
}: CalendarWidgetProps) => {
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