import React, { useState, useEffect } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";
import "./App.css";

const initialState = {
  sql: "SELECT page_title, page_namespace FROM page \nLIMIT 10",
  row_template: "",
  wikilinks: {},
  comments: [],
  widths: {},
  table_style: "",
  table_class: "",
  excerpts: "",
  remove_underscores: [],
  interval: "",
  pagination: "",
  max_pages: "",
  hide: [],
  row_template_named_params: false,
  skip_table: false,
  header_template: "",
  footer_template: "",
  postprocess_js: "",
  silent: false,
};

const fieldHelp = {
  sql: "The SQL query used to generate the report. This is the only required parameter.",
  row_template: "Template name to use for each row instead of default table formatting.",
  wikilinks: "Configuration for wikilinking page titles.",
  comments: "Check any columns that contain edit summaries or log comments.",
  widths: "Explicitly specify column widths.",
  table_style: "CSS style attribute applied to the table element.",
  table_class: "CSS class attribute applied to the table element. Default: wikitable sortable",
  excerpts: "Configuration for showing article excerpts. Format: srcColumn:destColumn:namespace:charLimit:charHardLimit",
  remove_underscores: "Check any columns in which underscores should be replaced with spaces. (Done automatically for wikilinked columns)",
  interval: "Number of days to wait between automatic updates (minimum: 1).",
  pagination: "Number of results to include per page. Further results are saved to paginated subpages.",
  max_pages: "Maximum number of report pages to create when using pagination (max: 20).",
  hide: "Check any columns to hide from output (e.g. columns containing namespace numbers)",
  row_template_named_params: "Use column names as parameters instead of numbered parameters in row_template.",
  skip_table: "Suppress table markup completely.",
  header_template: "Template to use for table header instead of default header.",
  footer_template: "Template to use for table footer. For use with skip_table.",
  postprocess_js: "JavaScript code for custom postprocessing of query results.",
  silent: "Suppress visible output from the template. Only the bot-generated table will be visible."
};

// Basic SQL validation
function validateSQL(sql) {
  const errors = [];
  
  if (!sql.trim()) {
    errors.push("SQL query cannot be empty");
    return errors;
  }
  
  // Check for SELECT statement
  if (!/SELECT\s+/i.test(sql)) {
    errors.push("Query must start with SELECT");
  }
  
  // Check for FROM clause
  if (!/\bFROM\b/i.test(sql)) {
    errors.push("Query must contain FROM clause");
  }
  
  // Check for semicolon (not allowed in Database report)
  if (sql.includes(';')) {
    errors.push("Multiple statements with semicolons are not allowed");
  }
  
  // Check for potentially dangerous keywords
  const dangerousKeywords = ['DROP', 'DELETE', 'UPDATE', 'INSERT', 'CREATE', 'ALTER', 'TRUNCATE'];
  for (const keyword of dangerousKeywords) {
    if (new RegExp(`\\b${keyword}\\b`, 'i').test(sql)) {
      errors.push(`${keyword} statements are not allowed`);
    }
  }
  
  return errors;
}

// Parse SQL to extract column names and count
function parseSQLColumns(sql) {
  if (!sql.trim()) return { count: 0, names: [] };
  
  try {
    // Simple regex to find SELECT clause and extract columns
    const selectMatch = sql.match(/SELECT\s+(.*?)\s+FROM/i);
    if (!selectMatch) return { count: 0, names: [] };
    
    const selectClause = selectMatch[1];
    // Split by comma, but be careful about commas inside parentheses
    const columns = selectClause.split(',').map(col => col.trim());
    
    // Extract column names (handle "AS" aliases)
    const names = columns.map(col => {
      const asMatch = col.match(/\bAS\s+["`]?([^"`\s]+)["`]?$/i);
      if (asMatch) {
        return asMatch[1];
      }
      // Try to extract the last part after any function calls
      const lastPart = col.split(/[().\s]/).filter(part => part.trim()).pop();
      return lastPart || col;
    });
    
    return { count: columns.length, names };
  } catch (error) {
    console.error('Error parsing SQL:', error);
    return { count: 0, names: [] };
  }
}

// Convert object/array back to string format for wikitext
function formatWikilinks(wikilinks) {
  const parts = [];
  Object.entries(wikilinks).forEach(([column, config]) => {
    if (config.enabled) {
      let part = column;
      if (config.namespace) {
        part += `:${config.namespace}`;
        if (config.show) part += ':show';
      }
      parts.push(part);
    }
  });
  return parts.join(', ');
}

function formatWidths(widths) {
  const parts = [];
  Object.entries(widths).forEach(([column, width]) => {
    if (width.trim()) {
      parts.push(`${column}:${width}`);
    }
  });
  return parts.join(', ');
}

function buildWikitext(state) {
  let lines = ["{{Database report"];
  // Required
  lines.push(`|sql=\n${state.sql}`);
  // Optional fields
  const wikilinksStr = formatWikilinks(state.wikilinks);
  if (wikilinksStr) lines.push(`|wikilinks=${wikilinksStr}`);
  if (state.comments.length > 0) lines.push(`|comments=${state.comments.join(',')}`);
  const widthsStr = formatWidths(state.widths);
  if (widthsStr) lines.push(`|widths=${widthsStr}`);
  if (state.table_style) lines.push(`|table_style=${state.table_style}`);
  if (state.table_class) lines.push(`|table_class=${state.table_class}`);
  if (state.excerpts) lines.push(`|excerpts=${state.excerpts}`);
  if (state.remove_underscores.length > 0) lines.push(`|remove_underscores=${state.remove_underscores.join(',')}`);
  if (state.interval) lines.push(`|interval=${state.interval}`);
  if (state.pagination) lines.push(`|pagination=${state.pagination}`);
  if (state.max_pages) lines.push(`|max_pages=${state.max_pages}`);
  if (state.hide.length > 0) lines.push(`|hide=${state.hide.join(',')}`);
  if (state.row_template) lines.push(`|row_template=${state.row_template}`);
  if (state.row_template_named_params) lines.push(`|row_template_named_params=1`);
  if (state.skip_table) lines.push(`|skip_table=1`);
  if (state.header_template) lines.push(`|header_template=${state.header_template}`);
  if (state.footer_template) lines.push(`|footer_template=${state.footer_template}`);
  if (state.postprocess_js) lines.push(`|postprocess_js=\n${state.postprocess_js}`);
  if (state.silent) lines.push(`|silent=1`);
  lines.push("}}\n{{Database report end}}");
  return lines.join("\n");
}

function App() {
  const [state, setState] = useState(initialState);
  const [columnInfo, setColumnInfo] = useState({ count: 0, names: [] });
  const [sqlErrors, setSqlErrors] = useState([]);
  const [copied, setCopied] = useState(false);

  // Update column info and validate SQL when SQL changes
  useEffect(() => {
    const errors = validateSQL(state.sql);
    setSqlErrors(errors);
    
    const info = parseSQLColumns(state.sql);
    setColumnInfo(info);
    
    // Initialize dynamic fields if count changes
    if (info.count > 0) {
      const newWikilinks = {};
      const newWidths = {};
      
      for (let i = 1; i <= info.count; i++) {
        if (!state.wikilinks[i]) {
          newWikilinks[i] = { enabled: false, namespace: '', show: false };
        } else {
          newWikilinks[i] = state.wikilinks[i];
        }
        if (!state.widths[i]) {
          newWidths[i] = '';
        } else {
          newWidths[i] = state.widths[i];
        }
      }
      
      setState(prev => ({
        ...prev,
        wikilinks: newWikilinks,
        widths: newWidths
      }));
    }
  }, [state.sql]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setState((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSqlChange = (value) => {
    setState((prev) => ({ ...prev, sql: value }));
  };

  const handleWikilinkChange = (column, field, value) => {
    setState(prev => ({
      ...prev,
      wikilinks: {
        ...prev.wikilinks,
        [column]: {
          ...prev.wikilinks[column],
          [field]: field === 'enabled' || field === 'show' ? value : value
        }
      }
    }));
  };

  const handleWidthChange = (column, value) => {
    setState(prev => ({
      ...prev,
      widths: {
        ...prev.widths,
        [column]: value
      }
    }));
  };

  const handleMultiSelectChange = (field, column) => {
    setState(prev => {
      const currentArray = prev[field] || [];
      const newArray = currentArray.includes(column)
        ? currentArray.filter(c => c !== column)
        : [...currentArray, column];
      
      return {
        ...prev,
        [field]: newArray
      };
    });
  };

  const wikitext = buildWikitext(state);

  const handleCopy = () => {
    navigator.clipboard.writeText(wikitext);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="container">
      <div className="form-section">
        <h2>Database report template generator</h2>
        <form>
          <label>
            SQL query*
            <div className="field-help">{fieldHelp.sql}</div>
            <div className="sql-editor">
              <CodeMirror
                value={state.sql}
                height="120px"
                minHeight="120px"
                maxHeight="240px"
                extensions={[sql()]}
                onChange={handleSqlChange}
                theme="light"
                basicSetup={{ lineNumbers: true }}
                className="codemirror-sql"
              />
            </div>
            {sqlErrors.length > 0 && (
              <div className="sql-errors">
                {sqlErrors.map((error, index) => (
                  <div key={index} className="error-message">⚠️ {error}</div>
                ))}
              </div>
            )}
          </label>
          
          {columnInfo.count > 0 && (
            <div className="column-info">
              Detected {columnInfo.count} column{columnInfo.count !== 1 ? 's' : ''} in SQL query
            </div>
          )}

          {columnInfo.count > 0 && (
            <>
              <div className="dynamic-section">
                <h4>Wikilinks</h4>
                <div className="field-help">{fieldHelp.wikilinks}</div>
                <div className="column-grid">
                  {Array.from({ length: columnInfo.count }, (_, i) => i + 1).map(column => (
                    <div key={column} className="column-config">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={state.wikilinks[column]?.enabled || false}
                          onChange={(e) => handleWikilinkChange(column, 'enabled', e.target.checked)}
                        />
                        {columnInfo.names[column - 1] || `Column ${column}`}
                      </label>
                      {state.wikilinks[column]?.enabled && (
                        <div className="nested-config">
                          <select
                            value={state.wikilinks[column]?.namespace || ''}
                            onChange={(e) => handleWikilinkChange(column, 'namespace', e.target.value)}
                          >
                            <option value="">Select namespace...</option>
                            <option value="0">0 (Main namespace)</option>
                            <option value="1">1 (Talk)</option>
                            <option value="2">2 (User)</option>
                            <option value="3">3 (User talk)</option>
                            <option value="4">4 (Wikipedia)</option>
                            <option value="5">5 (Wikipedia talk)</option>
                            <option value="6">6 (File)</option>
                            <option value="7">7 (File talk)</option>
                            <option value="8">8 (MediaWiki)</option>
                            <option value="9">9 (MediaWiki talk)</option>
                            <option value="10">10 (Template)</option>
                            <option value="11">11 (Template talk)</option>
                            <option value="12">12 (Help)</option>
                            <option value="13">13 (Help talk)</option>
                            <option value="14">14 (Category)</option>
                            <option value="15">15 (Category talk)</option>
                            <option value="118">118 (Draft)</option>
                            <option value="119">119 (Draft talk)</option>
                            {Array.from({ length: columnInfo.count }, (_, i) => i + 1).map(col => (
                              <option key={col} value={`c${col}`}>
                                c{col} (Column {col}: {columnInfo.names[col - 1] || `Column ${col}`})
                              </option>
                            ))}
                          </select>
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={state.wikilinks[column]?.show || false}
                              onChange={(e) => handleWikilinkChange(column, 'show', e.target.checked)}
                            />
                            Show namespace
                          </label>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="dynamic-section">
                <h4>Column widths</h4>
                <div className="field-help">{fieldHelp.widths}</div>
                <div className="column-grid">
                  {Array.from({ length: columnInfo.count }, (_, i) => i + 1).map(column => (
                    <div key={column} className="column-config">
                      <label>
                        {columnInfo.names[column - 1] || `Column ${column}`}
                        <input
                          type="text"
                          placeholder="e.g., 10em, 20px"
                          value={state.widths[column] || ''}
                          onChange={(e) => handleWidthChange(column, e.target.value)}
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="dynamic-section">
                <h4>Comment columns</h4>
                <div className="field-help">{fieldHelp.comments}</div>
                <div className="column-grid">
                  {Array.from({ length: columnInfo.count }, (_, i) => i + 1).map(column => (
                    <div key={column} className="column-config">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={state.comments.includes(column)}
                          onChange={() => handleMultiSelectChange('comments', column)}
                        />
                        {columnInfo.names[column - 1] || `Column ${column}`}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="dynamic-section">
                <h4>Remove underscores</h4>
                <div className="field-help">{fieldHelp.remove_underscores}</div>
                <div className="column-grid">
                  {Array.from({ length: columnInfo.count }, (_, i) => i + 1).map(column => (
                    <div key={column} className="column-config">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={state.remove_underscores.includes(column)}
                          onChange={() => handleMultiSelectChange('remove_underscores', column)}
                        />
                        {columnInfo.names[column - 1] || `Column ${column}`}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="dynamic-section">
                <h4>Hide columns</h4>
                <div className="field-help">{fieldHelp.hide}</div>
                <div className="column-grid">
                  {Array.from({ length: columnInfo.count }, (_, i) => i + 1).map(column => (
                    <div key={column} className="column-config">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={state.hide.includes(column)}
                          onChange={() => handleMultiSelectChange('hide', column)}
                        />
                        {columnInfo.names[column - 1] || `Column ${column}`}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <label>
            Interval (days)
            <div className="field-help">{fieldHelp.interval}</div>
            <input
                type="number"
                name="interval"
                value={state.interval}
                onChange={handleChange}
                min="1"
            />
          </label>
          
          <label>
            Table style
            <div className="field-help">{fieldHelp.table_style}</div>
            <input
              type="text"
              name="table_style"
              value={state.table_style}
              onChange={handleChange}
              placeholder="e.g. overflow-wrap: anywhere"
            />
          </label>
          
          <label>
            Table class
            <div className="field-help">{fieldHelp.table_class}</div>
            <input
              type="text"
              name="table_class"
              value={state.table_class}
              onChange={handleChange}
              placeholder="e.g. wikitable sortable"
            />
          </label>

          <label>
            Row template
            <div className="field-help">{fieldHelp.row_template}</div>
            <input
                type="text"
                name="row_template"
                value={state.row_template}
                onChange={handleChange}
                placeholder="Template name"
            />
          </label>

          <label className="checkbox-label">
            <input
                type="checkbox"
                name="row_template_named_params"
                checked={state.row_template_named_params}
                onChange={handleChange}
            />
            {fieldHelp.row_template_named_params}
          </label>

          <label className="checkbox-label">
            <input
                type="checkbox"
                name="skip_table"
                checked={state.skip_table}
                onChange={handleChange}
            />
            {fieldHelp.skip_table}
          </label>

          <label>
            Header template
            <div className="field-help">{fieldHelp.header_template}</div>
            <input
                type="text"
                name="header_template"
                value={state.header_template}
                onChange={handleChange}
                placeholder="Template name"
            />
          </label>

          <label>
            Footer template
            <div className="field-help">{fieldHelp.footer_template}</div>
            <input
                type="text"
                name="footer_template"
                value={state.footer_template}
                onChange={handleChange}
                placeholder="Template name"
            />
          </label>

          <label className="checkbox-label">
            <input
                type="checkbox"
                name="silent"
                checked={state.silent}
                onChange={handleChange}
            />
            {fieldHelp.silent}
          </label>
          
          <label>
            Excerpts
            <div className="field-help">{fieldHelp.excerpts}</div>
            <input
              type="text"
              name="excerpts"
              value={state.excerpts}
              onChange={handleChange}
              placeholder="Excerpt config"
            />
          </label>
          
          <label>
            Pagination (results per page)
            <div className="field-help">{fieldHelp.pagination}</div>
            <input
              type="number"
              name="pagination"
              value={state.pagination}
              onChange={handleChange}
              min="1"
            />
          </label>
          
          <label>
            Max pages
            <div className="field-help">{fieldHelp.max_pages}</div>
            <input
              type="number"
              name="max_pages"
              value={state.max_pages}
              onChange={handleChange}
              min="1"
              max="20"
            />
          </label>
          
          <label>
            Postprocess JS
            <div className="field-help">{fieldHelp.postprocess_js}</div>
            <textarea
              name="postprocess_js"
              value={state.postprocess_js}
              onChange={handleChange}
              rows={3}
              placeholder="JS code"
            />
          </label>
        </form>
      </div>
      <div className="preview-section">
        <div className="preview-header">
          <h3>Generated template</h3>
          <button className="copy-btn" onClick={handleCopy} title="Copy to clipboard">
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <pre className="wikitext-preview">{wikitext}</pre>
      </div>
    </div>
  );
}

export default App;
