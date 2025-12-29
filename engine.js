/**
 * Circuit Simulator Engine (MNA Based)
 * 
 * Overview:
 * Implements Modified Nodal Analysis to solve for voltages at every node
 * and currents through every branch.
 */

// --- Math Helpers ---

class Matrix {
    constructor(rows, cols) {
        this.rows = rows;
        this.cols = cols;
        this.data = Array(rows).fill().map(() => Array(cols).fill(0));
    }

    set(r, c, val) {
        if (r >= 0 && r < this.rows && c >= 0 && c < this.cols) {
            this.data[r][c] = val;
        }
    }

    get(r, c) {
        return this.data[r][c];
    }
}

// Gaussian Elimination Solver
function solveLinearSystem(A, B) {
    const n = A.rows; // Assume square A
    const x = Array(n).fill(0);
    const M = JSON.parse(JSON.stringify(A.data)); // Deep copy A
    const R = [...B]; // Copy B

    // Forward elimination
    for (let i = 0; i < n; i++) {
        // Pivot
        let maxRow = i;
        for (let k = i + 1; k < n; k++) {
            if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) {
                maxRow = k;
            }
        }

        // Swap rows
        [M[i], M[maxRow]] = [M[maxRow], M[i]];
        [R[i], R[maxRow]] = [R[maxRow], R[i]];

        // Make triangular
        if (Math.abs(M[i][i]) < 1e-10) continue; // Singular or near-singular

        for (let k = i + 1; k < n; k++) {
            const factor = M[k][i] / M[i][i];
            R[k] -= factor * R[i];
            for (let j = i; j < n; j++) {
                M[k][j] -= factor * M[i][j];
            }
        }
    }

    // Backward substitution
    for (let i = n - 1; i >= 0; i--) {
        if (Math.abs(M[i][i]) < 1e-10) continue;
        let sum = 0;
        for (let j = i + 1; j < n; j++) {
            sum += M[i][j] * x[j];
        }
        x[i] = (R[i] - sum) / M[i][i];
    }

    return x;
}

// --- Circuit Elements ---

class Node {
    constructor(id) {
        this.id = id;
        this.voltage = 0;
        this.connections = []; // Components connected to this node
        this.isGND = false; // Ground reference
    }
}

class Component {
    constructor(id, type, x, y) {
        this.id = id;
        this.type = type; // 'resistor', 'battery', 'switch', 'bulb', 'wire', 'led', 'pushbutton', 'joint', 'voltmeter', 'ammeter'
        this.x = x;
        this.y = y;
        this.rotation = 0; // 0, 1, 2, 3 (x90 degrees)
        this.nodes = [null, null]; // [NodeA, NodeB] connected to terminal 0 and 1

        // Physical properties
        this.resistance = 10; // Default Ohm
        this.voltage = 0; // Default Volts (for sources)
        this.isOpen = false; // For switches
    }
}

class CircuitEngine {
    constructor() {
        this.nodes = [];
        this.components = [];
        this.wires = []; // UI representation of wires, logically they merge nodes
        this.nodeCounter = 0;
        this.compCounter = 0;
    }

    addComponent(type, x, y) {
        const id = `comp_${this.compCounter++}`;
        const comp = new Component(id, type, x, y);

        // Initialize logic for specific types
        if (type === 'battery') {
            comp.voltage = 9;
            comp.resistance = 0.1; // small internal R
        } else if (type === 'bulb') {
            comp.resistance = 50;
        } else if (type === 'switch') {
            comp.resistance = 0.001; // closed resistance
            comp.isOpen = true; // starts open
        } else if (type === 'resistor') {
            comp.resistance = 100;
        } else if (type === 'voltmeter') {
            comp.resistance = 1e9; // "Infinite" resistance
        } else if (type === 'ammeter') {
            comp.resistance = 0.001; // "Zero" resistance
        } else if (type === 'joint') {
            comp.resistance = 0.001; // "Zero" resistance connectivity point
        } else if (type === 'led') {
            comp.resistance = 10; // Low resistance but need protection resistor usually!
        } else if (type === 'pushbutton') {
            comp.resistance = 1e9; // Starts Open
            comp.isOpen = true;
        } else if (type === 'buzzer') {
            comp.resistance = 100;
        } else if (type === 'ldr') {
            comp.resistance = 250; // Default (mid-range of 500)
            comp.lightLevel = 0.5; // 0..1
        } else if (type === 'potentiometer') {
            comp.resistance = 250; // Middle
            comp.maxResistance = 500; // Lowered from 1000 so it feels less like "Off"
            comp.wiperPos = 0.5; // 0..1
        }

        this.components.push(comp);
        return comp;
    }

    solve() {
        // Iterative Solver for Non-Linear Components (Diode/LED)
        const maxIterations = 10;

        for (let iter = 0; iter < maxIterations; iter++) {
            const activeNodes = this.nodes.filter(n => !n.isGND);
            const N = activeNodes.length;
            const M = this.components.filter(c => c.type === 'battery').length;
            const size = N + M;

            if (size === 0) return;

            const A = new Matrix(size, size);
            const Z = Array(size).fill(0);

            const nodeMap = new Map();
            activeNodes.forEach((n, i) => nodeMap.set(n.id, i));

            const getIdx = (node) => {
                if (!node) return -1;
                if (node.isGND) return -1;
                const idx = nodeMap.get(node.id);
                return idx !== undefined ? idx : -1;
            };

            // 1. Stability: Add small leakage to GND to prevent singular matrix for floating nodes
            for (let i = 0; i < N; i++) A.set(i, i, 1e-12);

            let vSourceIndex = 0;

            // --- Fill Matrix ---
            this.components.forEach(comp => {
                // Battery (Voltage Source)
                if (comp.type === 'battery') {
                    const i = getIdx(comp.nodes[0]);
                    const j = getIdx(comp.nodes[1]);
                    const row = N + vSourceIndex;

                    if (i !== -1) { A.set(row, i, 1); A.set(i, row, 1); }
                    if (j !== -1) { A.set(row, j, -1); A.set(j, row, -1); }
                    Z[row] = comp.voltage;
                    vSourceIndex++;
                    return;
                }

                // SPDT Switch
                if (comp.type === 'spdt') {
                    // Common is Node 0. Out1 is Node 1. Out2 is Node 2.
                    // If State 0 (Up/Right): Connect Common(0) - Out1(1)
                    // If State 1 (Down/Right): Connect Common(0) - Out2(2)
                    // Note: nodes array is [Common, Out1, Out2]

                    const targets = [
                        { idx: 1, closed: (comp.spdtState === 0) },
                        { idx: 2, closed: (comp.spdtState === 1) }
                    ];

                    const cIdx = getIdx(comp.nodes[0]);

                    targets.forEach(t => {
                        const R = t.closed ? 0.001 : 1e9;
                        const g = 1 / R;
                        const tIdx = getIdx(comp.nodes[t.idx]);

                        if (cIdx !== -1) A.set(cIdx, cIdx, A.get(cIdx, cIdx) + g);
                        if (tIdx !== -1) A.set(tIdx, tIdx, A.get(tIdx, tIdx) + g);
                        if (cIdx !== -1 && tIdx !== -1) {
                            A.set(cIdx, tIdx, A.get(cIdx, tIdx) - g);
                            A.set(tIdx, cIdx, A.get(tIdx, cIdx) - g);
                        }
                    });
                    return;
                }

                // Standard Resistive Components
                let R = comp.resistance;

                if (comp.type === 'switch' || comp.type === 'pushbutton') {
                    R = comp.isOpen ? 1e9 : 0.001;
                }

                if (comp.type === 'led') {
                    const v1 = comp.nodes[0] ? comp.nodes[0].voltage : 0;
                    const v2 = comp.nodes[1] ? comp.nodes[1].voltage : 0;
                    const drop = v1 - v2;
                    // Hysteresis / simple threshold
                    if (iter > 0) {
                        // User specified: 90 Ohm resistance
                        R = (drop > 0.5) ? 90 : 1e7;
                    }
                }

                if (R < 1e-6) R = 1e-6;
                const g = 1 / R;
                const n1 = comp.nodes[0];
                const n2 = comp.nodes[1];

                if (n1 || n2) {
                    const i = getIdx(n1);
                    const j = getIdx(n2);
                    if (i !== -1) A.set(i, i, A.get(i, i) + g);
                    if (j !== -1) A.set(j, j, A.get(j, j) + g);
                    if (i !== -1 && j !== -1) {
                        A.set(i, j, A.get(i, j) - g);
                        A.set(j, i, A.get(j, i) - g);
                    }
                }
            });

            // --- Solve ---
            const result = solveLinearSystem(A, Z);

            // --- Update Voltages ---
            let maxChange = 0;
            activeNodes.forEach((n, i) => {
                const diff = Math.abs(n.voltage - result[i]);
                if (diff > maxChange) maxChange = diff;
                n.voltage = result[i];
            });
            this.nodes.forEach(n => { if (n.isGND) n.voltage = 0; });

            // --- Update Currents ---
            this.components.forEach(comp => {
                const n1 = comp.nodes[0];
                const n2 = comp.nodes[1];
                const v1 = n1 ? n1.voltage : 0;
                const v2 = n2 ? n2.voltage : 0;

                if (comp.type === 'battery') {
                    let idx = 0;
                    // Find index of this battery
                    for (let c of this.components) {
                        if (c === comp) break;
                        if (c.type === 'battery') idx++;
                    }
                    comp.current = result[N + idx];
                } else if (comp.type === 'spdt') {
                    // For SPDT, current depends on active path
                    // Ideally check CURRENT through the active node to common?
                    // V = I*R -> I = V/R
                    const idx = (comp.spdtState === 0) ? 1 : 2;
                    const vTarget = comp.nodes[idx] ? comp.nodes[idx].voltage : 0;
                    const vCommon = comp.nodes[0] ? comp.nodes[0].voltage : 0;
                    comp.current = (vCommon - vTarget) / 0.001;
                } else {
                    let R = comp.resistance;
                    if (comp.type === 'switch' || comp.type === 'pushbutton') R = comp.isOpen ? 1e9 : 0.001;
                    if (comp.type === 'led') {
                        const drop = v1 - v2;
                        R = (drop > 0.5) ? 90 : 1e7;
                    }
                    comp.current = (v1 - v2) / R;
                }
            });

            if (iter > 0 && maxChange < 1e-3) break;
        }
    }

    getOrCreateNode(x, y, tolerance = 20) { }
}
