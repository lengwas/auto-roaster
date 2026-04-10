import { useMemo, useState } from 'react';
import changelogData from '../data/changelog.json';
import './ChangelogPage.css';

interface ChangelogEntry {
  hash: string;
  short: string;
  author: string;
  date: string;
  subject: string;
}

interface ChangelogJson {
  generatedAt: string;
  entries: ChangelogEntry[];
}

const data = changelogData as ChangelogJson;

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-CA') + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

const ChangelogPage = () => {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data.entries;
    return data.entries.filter(e =>
      e.subject.toLowerCase().includes(q) ||
      e.short.toLowerCase().includes(q) ||
      e.author.toLowerCase().includes(q),
    );
  }, [search]);

  return (
    <div className="cl-page">
      <div className="cl-header">
        <h2>Changelog</h2>
        <p>Recent changes from git history (auto-generated at build time)</p>
        <div className="cl-meta">Generated: {fmtDate(data.generatedAt)} · {data.entries.length} commits</div>
      </div>

      <input
        type="text"
        className="cl-search"
        placeholder="Search commits…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="cl-list">
        {filtered.map((e) => (
          <div key={e.hash} className="cl-item">
            <div className="cl-item-meta">
              <span className="cl-item-date">{fmtDate(e.date)}</span>
              <span className="cl-item-hash">{e.short}</span>
              <span className="cl-item-author">{e.author}</span>
            </div>
            <div className="cl-item-subject">{e.subject}</div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="cl-empty">No commits matching "{search}"</div>
        )}
      </div>
    </div>
  );
};

export default ChangelogPage;
