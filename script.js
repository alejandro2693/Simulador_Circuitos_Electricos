/**
 * UI & Interaction Controller
 */

// Initialize Engine
let engine = new CircuitEngine();
const canvas = document.getElementById('circuit-canvas');
const ctx = canvas.getContext('2d');
let width, height;

// Visual State
let visualWires = []; // Stores { startComp, startTerm, endComp, endTerm }
let isDragging = false;
let draggedItemType = null;
let selectedComponent = null;

// Wire Drawing State
let isDrawingWire = false;
let wireStartTerminal = null; // { component, index, x, y }
let mouseX = 0, mouseY = 0;

// Animation State
let time = 0;

// --- Initialization ---
function resizeCanvas() {
    const parent = canvas.parentElement;
    width = parent.clientWidth;
    height = parent.clientHeight;
    // Handle High DPI
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    draw();
}
window.addEventListener('resize', resizeCanvas);
setTimeout(resizeCanvas, 100);

// --- Reset Functionality ---
const resetBtn = document.getElementById('btn-reset');
if (resetBtn) resetBtn.addEventListener('click', resetSimulation);

function resetSimulation() {
    engine = new CircuitEngine();
    visualWires = [];
    selectedComponent = null;
    isDragging = false;
    isDrawingWire = false;
    updatePropertiesPanel(null);
    engine.solve(); // clear state
    draw();
}

// --- Circuit Reconstruction Logic ---
// This is critical for deletion to work correctly.
// --- Circuit Reconstruction Logic ---
// Updated to use Union-Find to ensure component node references are correct.
function rebuildCircuit() {
    // 1. Create fresh nodes for every component terminal
    let allNodes = [];
    engine.components.forEach(c => {
        const termCount = (c.type === 'spdt') ? 3 : 2;
        c.nodes = []; // Clear old refs
        for (let i = 0; i < termCount; i++) {
            const n = new Node(`n_${c.id}_${i}`);
            n.parent = n; // Init Union-Find
            c.nodes.push(n);
            allNodes.push(n);
        }
    });

    // 2. Union-Find Helpers
    const find = (n) => {
        if (n.parent !== n) n.parent = find(n.parent);
        return n.parent;
    };
    const union = (n1, n2) => {
        const root1 = find(n1);
        const root2 = find(n2);
        if (root1 !== root2) root1.parent = root2;
    };

    // 3. Apply Visual Wires -> Union connected nodes
    visualWires.forEach(w => {
        // Safe check for valid components/terminals
        if (w.startComp && w.startComp.nodes[w.startTerm] &&
            w.endComp && w.endComp.nodes[w.endTerm]) {
            union(w.startComp.nodes[w.startTerm], w.endComp.nodes[w.endTerm]);
        }
    });

    // 4. Update Component References to point to Roots
    engine.components.forEach(c => {
        for (let i = 0; i < c.nodes.length; i++) {
            c.nodes[i] = find(c.nodes[i]);
        }
    });

    // 5. Build unique engine.nodes list
    // Use Set to filter unique roots
    const uniqueNodes = new Set();
    engine.components.forEach(c => {
        c.nodes.forEach(n => uniqueNodes.add(n));
    });
    engine.nodes = Array.from(uniqueNodes);

    // Debug: Assign simple IDs
    engine.nodes.forEach((n, i) => n.id = `node_${i}`);

    // 6. Grounding
    const bat = engine.components.find(c => c.type === 'battery');
    if (bat && bat.nodes[1]) {
        bat.nodes[1].isGND = true;
    }

    engine.solve();
}


// --- Drag & Drop from Sidebar ---
// --- Drag & Drop from Sidebar ---
let activeTouchDragItem = null; // Store component type for touch drag

document.querySelectorAll('.draggable-item').forEach(item => {
    // Desktop Drag
    item.addEventListener('dragstart', (e) => {
        draggedItemType = item.dataset.type;
        e.dataTransfer.effectAllowed = 'copy';
    });

    // Mobile Touch "Drag" (Selection)
    item.addEventListener('touchstart', (e) => {
        // Prevent default only if we want to stop scroll, but here we might want scroll palette.
        // Better: Tap to select? Or Long press? 
        // Simple approach: Touch starts "drag mode". 
        // But palette needs to scroll. 
        // Let's rely on a specific logic: 
        // If user touches and HOLDS -> Drag. 
        // Or simplified: Tap item -> Select it -> Tap canvas -> Place it.
        // OR: Touch & Move IMMEDIATELY implies drag.

        // Let's try: Touch sets a global "ready to drop" state or we simulate drag.
        // Actually, common mobile pattern: Touch & Drag Ghost. 
        // To simplify: We'll set 'draggedItemType' and use the Canvas TouchEnd to drop it 
        // IF the touch started on a palette item and moved to canvas.
        // BUT 'touchmove' will be on the ITEM, which might be outside canvas.

        // Robust Mobile D&D:
        // 1. TouchStart on Item -> create absolute positioned Ghost.
        // 2. TouchMove on Window -> move Ghost.
        // 3. TouchEnd -> Check if over Canvas -> Drop.

        e.preventDefault(); // Stop scroll/zoom for now to test direct interaction
        activeTouchDragItem = item.dataset.type;

        // Create Visual Feedback (Ghost)
        // ... (Optional for MVP, let's stick to logic first)
    }, { passive: false });
});

const canvasWrapper = canvas.parentElement;

// Desktop Drop
canvasWrapper.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
});

canvasWrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    if (draggedItemType) {
        handleDrop(e.clientX, e.clientY);
    }
    draggedItemType = null;
});

// Common Drop Handler
function handleDrop(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // Add to engine list
    // Use stored type (either desktop 'draggedItemType' or mobile 'activeTouchDragItem')
    const type = draggedItemType || activeTouchDragItem;

    if (type) {
        engine.addComponent(type, x, y);
        rebuildCircuit();
        draw();
        updatePropertiesPanel(null);
    }
}

// Global Touch Move/End to handle dragging from palette to canvas
window.addEventListener('touchmove', (e) => {
    if (activeTouchDragItem) {
        e.preventDefault(); // Prevent scrolling while dragging component
        // Move ghost if we had one
    }
}, { passive: false });

window.addEventListener('touchend', (e) => {
    if (activeTouchDragItem) {
        // Check if dropped on canvas
        const touch = e.changedTouches[0];
        const elem = document.elementFromPoint(touch.clientX, touch.clientY);
        if (elem === canvas || canvas.contains(elem)) {
            handleDrop(touch.clientX, touch.clientY);
        }
        activeTouchDragItem = null;
    }
});

// --- Mouse Interaction ---



canvas.addEventListener('mousedown', (e) => {
    handlePointerDown(e.clientX, e.clientY);
});

// Touch Support: Map Touch -> Pointer Logic
canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
        e.preventDefault(); // Prevent scrolling
        const touch = e.touches[0];
        handlePointerDown(touch.clientX, touch.clientY);
    }
}, { passive: false });

function handlePointerDown(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // 1. Check for Terminal Click (Start Wire)
    const terminal = getTerminalAt(x, y);
    if (terminal) {
        isDrawingWire = true;
        wireStartTerminal = terminal;
        // Set initial mouseX/Y for immediate feedback
        mouseX = x; mouseY = y;
        return;
    }

    // 2. Check for Component Click
    const clickedComp = getComponentAt(x, y);
    if (clickedComp) {
        // Switch Toggle
        if (clickedComp.type === 'switch') {
            if (selectedComponent === clickedComp || !selectedComponent) {
                clickedComp.isOpen = !clickedComp.isOpen;
                engine.solve();
            }
        }
        // Pushbutton Press (Momentary)
        if (clickedComp.type === 'pushbutton') {
            clickedComp.isOpen = false; // Closed while pressed
            clickedComp.resistance = 0.001;
            engine.solve();
        }

        // SPDT Toggle
        if (clickedComp.type === 'spdt') {
            clickedComp.spdtState = (clickedComp.spdtState === 0) ? 1 : 0;
            engine.solve();
        }

        selectedComponent = clickedComp;
        updatePropertiesPanel(clickedComp);

        isDragging = true;
        return;
    }

    // 3. Check for Wire Click (Split Joint)
    const wireHit = getWireAt(x, y);
    if (wireHit) {
        // Split logic
        const joint = engine.addComponent('joint', x, y);

        // Remove old wire, add 2 new
        const oldW = wireHit.wire;

        visualWires.splice(wireHit.index, 1);
        visualWires.push({ startComp: oldW.startComp, startTerm: oldW.startTerm, endComp: joint, endTerm: 0 });
        visualWires.push({ startComp: joint, startTerm: 1, endComp: oldW.endComp, endTerm: oldW.endTerm });

        rebuildCircuit();

        selectedComponent = joint;
        isDragging = true;
        return;
    }

    // 4. Click Empty
    selectedComponent = null;
    updatePropertiesPanel(null);
    draw();
}


canvas.addEventListener('dblclick', (e) => {
    // Keep double click for delete wire on desktop
    handleDoubleClick(e.clientX, e.clientY);
});
// Simple pseudo-double-tap for mobile could be added, but 'Del' button exists.

function handleDoubleClick(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // Delete Wire on Double Click
    const wireHit = getWireAt(x, y);
    if (wireHit) {
        visualWires.splice(wireHit.index, 1);

        // Cleanup isolated joints
        removeOrphanedJoints();

        rebuildCircuit();
        draw();
    }
}

// --- Helper for Cleanup ---
function removeOrphanedJoints() {
    const usedComps = new Set();
    visualWires.forEach(w => {
        usedComps.add(w.startComp);
        usedComps.add(w.endComp);
    });

    // Filter out joints that are NOT in usedComps
    engine.components = engine.components.filter(c => {
        if (c.type === 'joint') {
            return usedComps.has(c);
        }
        return true;
    });
}

canvas.addEventListener('mousemove', (e) => {
    handlePointerMove(e.clientX, e.clientY);
});

canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1) {
        e.preventDefault();
        const touch = e.touches[0];
        handlePointerMove(touch.clientX, touch.clientY);
    }
}, { passive: false });

function handlePointerMove(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    mouseX = clientX - rect.left;
    mouseY = clientY - rect.top;

    // Cursor
    const terminal = getTerminalAt(mouseX, mouseY);
    const wireHit = getWireAt(mouseX, mouseY);

    if (terminal) canvas.style.cursor = 'crosshair';
    else if (getComponentAt(mouseX, mouseY)) canvas.style.cursor = 'move';
    else if (wireHit) canvas.style.cursor = 'pointer';
    else canvas.style.cursor = 'default';

    if (isDragging && selectedComponent) {
        selectedComponent.x = mouseX;
        selectedComponent.y = mouseY;
    }
    // Repaint on move usually needed for dragging or wires
    draw();
}

canvas.addEventListener('mouseup', (e) => {
    handlePointerUp(e.clientX, e.clientY);
});

canvas.addEventListener('touchend', (e) => {
    // For touchend, changedTouches has the info
    if (e.changedTouches.length > 0) {
        const touch = e.changedTouches[0];
        handlePointerUp(touch.clientX, touch.clientY);
    }
    // Prevent default mouse emulation
    e.preventDefault();
}, { passive: false });

function handlePointerUp(clientX, clientY) {
    // Pushbutton Release
    const pusbuttons = engine.components.filter(c => c.type === 'pushbutton');
    let needsSolve = false;
    pusbuttons.forEach(pb => {
        if (!pb.isOpen) {
            pb.isOpen = true;
            pb.resistance = 1e9;
            needsSolve = true;
        }
    });

    if (isDrawingWire && wireStartTerminal) {
        // Need to update MouseX/Y first?
        // handlePointerMove updates global mouseX/Y, let's assume valid from last move.
        // Or re-calc from clientX
        const rect = canvas.getBoundingClientRect();
        const mx = clientX - rect.left;
        const my = clientY - rect.top;

        const terminal = getTerminalAt(mx, my);
        if (terminal) {
            const isSameTerm = (terminal.component === wireStartTerminal.component && terminal.index === wireStartTerminal.index);
            if (!isSameTerm) {
                // Add Wire
                visualWires.push({
                    startComp: wireStartTerminal.component,
                    startTerm: wireStartTerminal.index,
                    endComp: terminal.component,
                    endTerm: terminal.index
                });
                // Rebuild to merge
                rebuildCircuit();
                needsSolve = false;
            }
        }
    }

    if (isDragging || needsSolve) {
        if (needsSolve) engine.solve();
    }

    isDragging = false;
    isDrawingWire = false;
    wireStartTerminal = null;
    draw();
}

// --- Mouse Helpers ---

function getWireAt(mx, my) {
    for (let i = 0; i < visualWires.length; i++) {
        const w = visualWires[i];
        const s = getTransformedTerminals(w.startComp);
        const e = getTransformedTerminals(w.endComp);
        const p1 = (w.startTerm === 0) ? s.t0 : s.t1;
        const p2 = (w.endTerm === 0) ? e.t0 : e.t1;

        const d = distToSegment(mx, my, p1.x, p1.y, p2.x, p2.y);
        if (d < 8) return { wire: w, index: i };
    }
    return null;
}

function distToSegment(x, y, x1, y1, x2, y2) {
    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    const dot = A * C + B * D;
    const len_sq = C * C + D * D;
    let param = -1;
    if (len_sq !== 0) param = dot / len_sq;
    let xx, yy;
    if (param < 0) { xx = x1; yy = y1; }
    else if (param > 1) { xx = x2; yy = y2; }
    else { xx = x1 + param * C; yy = y1 + param * D; }
    const dx = x - xx;
    const dy = y - yy;
    return Math.sqrt(dx * dx + dy * dy);
}

function getTransformedTerminals(comp) {
    const r = comp.rotation || 0;

    // Joint
    if (comp.type === 'joint') {
        return { t0: { x: comp.x, y: comp.y }, t1: { x: comp.x, y: comp.y } };
    }

    const rotatePoint = (p, n) => {
        for (let i = 0; i < n; i++) {
            const oldX = p.x; p.x = -p.y; p.y = oldX;
        }
        return p;
    };

    // SPDT: 3 Terminals. T0=Common(Left), T1=TopRight, T2=BottomRight
    if (comp.type === 'spdt') {
        let t0 = { x: -40, y: 0 };
        let t1 = { x: 40, y: -20 };
        let t2 = { x: 40, y: 20 };

        rotatePoint(t0, r); rotatePoint(t1, r); rotatePoint(t2, r);
        return {
            t0: { x: comp.x + t0.x, y: comp.y + t0.y },
            t1: { x: comp.x + t1.x, y: comp.y + t1.y },
            t2: { x: comp.x + t2.x, y: comp.y + t2.y }
        };
    }

    // Standard 2-Terminal
    let t0 = { x: -40, y: 0 };
    let t1 = { x: 40, y: 0 };
    rotatePoint(t0, r); rotatePoint(t1, r);
    return {
        t0: { x: comp.x + t0.x, y: comp.y + t0.y },
        t1: { x: comp.x + t1.x, y: comp.y + t1.y }
    };
}

function getTerminalAt(x, y) {
    for (let c of engine.components) {
        const terms = getTransformedTerminals(c);
        if (c.type === 'joint') {
            if (dist(x, y, terms.t0.x, terms.t0.y) < 15) return { component: c, index: 0, x: terms.t0.x, y: terms.t0.y };
        }

        if (dist(x, y, terms.t0.x, terms.t0.y) < 15) return { component: c, index: 0, x: terms.t0.x, y: terms.t0.y };
        if (dist(x, y, terms.t1.x, terms.t1.y) < 15) return { component: c, index: 1, x: terms.t1.x, y: terms.t1.y };

        // Check T2 for SPDT
        if (terms.t2 && dist(x, y, terms.t2.x, terms.t2.y) < 15) {
            return { component: c, index: 2, x: terms.t2.x, y: terms.t2.y };
        }
    }
    return null;
}

function updatePropertiesPanel(comp) {
    const panel = document.getElementById('properties-content');
    if (!panel) return;

    panel.innerHTML = '';
    if (!comp) {
        panel.innerHTML = '<p>Selecciona un componente para ver sus propiedades.</p>';
        return;
    }

    let html = `<h3>${comp.type.toUpperCase()}</h3>`;

    if (comp.type === 'battery') {
        html += `<label>Voltaje (V): <input type="number" id="prop-voltage" value="${comp.voltage}" step="0.1"></label>`;
    } else if (comp.type === 'resistor') {
        html += `<label>Resistencia (Ω): <input type="number" id="prop-resistance" value="${comp.resistance}" step="10"></label>`;
    } else if (comp.type === 'bulb') {
        html += `<p>Resistencia Nominal: ${comp.resistance}Ω</p>`;
    } else if (comp.type === 'ldr') {
        // Slider for Light Level
        // Map Light 0..100 -> Resistance 500..0
        const lightVal = 100 - (comp.resistance / 5); // 500/5 = 100
        html += `<label>Luz (%): <input type="range" id="prop-light" value="${lightVal}" min="0" max="100"></label>`;
    } else if (comp.type === 'potentiometer') {
        // Slider for Resistance
        html += `<label>Ajuste: <input type="range" id="prop-pot" value="${comp.resistance}" min="0" max="500"></label>`;
    }

    if (comp.type !== 'wire' && comp.type !== 'joint') {
        html += `<div style="margin-top:10px;">
                    <button id="btn-rotate-comp" style="margin-right:5px; background:#2196F3; color:white; border:none; padding:5px 10px; cursor:pointer;">Rotar</button>
                    <button id="btn-delete-comp" style="background:#f44336; color:white; border:none; padding:5px 10px; cursor:pointer;">Eliminar</button>
                  </div>`;
    }

    panel.innerHTML = html;

    // Event Listeners
    const inpV = document.getElementById('prop-voltage');
    if (inpV) {
        inpV.onchange = (e) => {
            comp.voltage = parseFloat(e.target.value);
            engine.solve();
            draw();
        };
    }
    const inpR = document.getElementById('prop-resistance');
    if (inpR) {
        inpR.onchange = (e) => {
            comp.resistance = parseFloat(e.target.value);
            engine.solve();
            draw();
        };
    }

    // LDR Slider
    const inpLight = document.getElementById('prop-light');
    if (inpLight) {
        inpLight.oninput = (e) => {
            const val = parseFloat(e.target.value); // 0 to 100
            // Invert: 0% Light = 500 Ohm, 100% Light = 0 Ohm
            comp.resistance = 500 - (val * 5); // 0->500, 100->0
            if (comp.resistance < 0.001) comp.resistance = 0.001;
            engine.solve();
            draw();
            // Update the text label on the PROPERTIES PANEL if it existed separately, 
            // but the text is static HTML. 
            // We'll rely on the text ON THE COMPONENT updating via draw().
        };
    }

    // Potentiometer Slider
    const inpPot = document.getElementById('prop-pot');
    if (inpPot) {
        inpPot.oninput = (e) => {
            const val = parseFloat(e.target.value);
            comp.resistance = val;
            if (comp.resistance < 0.001) comp.resistance = 0.001;
            engine.solve();
            draw();
        };
    }

    const btnRot = document.getElementById('btn-rotate-comp');
    if (btnRot) {
        btnRot.onclick = () => {
            comp.rotation = (comp.rotation || 0) + 1;
            draw();
        };
    }

    const btnDel = document.getElementById('btn-delete-comp');
    if (btnDel) {
        btnDel.onclick = () => {
            // remove comp
            engine.components = engine.components.filter(c => c !== comp);
            // remove associated wires?
            // Visual wires refer to comp
            visualWires = visualWires.filter(w => w.startComp !== comp && w.endComp !== comp);

            rebuildCircuit();
            selectedComponent = null;
            updatePropertiesPanel(null);
            draw();
        };
    }
}

function getComponentAt(x, y) {
    return engine.components.find(c => {
        if (c.type === 'joint') return dist(x, y, c.x, c.y) < 10;
        const r = c.rotation || 0;
        const w = (r % 2 === 0) ? 40 : 25;
        const h = (r % 2 === 0) ? 25 : 40;
        return Math.abs(c.x - x) < w && Math.abs(c.y - y) < h;
    });
}
function dist(x1, y1, x2, y2) { return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2); }

function mergeNodes(nodeA, nodeB) {
    if (nodeA === nodeB) return;
    engine.components.forEach(c => {
        // Replace all occurrences of nodeB with nodeA
        for (let i = 0; i < c.nodes.length; i++) {
            if (c.nodes[i] === nodeB) c.nodes[i] = nodeA;
        }
    });
    if (nodeB.isGND) nodeA.isGND = true;
    engine.nodes = engine.nodes.filter(n => n !== nodeB);
}

window.rotateSelected = () => {
    if (selectedComponent) {
        selectedComponent.rotation = (selectedComponent.rotation + 1) % 4;
        draw();
    }
};

window.deleteSelected = () => {
    if (selectedComponent) {
        engine.components = engine.components.filter(c => c !== selectedComponent);
        visualWires = visualWires.filter(w => w.startComp !== selectedComponent && w.endComp !== selectedComponent);

        selectedComponent = null;
        updatePropertiesPanel(null);
        removeOrphanedJoints();
        rebuildCircuit();
        draw();
    }
};

window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') rotateSelected();
    if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
});


// --- Rendering ---
function draw() {
    // Fill Background for JPG compatibility
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, width, height);

    // Optional: Draw Grid
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < width; x += 20) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
    for (let y = 0; y < height; y += 20) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
    ctx.stroke();
    // Grid logic can be added if needed

    // 1. Wires
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    visualWires.forEach(wire => {
        const startTerms = getTransformedTerminals(wire.startComp);
        const endTerms = getTransformedTerminals(wire.endComp);

        const getTermPos = (terms, idx) => {
            if (idx === 0) return terms.t0;
            if (idx === 1) return terms.t1;
            if (idx === 2) return terms.t2;
            return terms.t0;
        };

        let start = getTermPos(startTerms, wire.startTerm);
        let end = getTermPos(endTerms, wire.endTerm);

        ctx.strokeStyle = '#555';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();

        // Logic to determine Current Flow based on Component Topology
        // This avoids "Drawing Direction" bias and "Zero Voltage Drop" issues with ideal wires.

        // Helper to get current from a component active path
        const getCompCurrent = (comp, termIdx) => {
            if (!comp.current) return 0;
            if (comp.type === 'spdt') {
                // If Term 0 (Common), always carries current
                if (termIdx === 0) return comp.current;
                // If Active Term, carries current
                const activeIdx = (comp.spdtState === 0) ? 1 : 2;
                if (termIdx === activeIdx) return comp.current;
                return 0;
            }
            return comp.current;
        };

        // Current Sign Convention:
        // Component flows 0 -> 1 (Input -> Output).
        // If Wire Start is at 0 (Input), Flow is INTO Component. Wire Vector is AWAY from Component.
        //   -> Wire Current = -Component Current.
        // If Wire Start is at 1 (Output), Flow is OUT of Component. Wire Vector is AWAY from Component.
        //   -> Wire Current = +Component Current.

        // Calculate current contribution from Start Component
        const iStartRaw = getCompCurrent(wire.startComp, wire.startTerm);
        // Term 0 is Input (factor -1 for Start connection), others Output (factor 1)
        const startFactor = (wire.startTerm === 0) ? -1 : 1;
        const iStart = iStartRaw * startFactor;

        // Calculate current contribution from End Component
        const iEndRaw = getCompCurrent(wire.endComp, wire.endTerm);
        // For End connection:
        // If Wire End is at 0 (Input), Flow is INTO Component. Wire Vector is INTO Component.
        //   -> Wire Current = +Component Current.
        // If Wire End is at 1 (Output), Flow is OUT of Component. Wire Vector is INTO Component.
        //   -> Wire Current = -Component Current.
        const endFactor = (wire.endTerm === 0) ? 1 : -1;
        const iEnd = iEndRaw * endFactor;

        // Choose the current source with Magnitude
        // (Sometimes one end is open/floating, so we pick the valid one)
        let current = 0;
        if (Math.abs(iStart) > Math.abs(iEnd)) {
            current = iStart;
        } else {
            current = iEnd;
        }

        let flowRate = current; // Simplified for visual
        if (Math.abs(flowRate) > 1e-5) {
            const d = dist(start.x, start.y, end.x, end.y);
            // Limit speed visually
            let visualCurrent = flowRate;
            // Cap visual speed
            if (Math.abs(visualCurrent) > 0.5) visualCurrent = 0.5 * Math.sign(visualCurrent);

            const speed = visualCurrent * 100;
            const offset = (time * speed);
            ctx.fillStyle = '#FFEB3B';
            const spacing = 30;
            const count = Math.floor(d / spacing);
            for (let i = 0; i < count; i++) {
                let t = ((i * spacing) + offset) / d;
                if (speed > 0) t = t - Math.floor(t);
                else t = 1 - (Math.abs(t) - Math.floor(Math.abs(t)));
                const lx = start.x + (end.x - start.x) * t;
                const ly = start.y + (end.y - start.y) * t;
                ctx.beginPath(); ctx.arc(lx, ly, 2, 0, Math.PI * 2); ctx.fill();
            }
        }
    });

    // 2. Components
    engine.components.forEach(c => {
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate((c.rotation || 0) * Math.PI / 2);
        drawComponentBody(c);
        ctx.restore();
    });

    // 3. Drawing Wire
    if (isDrawingWire && wireStartTerminal) {
        ctx.strokeStyle = '#2196F3'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.moveTo(wireStartTerminal.x, wireStartTerminal.y);
        ctx.lineTo(mouseX, mouseY); ctx.stroke(); ctx.setLineDash([]);
    }
}

function drawComponentBody(c) {
    const isSel = (c === selectedComponent);

    // Joint
    if (c.type === 'joint') {
        ctx.fillStyle = isSel ? '#2196F3' : '#333';
        ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
        return;
    }

    // Terminals
    ctx.fillStyle = isSel ? '#2196F3' : '#333';
    ctx.beginPath(); ctx.arc(-40, 0, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(40, 0, 5, 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = '#333'; ctx.lineWidth = 2;

    if (c.type === 'battery') {
        ctx.fillStyle = '#fff'; ctx.fillRect(-20, -15, 40, 30); ctx.strokeRect(-20, -15, 40, 30);
        ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(-20, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(40, 0); ctx.stroke();
        ctx.fillStyle = 'red'; ctx.font = 'bold 16px monospace'; ctx.fillText('+', -35, -5);
        ctx.fillStyle = 'black'; ctx.fillText('-', 25, -5);
        ctx.beginPath(); ctx.moveTo(-5, -10); ctx.lineTo(-5, 10); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(5, -6); ctx.lineTo(5, 6); ctx.stroke();
        ctx.textAlign = 'center'; ctx.font = '10px sans-serif'; ctx.fillStyle = '#000'; ctx.fillText(`${c.voltage}V`, 0, 25);
    }
    else if (c.type === 'resistor') {
        ctx.fillStyle = '#EFEBE9'; ctx.fillRect(-20, -8, 40, 16); ctx.strokeRect(-20, -8, 40, 16);
        ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(-20, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(40, 0); ctx.stroke();
        ctx.fillStyle = '#f44336'; ctx.fillRect(-12, -8, 4, 16); ctx.fillStyle = '#2196F3'; ctx.fillRect(0, -8, 4, 16);
        ctx.fillStyle = '#FFC107'; ctx.fillRect(10, -8, 4, 16);
    }
    else if (c.type === 'bulb') {
        const v1 = c.nodes[0] ? c.nodes[0].voltage : 0;
        const v2 = c.nodes[1] ? c.nodes[1].voltage : 0;
        const vDrop = Math.abs(v1 - v2);

        let exploded = false;
        if (vDrop > 12) {
            c.exploded = true;
        }
        if (c.exploded) exploded = true; // Persist explosion state? User didn't specify persistent, but usually yes.
        // Actually, let's keep it simple: if condition met, show explode. If removed, unexplode? 
        // User said "explota", implying broken.
        // Previous code didn't persist 'exploded' property on object permanently unless I add it.
        // Let's use instantaneous state for now, or check if I should add `c.isBroken`.
        // For simplicity: instantaneous.
        if (vDrop > 12) exploded = true;

        if (exploded) {
            ctx.fillStyle = `rgba(255, 235, 59, 0.1)`; // Off
            ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            // X mark
            ctx.strokeStyle = 'red'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(-10, -10); ctx.lineTo(10, 10); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(10, -10); ctx.lineTo(-10, 10); ctx.stroke();
            ctx.font = '20px Arial'; ctx.fillStyle = 'red'; ctx.fillText('💥', -15, -15);
        } else {
            // Progressive Brightness 0V -> 9V
            let bright = vDrop / 9.0;
            if (bright > 1) bright = 1;
            if (bright < 0) bright = 0;

            if (bright > 0.05) { ctx.shadowColor = '#FFEB3B'; ctx.shadowBlur = bright * 50; }
            ctx.fillStyle = `rgba(255, 235, 59, ${0.1 + (bright * 0.9)})`;
            ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.shadowBlur = 0;
        }

        ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(-15, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(40, 0); ctx.stroke();

        // Filament
        if (!exploded) {
            ctx.beginPath(); ctx.moveTo(-10, -10); ctx.lineTo(10, 10); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(10, -10); ctx.lineTo(-10, 10); ctx.stroke();
        }
    }
    else if (c.type === 'switch') {
        ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(-15, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(40, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-15, 0);
        if (c.isOpen) ctx.lineTo(10, -15); else ctx.lineTo(15, 0);
        ctx.stroke();
    }
    else if (c.type === 'pushbutton') {
        ctx.fillStyle = '#ddd';
        ctx.fillRect(-15, -15, 30, 30); ctx.strokeRect(-15, -15, 30, 30);
        ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(-15, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(40, 0); ctx.stroke();

        ctx.fillStyle = c.isOpen ? '#f44336' : '#d32f2f';
        ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
        if (!c.isOpen) { ctx.strokeStyle = '#fff'; ctx.stroke(); }
    }
    else if (c.type === 'led') {
        const v1 = c.nodes[0] ? c.nodes[0].voltage : 0;
        const v2 = c.nodes[1] ? c.nodes[1].voltage : 0;
        const vDrop = v1 - v2; // Forward: Node0 -> Node1

        const I = Math.abs(c.current || 0);
        let exploded = false;

        // Explode if Current > 20mA (0.02 A)
        if (I > 0.02) {
            exploded = true;
        }

        if (exploded) {
            ctx.strokeStyle = '#000';
            ctx.beginPath(); ctx.moveTo(-10, -10); ctx.lineTo(10, 10); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(10, -10); ctx.lineTo(-10, 10); ctx.stroke();
            ctx.font = '20px Arial'; ctx.fillStyle = 'red'; ctx.fillText('💥', -10, 5);
        } else {
            // Brightness Proportional to Current (0 -> 20mA)
            let bright = I / 0.02; // 0.02A = 100%
            if (bright > 1) bright = 1;

            // Only light up if forward biased (Voltage drop positive)
            // But I is magnitude. Let's trust magnitude for brightness if conducting.
            // Check polarity? c.current sign depends on node order.
            // Ideally we check vDrop > 0 to ensure it's not reverse breakdown (though we don't simulate reverse breakdown current usually).

            if (vDrop > 0 && bright > 0.05) {
                ctx.fillStyle = `rgba(244, 67, 54, ${0.4 + bright * 0.6})`;
                ctx.shadowColor = '#F44336';
                ctx.shadowBlur = bright * 20;
            } else {
                ctx.fillStyle = '#555';
                ctx.shadowBlur = 0;
            }

            ctx.beginPath();
            ctx.moveTo(-10, -10); ctx.lineTo(-10, 10); ctx.lineTo(10, 0); ctx.fill();
            ctx.beginPath(); ctx.moveTo(10, -10); ctx.lineTo(10, 10); ctx.stroke();
            ctx.shadowBlur = 0;
        }

        ctx.strokeStyle = '#333';
        ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(-10, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(40, 0); ctx.stroke();
    }
    else if (c.type === 'voltmeter') {
        ctx.fillStyle = '#BBDEFB'; ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#0D47A1'; ctx.font = 'bold 20px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('V', 0, 0);
        ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(-18, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(40, 0); ctx.stroke();
        const val = (c.nodes[0] ? c.nodes[0].voltage : 0) - (c.nodes[1] ? c.nodes[1].voltage : 0);
        ctx.font = '12px monospace'; ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(`${val.toFixed(2)}V`, 0, 20);
    }
    else if (c.type === 'ammeter') {
        ctx.fillStyle = '#C8E6C9'; ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#1B5E20'; ctx.font = 'bold 20px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('A', 0, 0);
        ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(-18, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(40, 0); ctx.stroke();
        ctx.font = '12px monospace'; ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(`${(c.current || 0).toFixed(3)}A`, 0, 20);
    }
    else if (c.type === 'buzzer') {
        // Speaker Body
        ctx.fillStyle = '#616161';
        ctx.beginPath(); ctx.rect(-15, -15, 30, 30); ctx.fill(); ctx.stroke();
        // Cone
        ctx.beginPath(); ctx.moveTo(15, -10); ctx.lineTo(35, -25); ctx.lineTo(35, 25); ctx.lineTo(15, 10); ctx.fill(); ctx.stroke();

        // Terminals
        ctx.strokeStyle = '#333';
        ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(-15, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(40, 0); ctx.stroke();

        // Sound Waves animation
        if ((c.current && Math.abs(c.current) > 0.01)) {
            const t = Date.now() / 100 % 3;
            ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(35, 0, 10 + t * 5, -0.5, 0.5); ctx.stroke();
        }
    }
    else if (c.type === 'ldr') {
        // Resistor body
        ctx.fillStyle = '#FFF59D'; // Light yellow
        ctx.fillRect(-20, -10, 40, 20); ctx.strokeRect(-20, -10, 40, 20);

        // Terminals
        ctx.strokeStyle = '#333';
        ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(-20, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(40, 0); ctx.stroke();

        // Arrows for light
        ctx.strokeStyle = '#FFC107'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-10, -25); ctx.lineTo(0, -15); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-13, -25); ctx.lineTo(-3, -15); ctx.stroke();

        // Value text
        ctx.fillStyle = '#000'; ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(c.resistance)}Ω`, 0, 5);
    }
    else if (c.type === 'potentiometer') {
        // Resistor body
        ctx.fillStyle = '#B0BEC5';
        ctx.fillRect(-20, -10, 40, 20); ctx.strokeRect(-20, -10, 40, 20);

        // Terminals
        ctx.strokeStyle = '#333';
        ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(-20, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(40, 0); ctx.stroke();

        // Wiper symbol
        ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.moveTo(0, 15); ctx.lineTo(-5, 25); ctx.lineTo(5, 25); ctx.fill();
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(c.resistance)}Ω`, 0, 5);
    }
    else if (c.type === 'motor') {
        // Motor body
        ctx.fillStyle = '#9E9E9E'; ctx.beginPath(); ctx.arc(0, 0, 25, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(-25, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(25, 0); ctx.lineTo(40, 0); ctx.stroke();

        // Animation
        const I = c.current || 0;
        const speed = I * 0.02; // Adjusted speed (faster than 0.005, slower than 0.5)
        if (!c.angle) c.angle = 0;
        c.angle += speed;

        ctx.save();
        ctx.rotate(c.angle);
        ctx.fillStyle = '#333';
        // Blades
        ctx.beginPath(); ctx.rect(-20, -4, 40, 8); ctx.fill();
        ctx.beginPath(); ctx.rect(-4, -20, 8, 40); ctx.fill();
        ctx.restore();

        ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
    }
    else if (c.type === 'spdt') {
        // 3 Terminals: T0 (Left Common), T1 (Right Top), T2 (Right Bottom)
        // Draw T2 specifically as it's not standard
        ctx.fillStyle = isSel ? '#2196F3' : '#333';
        ctx.beginPath(); ctx.arc(40, 20, 5, 0, Math.PI * 2); ctx.fill(); // T2
        ctx.beginPath(); ctx.arc(40, -20, 5, 0, Math.PI * 2); ctx.fill(); // T1
        // Note: T0 is drawn by default standard code at (-40, 0), T1 at (40, 0)
        // But for SPDT T1 is at (40, -20). The standard code draws at (40,0). 
        // We should overwrite or hide standard terminals if they conflict, but standard draws circles at +/- 40,0.
        // Let's redraw lines.

        ctx.strokeStyle = '#333';
        ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(-10, 0); ctx.stroke(); // Common stub

        ctx.beginPath(); ctx.arc(10, 0, 3, 0, Math.PI * 2); ctx.fillStyle = '#555'; ctx.fill(); // Pivot

        // Arm
        ctx.beginPath(); ctx.moveTo(10, 0);
        if (c.spdtState === 0) ctx.lineTo(40, -20); // Connect Top
        else ctx.lineTo(40, 20); // Connect Bottom
        ctx.stroke();

        ctx.fillStyle = '#333';
        ctx.beginPath(); ctx.arc(40, -20, 3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(40, 20, 3, 0, Math.PI * 2); ctx.fill();
    }
}

// ... Properties Panel same as before
// Duplicate function deleted

// --- Loop ---
function loop() {
    time++;
    draw();
    requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// --- Help Modal Logic ---
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('help-modal');
    const btnHelp = document.getElementById('btn-help');
    const spanClose = document.querySelector('.close-btn');
    const btnCloseMain = document.getElementById('close-help-btn');

    function closeModal() {
        if (modal) modal.style.display = 'none';
    }

    if (btnHelp) {
        btnHelp.onclick = function () {
            if (modal) modal.style.display = 'block';
        }
    }

    const btnShot = document.getElementById('btn-screenshot');
    if (btnShot) {
        btnShot.onclick = () => {
            // Force a redraw to ensure background is filled
            draw();

            // Generate PNG
            const dataURL = canvas.toDataURL('image/png');

            const link = document.createElement('a');
            link.download = `circuito_${Date.now()}.png`;
            link.href = dataURL;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        };
    }

    if (spanClose) spanClose.addEventListener('click', closeModal);
    if (btnCloseMain) btnCloseMain.addEventListener('click', closeModal);

    window.onclick = function (event) {
        if (event.target == modal) {
            closeModal();
        }
    }
});
