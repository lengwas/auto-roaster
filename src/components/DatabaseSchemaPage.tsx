import type { Store, Promoter, Shift } from '../types/types';
import './DatabaseSchemaPage.css';

interface DatabaseSchemaPageProps {
  stores: Store[];
  promoters: Promoter[];
  shifts: Shift[];
}

const DatabaseSchemaPage = ({ }: DatabaseSchemaPageProps) => {
  return (
    <div className="schema-page">
      <div className="schema-header">
        <h2>Database</h2>
      </div>

      <div className="schema-section">
        <h3>Table Relationships</h3>
        <div className="erd-diagram">
          <div className="erd-table">
            <div className="erd-title">stores</div>
            <div className="erd-col"><span className="erd-pk">id</span> UUID PK</div>
            <div className="erd-col"><span className="erd-key">code</span> VARCHAR(10) UNIQUE</div>
            <div className="erd-col">name TEXT</div>
            <div className="erd-col">active BOOLEAN</div>
            <div className="erd-col">open_time TIME</div>
            <div className="erd-col">close_time TIME</div>
            <div className="erd-col">extra_allowance TEXT?</div>
            <div className="erd-col">max_capacity INT?</div>
          </div>

          <div className="erd-table">
            <div className="erd-title">promoters</div>
            <div className="erd-col"><span className="erd-pk">id</span> UUID PK</div>
            <div className="erd-col">name TEXT</div>
            <div className="erd-col">active BOOLEAN</div>
            <div className="erd-col">day_off VARCHAR(3)</div>
          </div>

          <div className="erd-table">
            <div className="erd-title">promoter_stores</div>
            <div className="erd-col"><span className="erd-pk">id</span> UUID PK</div>
            <div className="erd-col"><span className="erd-fk">promoter_id</span> UUID FK</div>
            <div className="erd-col"><span className="erd-fk">store_id</span> UUID FK</div>
          </div>

          <div className="erd-table erd-highlight">
            <div className="erd-title">shifts</div>
            <div className="erd-col"><span className="erd-pk">id</span> UUID PK</div>
            <div className="erd-col"><span className="erd-fk">promoter_id</span> UUID FK</div>
            <div className="erd-col"><span className="erd-key">date</span> DATE</div>
            <div className="erd-col">shift_type TEXT</div>
            <div className="erd-col">time_range TEXT?</div>
            <div className="erd-col">note TEXT?</div>
            <div className="erd-col erd-constraint">UNIQUE(promoter_id, date)</div>
          </div>

          <div className="erd-table">
            <div className="erd-title">shift_change_log</div>
            <div className="erd-col"><span className="erd-pk">id</span> UUID PK</div>
            <div className="erd-col"><span className="erd-fk">shift_id</span> UUID FK?</div>
            <div className="erd-col"><span className="erd-fk">promoter_id</span> UUID FK</div>
            <div className="erd-col">date DATE</div>
            <div className="erd-col">old_type TEXT?</div>
            <div className="erd-col">new_type TEXT?</div>
            <div className="erd-col">old_note TEXT?</div>
            <div className="erd-col">new_note TEXT?</div>
            <div className="erd-col">changed_by TEXT</div>
            <div className="erd-col">changed_at TIMESTAMPTZ</div>
          </div>

          <div className="erd-table">
            <div className="erd-title">promoter_store_preferences</div>
            <div className="erd-col"><span className="erd-pk">id</span> UUID PK</div>
            <div className="erd-col"><span className="erd-fk">promoter_id</span> UUID FK</div>
            <div className="erd-col"><span className="erd-fk">store_id</span> UUID FK</div>
            <div className="erd-col">preference TEXT</div>
            <div className="erd-col erd-constraint">UNIQUE(promoter_id, store_id)</div>
          </div>

          <div className="erd-table">
            <div className="erd-title">promoter_conflicts</div>
            <div className="erd-col"><span className="erd-pk">id</span> UUID PK</div>
            <div className="erd-col"><span className="erd-fk">promoter_a_id</span> UUID FK</div>
            <div className="erd-col"><span className="erd-fk">promoter_b_id</span> UUID FK</div>
            <div className="erd-col">reason TEXT?</div>
            <div className="erd-col erd-constraint">CHECK(a_id &lt; b_id)</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DatabaseSchemaPage;
