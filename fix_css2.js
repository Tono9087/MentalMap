const fs = require('fs');
const file = 'style.css';
let c = fs.readFileSync(file, 'utf8');

// The broken section: missing closing brace after color: var(--accent);
// and a bunch of missing rules before .tb-export-main:hover
const badStr = '.tb-drop-opt:hover {\r\n    background: rgba(99,102,241,.1);\r\n    color: var(--accent);\r\n\r\n.tb-export-main:hover,';

const goodStr = `.tb-drop-opt:hover {
    background: rgba(99,102,241,.1);
    color: var(--accent);
}

.tb-drop-opt svg { flex-shrink: 0; opacity: .75; }
.tb-drop-opt:hover svg { opacity: 1; }

[data-theme="dark"] .tb-dropdown {
    background: #1e1e28;
    border-color: #3c3c50;
}

[data-theme="dark"] .tb-drop-opt {
    color: var(--text);
}

[data-theme="dark"] .tb-drop-opt:hover {
    background: rgba(99,102,241,.18);
    color: #a5b4fc;
}

/* -- Layout dropdown extras -- */
.tb-layout-drop {
    min-width: 220px;
}

.tb-drop-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .7px;
    color: var(--muted);
    padding: 6px 14px 2px;
}

.layout-opt {
    align-items: center;
    gap: 10px;
    padding: 9px 12px !important;
}

.layout-icon {
    font-size: 18px;
    line-height: 1;
    flex-shrink: 0;
    width: 26px;
    text-align: center;
}

.layout-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    text-align: left;
}

.layout-info b {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    display: block;
}

.layout-info small {
    font-size: 11px;
    color: var(--muted);
    font-weight: 400;
    display: block;
}

.layout-opt.active {
    background: rgba(99,102,241,.1);
}

.layout-opt.active .layout-info b,
.layout-opt:hover .layout-info b {
    color: var(--accent);
}

/* -- Export wrap fix -- */
.tb-export-wrap {
    position: relative;
}

.tb-export-main {
    color: var(--accent) !important;
    font-weight: 600 !important;
    border: 1.5px solid transparent;
    transition: background var(--t), color var(--t), border-color var(--t) !important;
}

.tb-export-main:hover,`;

const idx = c.indexOf(badStr);
if (idx === -1) {
    console.log('Not found with CRLF – trying LF only...');
    const badLF = badStr.replace(/\r\n/g, '\n');
    const idxLF = c.indexOf(badLF);
    console.log('LF idx:', idxLF);
} else {
    c = c.substring(0, idx) + goodStr + c.substring(idx + badStr.length);
    fs.writeFileSync(file, c, 'utf8');
    console.log('DONE. Fixed at index', idx);
}
