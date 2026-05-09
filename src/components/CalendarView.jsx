import { useState } from 'react';
import { format, addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, isToday } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function CalendarView({ entries, onSelectEntry }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);

  const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

  const getEntriesForDay = (date) => {
    return entries.filter(entry => {
      const entryDate = new Date(entry.created_at);
      return isSameDay(entryDate, date);
    });
  };

  const selectedEntries = getEntriesForDay(selectedDate);

  return (
    <div>
      <div className="calendar-container">
        <div className="calendar-header">
          <button className="btn-secondary" style={{ padding: '8px', border: 'none' }} onClick={prevMonth}>
            <ChevronLeft />
          </button>
          <h2 style={{ fontSize: '1.25rem' }}>{format(currentMonth, 'MMMM yyyy')}</h2>
          <button className="btn-secondary" style={{ padding: '8px', border: 'none' }} onClick={nextMonth}>
            <ChevronRight />
          </button>
        </div>
        
        <div className="calendar-grid">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="calendar-day-header">{d}</div>
          ))}
          
          {calendarDays.map((day, i) => {
            const dayEntries = getEntriesForDay(day);
            const isCurrentMonth = isSameMonth(day, monthStart);
            const isSelected = isSameDay(day, selectedDate);
            const isDayToday = isToday(day);
            
            return (
              <div 
                key={i} 
                className={`calendar-day ${!isCurrentMonth ? 'empty' : ''} ${isSelected ? 'selected' : ''} ${isDayToday ? 'today' : ''}`}
                onClick={() => { if (isCurrentMonth) setSelectedDate(day); }}
              >
                {format(day, 'd')}
                {dayEntries.length > 0 && <div className="entry-dot"></div>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="selected-day-entries">
        <h3 style={{ marginBottom: '24px', fontSize: '1.1rem', color: 'var(--text-muted)' }}>
          {format(selectedDate, 'MMMM d, yyyy')}
        </h3>
        
        {selectedEntries.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {selectedEntries.map(entry => (
              <div key={entry.id} className="card" onClick={() => onSelectEntry(entry)} style={{ cursor: 'pointer' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '12px', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{format(new Date(entry.created_at), 'h:mm a')}</span>
                  {entry.mood && <span style={{ background: 'var(--accent-soft-lavender)', color: 'var(--bg-deep-navy)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>{entry.mood}</span>}
                </div>
                <p style={{ lineHeight: '1.6', whiteSpace: 'pre-wrap', fontSize: '1rem' }}>
                  {entry.content.substring(0, 150)}
                  {entry.content.length > 150 ? '...' : ''}
                </p>
                {entry.entry_attachments && entry.entry_attachments.length > 0 && (
                  <div style={{ marginTop: '12px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    📎 {entry.entry_attachments.length} attachment{entry.entry_attachments.length > 1 ? 's' : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '48px' }}>
            No entries for this day.
          </p>
        )}
      </div>
    </div>
  );
}
