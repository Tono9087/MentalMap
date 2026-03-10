/**
 * MindMap — app.js
 * Toda la lógica de la aplicación:
 *  - Estado (nodos, aristas, pan/zoom)
 *  - Creación de nodos de texto e imagen
 *  - Edición inline
 *  - Drag & drop de nodos
 *  - Pan + zoom del canvas
 *  - Marcos de imagen (pegar, subir, arrastrar archivo)
 *  - Exportar / importar JSON
 *  - Modo oscuro
 *  - Atajos de teclado
 */

'use strict';

/* ═══════════════════════════════════════════════════════
   CONSTANTES
═══════════════════════════════════════════════════════ */
const IMAGE_SHAPES = new Set(['img-circle', 'img-square', 'img-rect']);
const ROOT_SHAPES = ['root-circle', 'root-square', 'root-rect', 'root-diamond', 'root-hexagon'];
const NODE_SIZES = ['central', 'medio', 'texto'];

/* ═══════════════════════════════════════════════════════
   ESTADO GLOBAL
═══════════════════════════════════════════════════════ */
let nodes = {};   // id → { id, label, x, y, shape, parentId, imageData?, rootShape?, nodeSize? }
let edges = {};   // `parentId-childId` → SVGPathElement
let nextId = 1;
let selectedId = null;
let editingId = null;
let dragging = null;  // { id, ox, oy }
let pan = { x: 0, y: 0 };
let scale = 1;
let panDragging = false;
let panStart = null;
let currentRootShape = 'root-circle';   // estado de forma del nódo raíz

// Para el file-input de imagen: qué nodo espera la imagen
let pendingImageNodeId = null;

/* ═══════════════════════════════════════════════════════
   REFERENCIAS DOM
═══════════════════════════════════════════════════════ */
const canvasWrap = document.getElementById('canvas-wrap');
const canvasEl = document.getElementById('canvas');
const svgEl = document.getElementById('connections');
const ctxPanel = document.getElementById('ctx-panel');
const toastEl = document.getElementById('toast');
const imgFileInput = document.getElementById('img-file-input');
const rootImgFileInput = document.getElementById('root-img-file-input');
const jsonFileInput = document.getElementById('json-file-input');

/* ═══════════════════════════════════════════════════════
   UTILIDADES
═══════════════════════════════════════════════════════ */
function uid() { return 'n' + (nextId++); }

let toastTimer;
function toast(msg, duration = 2200) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
}

function isImageShape(shape) {
    return IMAGE_SHAPES.has(shape);
}

/* ─── Transform canvas ───────────────────────────────── */
function applyTransform() {
    const t = `translate(${pan.x}px,${pan.y}px) scale(${scale})`;
    canvasEl.style.transform = t;
    svgEl.style.transform = t;
}

/* ─── Coordenadas pantalla → mundo ───────────────────── */
function toWorld(sx, sy) {
    return { x: (sx - pan.x) / scale, y: (sy - pan.y) / scale };
}

/* ═══════════════════════════════════════════════════════
   CREACIÓN DE NODOS
═══════════════════════════════════════════════════════ */
function createNode({ id, label, x, y, shape = 'circle', parentId = null, imageData = null, rootShape = null, nodeSize = null }) {
    id = id || uid();
    const node = { id, label, x, y, shape, parentId, imageData, rootShape, nodeSize };
    nodes[id] = node;

    const el = document.createElement('div');
    el.className = `node ${shape}`;
    el.dataset.id = id;
    el.style.left = x + 'px';
    el.style.top = y + 'px';

    /* Aplicar tamaño al nodo (no root) */
    if (shape !== 'root' && nodeSize) {
        el.classList.add('size-' + nodeSize);
    }

    if (isImageShape(shape)) {
        buildImageNode(el, node);
    } else {
        buildTextNode(el, node);
    }

    /* Botón agregar hijo */
    const addBtn = document.createElement('div');
    addBtn.className = 'add-btn';
    addBtn.title = 'Agregar nodo hijo';
    addBtn.textContent = '+';
    addBtn.addEventListener('pointerdown', e => {
        e.stopPropagation();
        selectNode(id);
        addChildNode(id, 'circle');
    });
    el.appendChild(addBtn);

    /* Botón eliminar (no para root) */
    if (shape !== 'root') {
        const delBtn = document.createElement('div');
        delBtn.className = 'del-btn';
        delBtn.title = 'Eliminar nodo';
        delBtn.textContent = '×';
        delBtn.addEventListener('pointerdown', e => {
            e.stopPropagation();
            deleteNode(id);
        });
        el.appendChild(delBtn);
    }

    /* Botón de arrastre (drag handle) — aparece en todas las figuras */
    const dragHandle = document.createElement('div');
    dragHandle.className = 'drag-handle';
    dragHandle.title = 'Arrastrar para mover';
    dragHandle.innerHTML = `<svg width="9" height="12" viewBox="0 0 9 12" fill="currentColor">
      <circle cx="2" cy="2"   r="1.2"/><circle cx="7" cy="2"   r="1.2"/>
      <circle cx="2" cy="6"   r="1.2"/><circle cx="7" cy="6"   r="1.2"/>
      <circle cx="2" cy="10"  r="1.2"/><circle cx="7" cy="10"  r="1.2"/>
    </svg>`;
    dragHandle.addEventListener('pointerdown', e => {
        e.stopPropagation();
        selectNode(id);
        initDrag(id, e);
    });
    el.appendChild(dragHandle);

    el.addEventListener('pointerdown', onNodePointerDown);
    el.addEventListener('dblclick', onNodeDblClick);

    canvasEl.appendChild(el);

    /* Arista SVG hacia el padre */
    if (parentId) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.classList.add('edge');
        path.dataset.from = parentId;
        path.dataset.to = id;
        svgEl.appendChild(path);
        edges[`${parentId}-${id}`] = path;
        updateEdge(parentId, id);
    }

    return node;
}

/* ─── Nodo de texto ──────────────────────────────────── */
function buildTextNode(el, node) {
    if (node.shape === 'root') {
        /* Aplicar forma */
        const rs = node.rootShape || currentRootShape || 'root-circle';
        node.rootShape = rs;
        el.classList.add(rs);
        currentRootShape = rs;

        /* Imagen de fondo */
        const img = document.createElement('img');
        img.className = 'root-img';
        img.draggable = false;
        if (node.imageData) { img.src = node.imageData; img.style.display = 'block'; }
        else { img.style.display = 'none'; }
        el.appendChild(img);

        /* Overlay de cambio de imagen */
        const overlay = document.createElement('div');
        overlay.className = 'root-img-overlay';
        overlay.style.display = node.imageData ? 'flex' : 'none';
        overlay.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
        </svg>
        <span>Cambiar foto</span>`;
        overlay.addEventListener('click', e => { e.stopPropagation(); triggerRootImageUpload(); });
        el.appendChild(overlay);
    }

    const lbl = document.createElement('div');
    lbl.className = 'node-label';
    lbl.textContent = node.label;
    el.appendChild(lbl);
}

/* ─── Nodo de imagen (marco) ─────────────────────────── */
function buildImageNode(el, node) {
    /* Marco con clip */
    const frame = document.createElement('div');
    frame.className = 'img-frame';

    /* Imagen real */
    const img = document.createElement('img');
    img.className = 'node-img';
    img.draggable = false;
    img.style.display = node.imageData ? 'block' : 'none';
    if (node.imageData) img.src = node.imageData;
    frame.appendChild(img);

    /* Placeholder */
    const ph = document.createElement('div');
    ph.className = 'img-placeholder';
    ph.style.display = node.imageData ? 'none' : 'flex';
    ph.innerHTML = `
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
      <rect x="3" y="3" width="18" height="18" rx="3"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
    <span>Clic para subir<br>o Ctrl+V para pegar</span>`;
    ph.addEventListener('click', e => { e.stopPropagation(); triggerImageUpload(node.id); });
    frame.appendChild(ph);

    /* Overlay de cambio (visible al hover cuando hay imagen) */
    const overlay = document.createElement('div');
    overlay.className = 'img-change-overlay';
    overlay.innerHTML = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
    <span>Cambiar imagen</span>`;
    overlay.style.display = node.imageData ? 'flex' : 'none';
    overlay.addEventListener('click', e => { e.stopPropagation(); triggerImageUpload(node.id); });
    frame.appendChild(overlay);

    /* Drag & drop de archivos sobre el marco */
    frame.addEventListener('dragover', e => {
        e.preventDefault();
        e.stopPropagation();
        frame.classList.add('drag-over');
    });
    frame.addEventListener('dragleave', () => frame.classList.remove('drag-over'));
    frame.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        frame.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) loadFileIntoNode(node.id, file);
    });

    el.appendChild(frame);

    /* Caption (etiqueta editable debajo del marco) */
    const cap = document.createElement('div');
    cap.className = 'node-caption';
    cap.textContent = node.label;
    el.appendChild(cap);
}

/* ─── Aplicar imagen a un nodo ───────────────────────── */
function applyImageToNode(id, dataUrl) {
    const node = nodes[id];
    if (!node) return;

    if (node.shape === 'root') {
        node.imageData = dataUrl;
        const el = canvasEl.querySelector('[data-id="root"]');
        if (!el) return;
        const img = el.querySelector('.root-img');
        const overlay = el.querySelector('.root-img-overlay');
        if (img) { img.src = dataUrl; img.style.display = 'block'; }
        if (overlay) { overlay.style.display = 'flex'; }
        return;
    }

    if (!isImageShape(node.shape)) return;
    node.imageData = dataUrl;

    const el = canvasEl.querySelector(`[data-id="${id}"]`);
    if (!el) return;

    const img = el.querySelector('.node-img');
    const ph = el.querySelector('.img-placeholder');
    const overlay = el.querySelector('.img-change-overlay');

    if (img) { img.src = dataUrl; img.style.display = 'block'; }
    if (ph) { ph.style.display = 'none'; }
    if (overlay) { overlay.style.display = 'flex'; }
}

function triggerRootImageUpload() {
    rootImgFileInput.value = '';
    rootImgFileInput.click();
}

rootImgFileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = ev => applyImageToNode('root', ev.target.result);
        reader.readAsDataURL(file);
        toast('🖼 Imagen colocada en el nodo central');
    }
    e.target.value = '';
});

function triggerImageUpload(nodeId) {
    pendingImageNodeId = nodeId;
    imgFileInput.value = '';
    imgFileInput.click();
}

function loadFileIntoNode(nodeId, file) {
    const reader = new FileReader();
    reader.onload = ev => applyImageToNode(nodeId, ev.target.result);
    reader.readAsDataURL(file);
}

/* ═══════════════════════════════════════════════════════
   ARISTAS SVG
═══════════════════════════════════════════════════════ */
function updateEdge(fromId, toId) {
    const key = `${fromId}-${toId}`;
    const path = edges[key];
    if (!path) return;

    const f = nodes[fromId];
    const t = nodes[toId];
    if (!f || !t) return;

    const dx = t.x - f.x;
    const cx1 = f.x + dx * 0.45;
    const cx2 = t.x - dx * 0.45;

    path.setAttribute('d', `M${f.x},${f.y} C${cx1},${f.y} ${cx2},${t.y} ${t.x},${t.y}`);
}

function updateAllEdges() {
    for (const path of Object.values(edges)) {
        updateEdge(path.dataset.from, path.dataset.to);
    }
}

/* ═══════════════════════════════════════════════════════
   AGREGAR NODO HIJO
═══════════════════════════════════════════════════════ */
function addChildNode(parentId, shape = 'circle') {
    const parent = nodes[parentId];
    if (!parent) return;

    const children = Object.values(nodes).filter(n => n.parentId === parentId);
    const count = children.length;
    const baseRadius = (parent.shape === 'root') ? 210 : 170;
    const spread = (Math.PI * 2) / (count + 1);
    const angle = -Math.PI / 2 + count * spread;

    const x = parent.x + Math.cos(angle) * baseRadius;
    const y = parent.y + Math.sin(angle) * baseRadius;

    const n = createNode({ label: isImageShape(shape) ? 'Imagen' : 'Idea', x, y, shape, parentId });
    selectNode(n.id);

    if (!isImageShape(shape)) startEditing(n.id);
    return n;
}

/* ═══════════════════════════════════════════════════════
   SELECCIÓN
═══════════════════════════════════════════════════════ */
function selectNode(id) {
    if (selectedId) {
        const prev = canvasEl.querySelector(`[data-id="${selectedId}"]`);
        if (prev) prev.classList.remove('selected');
    }

    selectedId = id;

    if (id) {
        const el = canvasEl.querySelector(`[data-id="${id}"]`);
        if (el) el.classList.add('selected');
        ctxPanel.classList.add('visible');

        /* Sincronizar botones de tamaño */
        const node = nodes[id];
        const currentSize = node ? (node.nodeSize || null) : null;
        document.querySelectorAll('.ctx-size').forEach(b => {
            b.classList.toggle('active', b.dataset.size === currentSize);
        });
    } else {
        ctxPanel.classList.remove('visible');
    }
}

/* ═══════════════════════════════════════════════════════
   EDICIÓN INLINE
═══════════════════════════════════════════════════════ */
function startEditing(id) {
    if (editingId) commitEdit(editingId);
    editingId = id;

    const node = nodes[id];
    const el = canvasEl.querySelector(`[data-id="${id}"]`);
    if (!el) return;

    if (isImageShape(node.shape)) {
        /* Editar caption */
        const cap = el.querySelector('.node-caption');
        if (!cap) return;
        cap.classList.add('editing');

        const ta = document.createElement('textarea');
        ta.className = 'caption-input';
        ta.rows = 1;
        ta.value = node.label;
        cap.textContent = '';
        cap.appendChild(ta);
        ta.focus();
        ta.select();

        ta.addEventListener('blur', () => commitEdit(id));
        ta.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(id); }
            if (e.key === 'Escape') { ta.value = node.label; commitEdit(id); }
            e.stopPropagation();
        });
    } else {
        /* Editar label interior */
        const lbl = el.querySelector('.node-label');
        if (!lbl) return;
        lbl.innerHTML = '';

        const ta = document.createElement('textarea');
        ta.className = 'node-input';
        ta.rows = 2;
        ta.value = node.label;
        ta.style.fontSize = el.classList.contains('root') ? '15px' : '13px';
        lbl.appendChild(ta);
        ta.focus();
        ta.select();

        ta.addEventListener('blur', () => commitEdit(id));
        ta.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(id); }
            if (e.key === 'Escape') { ta.value = node.label; commitEdit(id); }
            e.stopPropagation();
        });
    }
}

function commitEdit(id) {
    if (editingId !== id) return;
    editingId = null;

    const node = nodes[id];
    if (!node) return;
    const el = canvasEl.querySelector(`[data-id="${id}"]`);
    if (!el) return;

    if (isImageShape(node.shape)) {
        const cap = el.querySelector('.node-caption');
        if (!cap) return;
        const ta = cap.querySelector('.caption-input');
        if (ta) node.label = ta.value.trim() || node.label;
        cap.classList.remove('editing');
        cap.textContent = node.label;
    } else {
        const lbl = el.querySelector('.node-label');
        const ta = lbl && lbl.querySelector('.node-input');
        if (ta) node.label = ta.value.trim() || node.label;
        if (lbl) { lbl.innerHTML = ''; lbl.textContent = node.label; }
    }
}

/* ═══════════════════════════════════════════════════════
   ELIMINACIÓN
═══════════════════════════════════════════════════════ */
function deleteNode(id) {
    if (!nodes[id] || id === 'root') return;

    /* Eliminar hijos recursivamente */
    Object.values(nodes)
        .filter(n => n.parentId === id)
        .forEach(c => deleteNode(c.id));

    /* Eliminar arista */
    const pid = nodes[id].parentId;
    if (pid) {
        const key = `${pid}-${id}`;
        edges[key]?.remove();
        delete edges[key];
    }

    canvasEl.querySelector(`[data-id="${id}"]`)?.remove();
    delete nodes[id];

    if (selectedId === id) selectNode(null);
}

/* ═══════════════════════════════════════════════════════
   DRAG DE NODOS
═══════════════════════════════════════════════════════ */

/* Inicia el arrastre de un nodo desde cualquier origen (handle o cuerpo) */
function initDrag(id, e) {
    if (editingId) commitEdit(editingId);
    const node = nodes[id];
    const wp = toWorld(e.clientX, e.clientY);
    dragging = { id, ox: wp.x - node.x, oy: wp.y - node.y };

    const el = canvasEl.querySelector(`[data-id="${id}"]`);
    if (el) el.style.zIndex = 50;

    window.addEventListener('pointermove', onNodePointerMove, { passive: true });
    window.addEventListener('pointerup', onNodePointerUp);
}

/* Click sobre el cuerpo del nodo → solo seleccionar */
function onNodePointerDown(e) {
    const skip = ['add-btn', 'del-btn', 'drag-handle', 'node-input', 'caption-input', 'img-placeholder', 'img-change-overlay'];
    if (skip.some(cls => e.target.classList.contains(cls))) return;

    e.stopPropagation();
    const id = e.currentTarget.dataset.id;
    selectNode(id);
    // El arrastre solo se inicia desde el drag-handle (ver createNode)
}

function onNodePointerMove(e) {
    if (!dragging) return;
    const wp = toWorld(e.clientX, e.clientY);
    const nx = wp.x - dragging.ox;
    const ny = wp.y - dragging.oy;

    const node = nodes[dragging.id];
    node.x = nx;
    node.y = ny;

    const el = canvasEl.querySelector(`[data-id="${dragging.id}"]`);
    if (el) { el.style.left = nx + 'px'; el.style.top = ny + 'px'; }

    for (const path of Object.values(edges)) {
        const f = path.dataset.from;
        const t = path.dataset.to;
        if (f === dragging.id || t === dragging.id) updateEdge(f, t);
    }
}

function onNodePointerUp() {
    if (!dragging) return;
    const el = canvasEl.querySelector(`[data-id="${dragging.id}"]`);
    if (el) el.style.zIndex = '';
    dragging = null;
    window.removeEventListener('pointermove', onNodePointerMove);
    window.removeEventListener('pointerup', onNodePointerUp);
}

function onNodeDblClick(e) {
    e.stopPropagation();
    const id = e.currentTarget.dataset.id;
    selectNode(id);
    startEditing(id);
}

/* ═══════════════════════════════════════════════════════
   PAN + ZOOM DEL CANVAS
═══════════════════════════════════════════════════════ */
canvasWrap.addEventListener('pointerdown', e => {
    if (e.target !== canvasWrap && e.target !== canvasEl && e.target !== svgEl) return;
    if (editingId) commitEdit(editingId);
    selectNode(null);

    panDragging = true;
    panStart = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    canvasWrap.style.cursor = 'grabbing';

    window.addEventListener('pointermove', onPanMove, { passive: true });
    window.addEventListener('pointerup', onPanUp);
});

function onPanMove(e) {
    if (!panDragging) return;
    pan.x = e.clientX - panStart.x;
    pan.y = e.clientY - panStart.y;
    applyTransform();
}

function onPanUp() {
    panDragging = false;
    canvasWrap.style.cursor = '';
    window.removeEventListener('pointermove', onPanMove);
    window.removeEventListener('pointerup', onPanUp);
}

canvasWrap.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.909;
    const newScale = Math.min(3, Math.max(0.15, scale * factor));

    const rect = canvasWrap.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    pan.x = cx - (cx - pan.x) * (newScale / scale);
    pan.y = cy - (cy - pan.y) * (newScale / scale);
    scale = newScale;
    applyTransform();
}, { passive: false });

/* ═══════════════════════════════════════════════════════
   CENTRAR MAPA
═══════════════════════════════════════════════════════ */
function centerMap() {
    pan.x = window.innerWidth / 2;
    pan.y = window.innerHeight / 2;
    scale = 1;
    applyTransform();
}

/* ═══════════════════════════════════════════════════════
   EXPORTAR / IMPORTAR JSON
═══════════════════════════════════════════════════════ */
function exportJSON() {
    const isDark = htmlEl.getAttribute('data-theme') === 'dark';
    const ccs = localStorage.getItem('mindmap-custom-colors');
    const data = {
        version: 2,
        nextId,
        theme: isDark ? 'dark' : 'light',
        customColors: ccs ? JSON.parse(ccs) : null,
        nodes: Object.values(nodes)
    };
    /* Solución robusta para guardar desde local file:/// */
    const jsonStr = JSON.stringify(data, null, 2);
    const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonStr);

    const a = Object.assign(document.createElement('a'), { href: dataUrl, download: 'mindmap.json' });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    const label = isDark ? '🌙 oscuro' : '☀️ claro';
    toast(`✅ Proyecto guardado (tema ${label})`);
}

function exportPNG() {
    toast('⏳ Preparando imagen PNG...');

    // Ocultar UI que no debe salir en la foto
    document.getElementById('toolbar').style.display = 'none';
    document.getElementById('ctx-panel').classList.remove('visible');
    document.getElementById('theme-panel').classList.remove('visible');
    const oldSel = selectedId;
    if (selectedId) selectNode(null);

    // Cargar html2canvas on-demand
    if (!window.html2canvas) {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        script.onload = () => doExportPNG(oldSel);
        document.head.appendChild(script);
    } else {
        doExportPNG(oldSel);
    }
}

function doExportPNG(oldSel) {
    const wrapper = document.getElementById('canvas-wrap');
    html2canvas(wrapper, {
        backgroundColor: getComputedStyle(document.body).backgroundColor,
        scale: 2 // Alta calidad
    }).then(canvas => {
        // Restaurar UI
        document.getElementById('toolbar').style.display = '';
        if (oldSel) selectNode(oldSel);

        try {
            const dataUrl = canvas.toDataURL('image/png');
            const a = Object.assign(document.createElement('a'), { href: dataUrl, download: 'mapa-mental.png' });
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            toast('🖼 Imagen PNG exportada con éxito');
        } catch (e) {
            toast('❌ Error guardando imagen');
        }
    });
}

function importJSON(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        try {
            loadFromData(JSON.parse(ev.target.result));
            toast('✅ Mapa importado correctamente');
        } catch {
            toast('❌ Error: archivo JSON inválido');
        }
    };
    reader.readAsText(file);
    e.target.value = '';
}

function loadFromData(data) {
    canvasEl.innerHTML = '';
    svgEl.innerHTML = '';
    nodes = {};
    edges = {};
    selectedId = null;
    editingId = null;
    nextId = data.nextId || 1;

    /* Restaurar tema si está guardado en el JSON */
    if (data.theme) {
        applyTheme(data.theme === 'dark');
    }
    if (data.customColors) {
        localStorage.setItem('mindmap-custom-colors', JSON.stringify(data.customColors));
        loadCustomColors(data.customColors);
    } else {
        localStorage.removeItem('mindmap-custom-colors');
        loadCustomColors(null);
    }

    const sorted = (data.nodes || []).slice().sort((a, b) => (!a.parentId ? -1 : !b.parentId ? 1 : 0));
    for (const n of sorted) createNode(n);

    centerMap();
}

/* ═══════════════════════════════════════════════════════
   PEGAR IMAGEN DESDE PORTAPAPELES
═══════════════════════════════════════════════════════ */
document.addEventListener('paste', e => {
    if (!selectedId) return;
    const node = nodes[selectedId];
    if (!node || !isImageShape(node.shape)) return;

    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
        if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
                loadFileIntoNode(selectedId, file);
                toast('🖼 Imagen pegada correctamente');
            }
            e.preventDefault();
            break;
        }
    }
});

/* ═══════════════════════════════════════════════════════
   SUBIR IMAGEN (file input)
═══════════════════════════════════════════════════════ */
imgFileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file && pendingImageNodeId) {
        loadFileIntoNode(pendingImageNodeId, file);
        toast('🖼 Imagen cargada correctamente');
    }
    pendingImageNodeId = null;
    e.target.value = '';
});

/* ═══════════════════════════════════════════════════════
   EVENTOS DE TOOLBAR
═══════════════════════════════════════════════════════ */
function addToSelected(shape) {
    const pid = selectedId || 'root';
    if (!nodes[pid]) { toast('Selecciona un nodo primero'); return; }
    addChildNode(pid, shape);
}

document.getElementById('btn-add-circle').addEventListener('click', () => addToSelected('circle'));
document.getElementById('btn-add-rect').addEventListener('click', () => addToSelected('rect'));
document.getElementById('btn-add-img-circle').addEventListener('click', () => addToSelected('img-circle'));
document.getElementById('btn-add-img-square').addEventListener('click', () => addToSelected('img-square'));
document.getElementById('btn-add-img-rect').addEventListener('click', () => addToSelected('img-rect'));

document.getElementById('btn-center').addEventListener('click', () => { centerMap(); toast('📐 Mapa centrado'); });
document.getElementById('btn-export-png').addEventListener('click', exportPNG);
document.getElementById('btn-export-json').addEventListener('click', exportJSON);
document.getElementById('btn-import').addEventListener('click', () => jsonFileInput.click());
jsonFileInput.addEventListener('change', importJSON);

/* ─── Botón imagen en nodo raíz ──────────────────────── */
document.getElementById('btn-root-img').addEventListener('click', () => triggerRootImageUpload());

/* ─── Cambiar forma del nodo raíz ────────────────────── */
function updateRootShapeButtons(activeShape) {
    document.querySelectorAll('.tb-root-shape').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.shape === activeShape);
    });
}

function changeRootShape(newShape) {
    const rootEl = canvasEl.querySelector('[data-id="root"]');
    const rootNode = nodes['root'];
    if (!rootEl || !rootNode) return;

    /* Quitar forma anterior */
    ROOT_SHAPES.forEach(s => rootEl.classList.remove(s));

    /* Aplicar nueva forma */
    rootEl.classList.add(newShape);
    rootNode.rootShape = newShape;
    currentRootShape = newShape;
    updateRootShapeButtons(newShape);

    toast('✏️ Forma central cambiada');
}

/* Conectar botones de forma */
document.querySelectorAll('.tb-root-shape').forEach(btn => {
    btn.addEventListener('click', () => changeRootShape(btn.dataset.shape));
});

/* ─── Cambiar tamaño de nodo seleccionado ────────────── */
function changeNodeSize(size) {
    if (!selectedId || selectedId === 'root') return;
    const node = nodes[selectedId];
    const el = canvasEl.querySelector(`[data-id="${selectedId}"]`);
    if (!el || !node) return;

    /* Quitar tamaños anteriores */
    NODE_SIZES.forEach(s => el.classList.remove('size-' + s));

    /* Aplicar nuevo */
    el.classList.add('size-' + size);
    node.nodeSize = size;

    /* Actualizar botón activo en el ctx-panel */
    document.querySelectorAll('.ctx-size').forEach(b => {
        b.classList.toggle('active', b.dataset.size === size);
    });

    updateAllEdges();
}

/* ═══════════════════════════════════════════════════════
   EVENTOS DE PANEL CONTEXTUAL
═══════════════════════════════════════════════════════ */
document.getElementById('ctx-add-circle').addEventListener('click', () => { if (selectedId) addChildNode(selectedId, 'circle'); });
document.getElementById('ctx-add-rect').addEventListener('click', () => { if (selectedId) addChildNode(selectedId, 'rect'); });
document.getElementById('ctx-add-img-circle').addEventListener('click', () => { if (selectedId) addChildNode(selectedId, 'img-circle'); });
document.getElementById('ctx-add-img-square').addEventListener('click', () => { if (selectedId) addChildNode(selectedId, 'img-square'); });
document.getElementById('ctx-add-img-rect').addEventListener('click', () => { if (selectedId) addChildNode(selectedId, 'img-rect'); });
document.getElementById('ctx-delete').addEventListener('click', () => {
    if (selectedId && selectedId !== 'root') deleteNode(selectedId);
    else toast('⚠️ No se puede eliminar el nodo raíz');
});

/* Botones de tamaño */
document.querySelectorAll('.ctx-size').forEach(btn => {
    btn.addEventListener('click', () => changeNodeSize(btn.dataset.size));
});

/* ═══════════════════════════════════════════════════════
   MODO OSCURO Y COLORES PERSONALIZADOS
═══════════════════════════════════════════════════════ */
const htmlEl = document.documentElement;

function applyTheme(dark) {
    dark ? htmlEl.setAttribute('data-theme', 'dark') : htmlEl.removeAttribute('data-theme');
    localStorage.setItem('mindmap-theme', dark ? 'dark' : 'light');
}

/* Lógica de colores personalizados */
const themePanel = document.getElementById('theme-panel');

function rgb2hex(val) {
    if (!val) return '#000000';
    val = val.trim();
    if (val.startsWith('#')) return val.substring(0, 7);
    const rgb = val.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (!rgb) return val;
    const hex = x => ("0" + parseInt(x).toString(16)).slice(-2);
    return "#" + hex(rgb[1]) + hex(rgb[2]) + hex(rgb[3]);
}

function updateColorInputs() {
    const computed = getComputedStyle(htmlEl);

    const bg = rgb2hex(computed.getPropertyValue('--bg'));
    document.getElementById('color-bg').value = bg;

    const text = rgb2hex(computed.getPropertyValue('--text'));
    document.getElementById('color-text').value = text;

    const border = rgb2hex(computed.getPropertyValue('--border'));
    document.getElementById('color-border').value = border;

    const edge = rgb2hex(computed.getPropertyValue('--edge'));
    document.getElementById('color-edge').value = edge;
}

document.getElementById('btn-theme-panel').addEventListener('click', () => {
    themePanel.classList.toggle('visible');
    if (themePanel.classList.contains('visible')) updateColorInputs();
});

document.getElementById('tp-close').addEventListener('click', () => {
    themePanel.classList.remove('visible');
});

function saveCustomColors() {
    const colors = {
        bg: htmlEl.style.getPropertyValue('--bg'),
        text: htmlEl.style.getPropertyValue('--text'),
        border: htmlEl.style.getPropertyValue('--border'),
        edge: htmlEl.style.getPropertyValue('--edge'),
    };
    localStorage.setItem('mindmap-custom-colors', JSON.stringify(colors));
}

function loadCustomColors(colors) {
    if (!colors) {
        ['--bg', '--text', '--border', '--edge'].forEach(v => htmlEl.style.removeProperty(v));
        return;
    }
    if (colors.bg) htmlEl.style.setProperty('--bg', colors.bg);
    if (colors.text) htmlEl.style.setProperty('--text', colors.text);
    if (colors.border) htmlEl.style.setProperty('--border', colors.border);
    if (colors.edge) htmlEl.style.setProperty('--edge', colors.edge);
}

const colorVars = { 'color-bg': '--bg', 'color-text': '--text', 'color-border': '--border', 'color-edge': '--edge' };
Object.entries(colorVars).forEach(([id, cssVar]) => {
    document.getElementById(id).addEventListener('input', e => {
        const val = e.target.value;
        htmlEl.style.setProperty(cssVar, val);
        saveCustomColors();
    });
});

/* Construir paleta de swatches rápidos para no abrir selector de SO */
const presetPalettes = {
    'bg': ['#f5f4f2', '#ffffff', '#eef0f8', '#212128', '#0d0d10'],
    'text': ['#1a1a1a', '#444444', '#f0f0f6', '#4f46e5', '#ef4444'],
    'border': ['#b0ada8', '#a4a8c8', '#5c5c6a', '#4f46e5', '#10b981'],
    'edge': ['#8b8882', '#a4a8c8', '#7c7c92', '#8b5cf6', '#f59e0b']
};

Object.entries(presetPalettes).forEach(([key, colors]) => {
    const container = document.getElementById(`swatches-${key}`);
    const cssVar = colorVars[`color-${key}`];

    if (container) {
        colors.forEach(c => {
            const swatch = document.createElement('div');
            swatch.className = 'swatch';
            swatch.style.background = c;
            swatch.title = c;
            swatch.addEventListener('click', () => {
                htmlEl.style.setProperty(cssVar, c);
                document.getElementById(`color-${key}`).value = c;
                saveCustomColors();
            });
            container.appendChild(swatch);
        });
    }
});

document.getElementById('btn-reset-colors').addEventListener('click', () => {
    loadCustomColors(null);
    localStorage.removeItem('mindmap-custom-colors');
    themePanel.classList.remove('visible');
    toast('✅ Colores restaurados a estilos por defecto');
});

document.getElementById('btn-theme').addEventListener('click', () => {
    const isDark = htmlEl.getAttribute('data-theme') === 'dark';
    applyTheme(!isDark);

    // Al cambiar la base (claro/oscuro), resturamos los override de colores
    loadCustomColors(null);
    localStorage.removeItem('mindmap-custom-colors');
    if (themePanel.classList.contains('visible')) updateColorInputs();

    toast(isDark ? '☀️ Modo claro' : '🌙 Modo oscuro');
});

/* Restaurar preferencias guardadas al inicio */
applyTheme(localStorage.getItem('mindmap-theme') === 'dark');
try { loadCustomColors(JSON.parse(localStorage.getItem('mindmap-custom-colors'))); } catch (e) { }

/* ═══════════════════════════════════════════════════════
   ATAJOS DE TECLADO
═══════════════════════════════════════════════════════ */
window.addEventListener('keydown', e => {
    if (editingId) return; // no interceptar mientras se edita

    switch (e.key) {
        case 'Delete':
        case 'Backspace':
            if (selectedId && selectedId !== 'root') deleteNode(selectedId);
            break;
        case 'c': case 'C':
            if (selectedId) addChildNode(selectedId, 'circle');
            break;
        case 'r': case 'R':
            if (selectedId) addChildNode(selectedId, 'rect');
            break;
        case 'i': case 'I':
            if (selectedId) addChildNode(selectedId, 'img-circle');
            break;
        case 'Escape':
            selectNode(null);
            break;
        case '0':
            if (e.ctrlKey || e.metaKey) { e.preventDefault(); centerMap(); }
            break;
    }
});

/* ═══════════════════════════════════════════════════════
   GENERAR MAPA DESDE TEXTO TABULADO
═══════════════════════════════════════════════════════ */
const textModal = document.getElementById('text-modal');
const textOverlay = document.getElementById('text-modal-overlay');

document.getElementById('btn-text-to-map').addEventListener('click', () => {
    textModal.classList.add('visible');
    textOverlay.classList.add('visible');
    document.getElementById('tm-textarea').focus();
});

function closeTextModal() {
    textModal.classList.remove('visible');
    textOverlay.classList.remove('visible');
}

document.getElementById('tm-close').addEventListener('click', closeTextModal);
textOverlay.addEventListener('click', closeTextModal);

function randomPositionAround(px, py, radius) {
    const angle = Math.random() * Math.PI * 2;
    return {
        x: px + Math.round(Math.cos(angle) * radius),
        y: py + Math.round(Math.sin(angle) * (radius * 0.8)) // Óvalo un poco achatado
    };
}

document.getElementById('btn-run-text-to-map').addEventListener('click', () => {
    const textVal = document.getElementById('tm-textarea').value;
    if (!textVal.trim()) { toast('⚠️ El texto está vacío'); return; }

    // Limpiar líneas y deducir cantidad de sangría inicial
    const rawLines = textVal.split('\n');
    const lines = [];

    for (let l of rawLines) {
        if (l.trim() === '') continue; // ignorar vacías
        // contar espacios (1 tab = 4 espacios)
        let spaces = 0;
        for (let char of l) {
            if (char === ' ') spaces += 1;
            else if (char === '\t') spaces += 4;
            else break;
        }
        lines.push({
            indent: spaces,
            label: l.trim()
        });
    }

    if (lines.length === 0) return;

    const newNodes = [];
    const stack = [];
    let currentNextId = 1;

    lines.forEach((lineObj, index) => {
        const id = index === 0 ? 'root' : 'node_gen_' + currentNextId++;
        const shape = index === 0 ? 'root' : 'rect';
        let parentId = null;
        let x = 0;
        let y = 0;

        if (index === 0) {
            stack.push({ indent: lineObj.indent - 1, id: id, x: 0, y: 0 }); // Base root
        } else {
            // Eliminar de la pila los que tienen nivel o mismo nivel, para encontrar el padre 
            while (stack.length > 1 && stack[stack.length - 1].indent >= lineObj.indent) {
                stack.pop();
            }

            const parent = stack.length > 0 ? stack[stack.length - 1] : stack[0];
            parentId = parent.id;

            // Posicionar con ligera aleatoriedad alrededor del padre
            const radius = 180 + (Math.random() * 50);
            const pos = randomPositionAround(parent.x, parent.y, radius);
            x = pos.x;
            y = pos.y;

            stack.push({ indent: lineObj.indent, id: id, x: x, y: y });
        }

        newNodes.push({ id, label: lineObj.label, x, y, shape, parentId });
    });

    closeTextModal();
    // Reusamos tu propia función para cargar los nuevos datos y auto-centrar
    loadFromData({ nodes: newNodes, nextId: Date.now() });
    toast('✅ ¡Mapa Generado con Éxito!');
});

/* ═══════════════════════════════════════════════════════
   INICIALIZACIÓN
═══════════════════════════════════════════════════════ */
function init() {
    centerMap();

    createNode({
        id: 'root',
        label: 'Idea Principal',
        x: 0,
        y: 0,
        shape: 'root',
        parentId: null,
        rootShape: 'root-circle',
    });

    updateRootShapeButtons('root-circle');
    toast('🧠 ¡Bienvenido! Doble clic para editar · + para agregar nodos · Marcos de imagen con I', 4000);
}

init();
