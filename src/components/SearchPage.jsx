import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { clickableProps } from '../lib/a11y';

export default function SearchPage({ entries, onSelectEntry }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeMood, setActiveMood] = useState(null);
  
  const allMoods = useMemo(() => {
    const moods = new Set();
    entries.forEach(e => {
      if (e.mood) moods.add(e.mood);
    });
    return Array.from(moods);
  }, [entries]);

  const filteredEntries = useMemo(() => {
    return entries.filter(entry => {
      const matchText = entry.content.toLowerCase().includes(searchTerm.toLowerCase());
      const matchMood = activeMood ? entry.mood === activeMood : true;
      return matchText && matchMood;
    });
  }, [entries, searchTerm, activeMood]);

  return (
    <div>
      <input 
        type="text" 
        className="search-input"
        placeholder="Search for a word, feeling, or memory..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
      />

      {allMoods.length > 0 && (
        <div className="filter-chips">
          <button 
            className={`filter-chip ${activeMood === null ? 'active' : ''}`}
            onClick={() => setActiveMood(null)}
          >
            All
          </button>
          {allMoods.map(mood => (
            <button 
              key={mood}
              className={`filter-chip ${activeMood === mood ? 'active' : ''}`}
              onClick={() => setActiveMood(mood)}
            >
              {mood}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {filteredEntries.length > 0 ? (
          filteredEntries.map(entry => (
            <div key={entry.id} className="card" {...clickableProps(() => onSelectEntry(entry))} style={{ cursor: 'pointer' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '12px', display: 'flex', justifyContent: 'space-between' }}>
                <span>{format(new Date(entry.created_at), 'MMMM d, yyyy')}</span>
                {entry.mood && <span style={{ background: 'var(--accent-soft-lavender)', color: 'var(--bg-deep-navy)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>{entry.mood}</span>}
              </div>
              <p style={{ lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
                {entry.content.substring(0, 200)}
                {entry.content.length > 200 ? '...' : ''}
              </p>
              {entry.entry_attachments && entry.entry_attachments.length > 0 && (
                <div style={{ marginTop: '12px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  📎 {entry.entry_attachments.length} attachment{entry.entry_attachments.length > 1 ? 's' : ''}
                </div>
              )}
            </div>
          ))
        ) : (
          <div style={{ textAlign: 'center', marginTop: '48px', color: 'var(--text-muted)' }}>
            <p style={{ marginBottom: '8px' }}>Nothing found here yet.</p>
            <p style={{ fontSize: '0.9rem' }}>Maybe this feeling is still waiting to be written.</p>
          </div>
        )}
      </div>
    </div>
  );
}
