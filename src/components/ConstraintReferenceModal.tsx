import { useState } from 'react';
import { CONSTRAINT_GROUPS, CONSTRAINT_SYNTAX_LINES, CONSTRAINT_NOTES } from '../lib/constraintExamples';
import './ConstraintReferenceModal.css';

interface Props {
  open: boolean;
  onClose: () => void;
  /** If provided, each example has a "Insert →" button that calls this. */
  onInsert?: (snippet: string) => void;
}

const ConstraintReferenceModal = ({ open, onClose, onInsert }: Props) => {
  const [copiedIdx, setCopiedIdx] = useState<string | null>(null);

  if (!open) return null;

  const copy = (key: string, snippet: string) => {
    navigator.clipboard?.writeText(snippet);
    setCopiedIdx(key);
    setTimeout(() => setCopiedIdx(null), 1200);
  };

  return (
    <div className="crm-overlay" onClick={onClose}>
      <div className="crm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="crm-header">
          <div>
            <h2>Constraint DSL Reference</h2>
            <p>ทุกรูปแบบที่ parser ในหน้า Additional Constraints รองรับ</p>
          </div>
          <button className="crm-close" onClick={onClose} title="Close">✕</button>
        </div>

        <div className="crm-body">
          <section className="crm-syntax">
            <h3>Syntax สั้น ๆ</h3>
            <pre className="crm-code">
              {CONSTRAINT_SYNTAX_LINES.join('\n')}
            </pre>
            <ul className="crm-notes">
              {CONSTRAINT_NOTES.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </section>

          {CONSTRAINT_GROUPS.map((group, gi) => (
            <section key={gi} className="crm-group">
              <h3>{group.heading}</h3>
              {group.items.map((item, ii) => {
                const key = `${gi}_${ii}`;
                return (
                  <div key={ii} className="crm-example">
                    <div className="crm-example-head">
                      <div>
                        <div className="crm-example-title">{item.title}</div>
                        <div className="crm-example-desc">{item.description}</div>
                      </div>
                      <div className="crm-example-actions">
                        <button
                          className="crm-btn-copy"
                          onClick={() => copy(key, item.snippet)}
                          title="Copy to clipboard"
                        >
                          {copiedIdx === key ? '✓ Copied' : 'Copy'}
                        </button>
                        {onInsert && (
                          <button
                            className="crm-btn-insert"
                            onClick={() => { onInsert(item.snippet); onClose(); }}
                            title="Insert into editor"
                          >
                            Insert →
                          </button>
                        )}
                      </div>
                    </div>
                    <pre className="crm-code">{item.snippet}</pre>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ConstraintReferenceModal;
