// Utility Functions (Performance Optimization)
function throttle(func, limit) {
    let inThrottle;
    return function () {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

function debounce(func, delay) {
    let debounceTimer;
    return function () {
        const context = this;
        const args = arguments;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => func.apply(context, args), delay);
    }
}

let mathJaxQueue = Promise.resolve();
function queueTypeset(element) {
    if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
        mathJaxQueue = mathJaxQueue.then(() => {
            MathJax.typesetClear([element]);
            return MathJax.typesetPromise([element]).catch(err => console.log(err));
        });
    }
}

// ==========================================
// RANDOM UTILITY FUNCTIONS (Seeded RNG)
// ==========================================

class SeededRNG {
    constructor(seedStr) {
        let hash = 0;
        for (let i = 0; i < seedStr.length; i++) hash = (hash * 31 + seedStr.charCodeAt(i)) | 0;
        this.seed = hash || 1;
    }
    random() {
        let t = this.seed += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    shuffle(array) {
        const arr = [...array];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(this.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }
}

function pureShuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function formatChoiceExplanation(template, shuffledChoices) {
    if (!template || !template.choiceExplanations || !Array.isArray(shuffledChoices)) {
        return '';
    }
    return shuffledChoices.map((c, i) => {
        const origIdx = template.choices.indexOf(c);
        if (origIdx !== -1 && template.choiceExplanations[origIdx]) {
            const exp = template.choiceExplanations[origIdx];
            const statusTag = exp.isCorrect ? 'ถูก' : 'ผิด';
            return `- **ข้อ ${i + 1} ${statusTag}:** ${exp.text}`;
        }
        return '';
    }).filter(Boolean).join('<br>');
}

function getSeededRandomBase(questionId, seed, min, max, step = 1) {
    const seedStr = `${questionId}_${seed}`;
    const rng = new SeededRNG(seedStr);
    const steps = Math.floor((max - min) / step);
    const val = min + Math.floor(rng.random() * (steps + 1)) * step;
    return parseFloat(val.toFixed(2));
}

function cleanNum(num, decimals = 2) {
    if (num === null || num === undefined || isNaN(num)) return num;
    return parseFloat(Number(num).toFixed(decimals));
}

function getOffsetFromR(r) {
    if (!r) return 0;
    if (typeof r === 'string') {
        if (r.includes('_')) {
            const studentNum = parseInt(r.split('_')[0], 10);
            return Number.isFinite(studentNum) ? studentNum : 0;
        }
        const parsed = parseInt(r, 10);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    if (typeof r === 'number') {
        return (r % 9) + 1;
    }
    return 0;
}

function formatScientificLaTeX(num, sigDigits = 2) {
    if (num === 0) return "0";
    const absNum = Math.abs(num);
    const exponent = Math.floor(Math.log10(absNum));
    const mantissa = num / Math.pow(10, exponent);

    if (exponent >= -2 && exponent <= 3) {
        return num.toLocaleString('en-US', { maximumFractionDigits: 3 });
    }
    return `${mantissa.toFixed(sigDigits)} \\times 10^{${exponent}}`;
}

function isNumericAnswerCorrect(userAns, targetNum, relTol = 0.05, absTol = 0.05) {
    if (userAns === null || userAns === undefined) return false;
    const str = String(userAns).trim().toLowerCase();
    if (!str) return false;

    let parsed = parseFloat(str);
    if (isNaN(parsed)) {
        const sciMatch = str.match(/([+-]?\d*\.?\d+)\s*(?:x|\*|\\times)?\s*10\^?\{?([+-]?\d+)\}?/);
        if (sciMatch) {
            parsed = parseFloat(sciMatch[1]) * Math.pow(10, parseInt(sciMatch[2]));
        }
    }
    if (isNaN(parsed)) return false;

    const diff = Math.abs(parsed - targetNum);
    if (diff <= absTol) return true;
    if (Math.abs(targetNum) > 0 && (diff / Math.abs(targetNum)) <= relTol) return true;
    return false;
}

// ==========================================
// SYSTEM STATE & NAVIGATION
// ==========================================

let currentSection = 'home';
let currentPracticeTopic = '17-4-1';
let currentPracticeQuestion = null;
let practiceHistory = {};

let examSeed = null;
let examStudentInfo = {};
let currentExamQuestions = [];
let examDurationSeconds = 15 * 60;
let examTimeRemaining = 15 * 60;
let examTimerInterval = null;
let examStartTimestamp = null;
let examDeadlineTimestamp = null;
let examExitGuardEnabled = false;
let examIsActive = false;
let examSubmissionInProgress = false;

const EXAM_STATE_KEY = 'fluids_17_4_exam_state';
const HISTORY_KEY = 'fluids_17_4_question_history';

function getHistory() {
    if (typeof window === 'undefined') return [];
    try {
        const data = localStorage.getItem(HISTORY_KEY);
        return data ? JSON.parse(data) : [];
    } catch (e) {
        return [];
    }
}

function addToHistory(uniqueKey) {
    if (typeof window === 'undefined') return;
    try {
        let history = getHistory();
        history = history.filter(key => key !== uniqueKey);
        history.push(uniqueKey);
        if (history.length > 100) history = history.slice(history.length - 100);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) { }
}

function getActiveParamValues(params) {
    const values = [];
    for (const key in params) {
        if (key !== 'r' && key !== 'offset' && !key.endsWith('_base') && typeof params[key] === 'number') {
            values.push(params[key]);
        }
    }
    return values;
}

function generateUniqueKey(templateId, params) {
    const vals = getActiveParamValues(params);
    return `${templateId}_${vals.join('_')}`;
}

function hasDuplicateVariables(params) {
    const vals = getActiveParamValues(params);
    const set = new Set(vals);
    return set.size !== vals.length;
}

function showSection(sectionId) {
    if (examIsActive && sectionId !== 'exam-live' && sectionId !== 'exam-result') {
        triggerAlert("อยู่ระหว่างการสอบ", "คุณกำลังทำข้อสอบอยู่ ไม่สามารถเปลี่ยนหน้าได้", "fa-triangle-exclamation", "bg-red-100 text-red-600");
        return;
    }
    currentSection = sectionId;
    const sections = ['sec-home', 'sec-review', 'sec-practice', 'sec-exam-start', 'sec-exam-live', 'sec-exam-result'];
    sections.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (id === `sec-${sectionId}`) el.classList.remove('hidden');
            else el.classList.add('hidden');
        }
    });

    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileMenu) mobileMenu.classList.add('hidden');

    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (sectionId === 'review') {
        initCanvases();
    } else if (sectionId === 'practice') {
        startPracticeMode(currentPracticeTopic);
    }
}

function toggleMobileMenu() {
    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileMenu) mobileMenu.classList.toggle('hidden');
}

function triggerAlert(title, msg, iconClass = "fa-info", iconBg = "bg-cyan-100 text-cyan-600") {
    const modal = document.getElementById('modal-alert');
    const card = document.getElementById('modal-alert-card');
    document.getElementById('modal-alert-title').innerText = title;
    document.getElementById('modal-alert-msg').innerText = msg;
    const iconEl = document.getElementById('modal-alert-icon');
    iconEl.className = `w-16 h-16 rounded-full mx-auto flex items-center justify-center text-3xl ${iconBg}`;
    iconEl.innerHTML = `<i class="fa-solid ${iconClass}"></i>`;

    modal.classList.remove('hidden');
    setTimeout(() => { card.classList.remove('scale-95', 'opacity-0'); }, 10);
}

function closeAlertModal() {
    const modal = document.getElementById('modal-alert');
    const card = document.getElementById('modal-alert-card');
    card.classList.add('scale-95', 'opacity-0');
    setTimeout(() => { modal.classList.add('hidden'); }, 200);
}

// ==========================================
// SIMULATOR 1: CONTINUITY SIMULATION (Q = A1 v1 = A2 v2)
// ==========================================

let contParams = {
    a1: 10.0, // cm^2
    a2: 4.0,  // cm^2
    v1: 2.0,  // m/s
    particles: [],
    showStreamlines: true
};
let activeAnimFrame = null;

function switchReviewTab(tabId) {
    const tabs = ['17-4-continuity', '17-4-bernoulli', '17-4-apps'];
    tabs.forEach(t => {
        const btn = document.getElementById(`btn-tab-${t}`);
        const view = document.getElementById(`review-tab-${t}`);
        if (btn && view) {
            if (t === tabId) {
                btn.className = "flex-1 min-w-[140px] text-center py-2 text-xs md:text-sm font-bold rounded-lg transition-all duration-200 bg-white text-cyan-800 shadow-sm border border-slate-200/50";
                view.classList.remove('hidden');
            } else {
                btn.className = "flex-1 min-w-[140px] text-center py-2 text-xs md:text-sm font-bold rounded-lg transition-all duration-200 text-slate-500 hover:text-slate-800 hover:bg-slate-200/50";
                view.classList.add('hidden');
            }
        }
    });

    stopSimulations();
    if (tabId === '17-4-continuity') initContinuitySim();
    else if (tabId === '17-4-bernoulli') initBernoulliSim();
    else if (tabId === '17-4-apps') initAppsSim();

    const activeView = document.getElementById(`review-tab-${tabId}`);
    if (activeView) queueTypeset(activeView);
}

function stopSimulations() {
    if (activeAnimFrame) {
        cancelAnimationFrame(activeAnimFrame);
        activeAnimFrame = null;
    }
}

function initContinuitySim() {
    stopSimulations();
    contParams.particles = [];
    const canvas = document.getElementById('continuityCanvas');
    const w = canvas ? canvas.width : 560;
    const x1 = w * 0.07;
    const x4 = w * 0.93;
    for (let i = 0; i < 55; i++) {
        contParams.particles.push({
            x: x1 + Math.random() * (x4 - x1),
            offsetY: (Math.random() - 0.5) * 0.82
        });
    }
    updateContinuityParams();
    renderContinuityLoop();
}

function updateContinuityParams() {
    const a1El = document.getElementById('cont-a1-slider');
    const a2El = document.getElementById('cont-a2-slider');
    const v1El = document.getElementById('cont-v1-slider');
    const fluidEl = document.getElementById('cont-fluid-select');

    if (a1El) contParams.a1 = parseFloat(a1El.value);
    if (a2El) contParams.a2 = parseFloat(a2El.value);
    if (v1El) contParams.v1 = parseFloat(v1El.value);

    document.getElementById('lbl-cont-a1-val').innerText = contParams.a1.toFixed(1) + ' cm²';
    document.getElementById('lbl-cont-a2-val').innerText = contParams.a2.toFixed(1) + ' cm²';
    document.getElementById('lbl-cont-v1-val').innerText = contParams.v1.toFixed(1) + ' m/s';

    // Q1 = A1 * v1 (L/s)
    const q1_Lps = (contParams.a1 * 1e-4) * contParams.v1 * 1000;
    const v2 = (contParams.a1 * contParams.v1) / contParams.a2;
    const ratio = v2 / contParams.v1;

    document.getElementById('val-cont-q1').innerText = q1_Lps.toFixed(2) + ' L/s';
    document.getElementById('val-cont-q2').innerText = q1_Lps.toFixed(2) + ' L/s';
    document.getElementById('val-cont-v2').innerText = v2.toFixed(2) + ' m/s';
    document.getElementById('val-cont-ratio').innerText = ratio.toFixed(2) + ' เท่า';
}

function resetContinuitySim() {
    document.getElementById('cont-a1-slider').value = 10.0;
    document.getElementById('cont-a2-slider').value = 4.0;
    document.getElementById('cont-v1-slider').value = 2.0;
    updateContinuityParams();
}

function toggleParticleStream() {
    contParams.showStreamlines = !contParams.showStreamlines;
}

function renderContinuityLoop() {
    const canvas = document.getElementById('continuityCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const midY = h / 2;
    const scale = Math.min(w / 340, h / 224);
    const r1 = Math.sqrt(contParams.a1) * (6 * scale) + (15 * scale);
    const r2 = Math.sqrt(contParams.a2) * (6 * scale) + (15 * scale);

    const x1 = w * 0.07, x2 = w * 0.36, x3 = w * 0.64, x4 = w * 0.93;

    // Draw Pipe Outline
    ctx.beginPath();
    ctx.moveTo(x1, midY - r1);
    ctx.lineTo(x2, midY - r1);
    ctx.lineTo(x3, midY - r2);
    ctx.lineTo(x4, midY - r2);
    ctx.lineTo(x4, midY + r2);
    ctx.lineTo(x3, midY + r2);
    ctx.lineTo(x2, midY + r1);
    ctx.lineTo(x1, midY + r1);
    ctx.closePath();

    ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.fill();
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Draw Streamlines
    if (contParams.showStreamlines) {
        ctx.strokeStyle = 'rgba(2, 132, 199, 0.4)';
        ctx.lineWidth = 1.5;
        for (let factor of [-0.6, -0.2, 0.2, 0.6]) {
            ctx.beginPath();
            ctx.moveTo(x1, midY + r1 * factor);
            ctx.lineTo(x2, midY + r1 * factor);
            ctx.lineTo(x3, midY + r2 * factor);
            ctx.lineTo(x4, midY + r2 * factor);
            ctx.stroke();
        }
    }

    // Velocity ratio and particles update
    const v2 = (contParams.a1 * contParams.v1) / contParams.a2;

    contParams.particles.forEach(p => {
        let speed = contParams.v1;
        let currentR = r1;

        if (p.x < x2) {
            speed = contParams.v1;
            currentR = r1;
        } else if (p.x > x3) {
            speed = v2;
            currentR = r2;
        } else {
            const frac = (p.x - x2) / (x3 - x2);
            speed = contParams.v1 + frac * (v2 - contParams.v1);
            currentR = r1 + frac * (r2 - r1);
        }

        p.x += speed * 1.5 * scale;
        if (p.x > x4) p.x = x1;

        const py = midY + p.offsetY * currentR;

        ctx.fillStyle = (p.x > x2) ? '#f97316' : '#38bdf8';
        ctx.beginPath();
        ctx.arc(p.x, py, 3.5 * scale, 0, Math.PI * 2);
        ctx.fill();
    });

    // Pipe section labels
    ctx.font = 'bold 12px Prompt, sans-serif';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(`A₁ = ${contParams.a1.toFixed(1)} cm²`, x1 + 5, midY - r1 - 10);
    ctx.fillText(`v₁ = ${contParams.v1.toFixed(1)} m/s`, x1 + 5, midY + r1 + 20);

    ctx.fillStyle = '#f97316';
    ctx.fillText(`A₂ = ${contParams.a2.toFixed(1)} cm²`, x3 + 5, midY - r2 - 10);
    ctx.fillText(`v₂ = ${v2.toFixed(1)} m/s`, x3 + 5, midY + r2 + 20);

    activeAnimFrame = requestAnimationFrame(renderContinuityLoop);
}

// ==========================================
// SIMULATOR 2: BERNOULLI SIMULATION (P + 1/2 rho v^2 + rho g y = const)
// ==========================================

let bernParams = {
    p1_kpa: 200,
    v1: 2.0,
    dy: 2.0, // height diff m
    ratio: 2.0, // A1/A2
    rho: 1000 // kg/m^3
};

function initBernoulliSim() {
    stopSimulations();
    updateBernoulliParams();
    renderBernoulliLoop();
}

function updateBernoulliParams() {
    const p1El = document.getElementById('bern-p1-slider');
    const v1El = document.getElementById('bern-v1-slider');
    const yEl = document.getElementById('bern-y-slider');
    const rEl = document.getElementById('bern-ratio-slider');
    const fluidEl = document.getElementById('bern-fluid-select');

    if (p1El) bernParams.p1_kpa = parseFloat(p1El.value);
    if (v1El) bernParams.v1 = parseFloat(v1El.value);
    if (yEl) bernParams.dy = parseFloat(yEl.value);
    if (rEl) bernParams.ratio = parseFloat(rEl.value);
    if (fluidEl) bernParams.rho = parseFloat(fluidEl.value);

    document.getElementById('lbl-bern-p1-val').innerText = bernParams.p1_kpa.toFixed(0) + ' kPa';
    document.getElementById('lbl-bern-v1-val').innerText = bernParams.v1.toFixed(1) + ' m/s';
    document.getElementById('lbl-bern-y-val').innerText = (bernParams.dy >= 0 ? '+' : '') + bernParams.dy.toFixed(1) + ' m';
    document.getElementById('lbl-bern-ratio-val').innerText = bernParams.ratio.toFixed(1) + ' เท่า';

    const rho = bernParams.rho;
    const v2 = bernParams.v1 * bernParams.ratio;
    const ek1_kpa = (0.5 * rho * Math.pow(bernParams.v1, 2)) / 1000;
    const ek2_kpa = (0.5 * rho * Math.pow(v2, 2)) / 1000;
    const ep_diff_kpa = (rho * 9.8 * bernParams.dy) / 1000;

    const p2_kpa = bernParams.p1_kpa + ek1_kpa - ek2_kpa - ep_diff_kpa;

    document.getElementById('val-bern-v2').innerText = v2.toFixed(2) + ' m/s';
    document.getElementById('val-bern-p2').innerText = Math.max(0, p2_kpa).toFixed(1) + ' kPa';
    document.getElementById('val-bern-ek1').innerText = ek1_kpa.toFixed(1) + ' kPa';
    document.getElementById('val-bern-ek2').innerText = ek2_kpa.toFixed(1) + ' kPa';
}

function resetBernoulliSim() {
    document.getElementById('bern-p1-slider').value = 200;
    document.getElementById('bern-v1-slider').value = 2.0;
    document.getElementById('bern-y-slider').value = 2.0;
    document.getElementById('bern-ratio-slider').value = 2.0;
    const fEl = document.getElementById('bern-fluid-select');
    if (fEl) fEl.value = '1000';
    updateBernoulliParams();
}

function renderBernoulliLoop() {
    const canvas = document.getElementById('bernoulliCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const rho = bernParams.rho;
    const v2 = bernParams.v1 * bernParams.ratio;
    const ek1_kpa = (0.5 * rho * Math.pow(bernParams.v1, 2)) / 1000;
    const ek2_kpa = (0.5 * rho * Math.pow(v2, 2)) / 1000;
    const ep_diff_kpa = (rho * 9.8 * bernParams.dy) / 1000;
    const p2_kpa = Math.max(0, bernParams.p1_kpa + ek1_kpa - ek2_kpa - ep_diff_kpa);

    const scale = Math.min(w / 340, h / 224);

    // Draw elevated pipe centered safely within canvas bounds
    const midY = h * 0.52;
    const dy_scale = 8.5 * scale;
    const y1_pos = midY + (bernParams.dy * dy_scale * 0.5);
    const y2_pos = midY - (bernParams.dy * dy_scale * 0.5);

    const x1 = w * 0.08, x2 = w * 0.35, x3 = w * 0.65, x4 = w * 0.92;
    const r1 = 28 * scale;
    const r2 = (28 * scale) / Math.sqrt(bernParams.ratio);

    ctx.fillStyle = 'rgba(56, 189, 248, 0.3)';
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(x1, y1_pos - r1);
    ctx.lineTo(x2, y1_pos - r1);
    ctx.lineTo(x3, y2_pos - r2);
    ctx.lineTo(x4, y2_pos - r2);
    ctx.lineTo(x4, y2_pos + r2);
    ctx.lineTo(x3, y2_pos + r2);
    ctx.lineTo(x2, y1_pos + r1);
    ctx.lineTo(x1, y1_pos + r1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Draw Pressure Manometer Columns
    const h1_tube = Math.min(75 * scale, bernParams.p1_kpa * 0.22 * scale);
    const h2_tube = Math.min(75 * scale, p2_kpa * 0.22 * scale);

    const tube1_x = w * 0.21;
    const tube2_x = w * 0.78;

    // Manometer 1
    ctx.fillStyle = '#e0f2fe';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.fillRect(tube1_x - 7 * scale, y1_pos - r1 - h1_tube, 14 * scale, h1_tube);
    ctx.strokeRect(tube1_x - 7 * scale, y1_pos - r1 - h1_tube, 14 * scale, h1_tube);

    // Manometer 2
    ctx.fillRect(tube2_x - 7 * scale, y2_pos - r2 - h2_tube, 14 * scale, h2_tube);
    ctx.strokeRect(tube2_x - 7 * scale, y2_pos - r2 - h2_tube, 14 * scale, h2_tube);

    // Labels
    ctx.font = 'bold 12px Prompt, sans-serif';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(`P₁ = ${bernParams.p1_kpa.toFixed(0)} kPa`, tube1_x - 30, Math.max(16, y1_pos - r1 - h1_tube - 8));
    ctx.fillStyle = '#ea580c';
    ctx.fillText(`P₂ = ${p2_kpa.toFixed(0)} kPa`, tube2_x - 30, Math.max(16, y2_pos - r2 - h2_tube - 8));

    activeAnimFrame = requestAnimationFrame(renderBernoulliLoop);
}

// ==========================================
// SIMULATOR 3: FLUID DYNAMICS APPLICATIONS (Torricelli / Wing Lift / Atomizer)
// ==========================================

let appsParams = {
    mode: 'torricelli', // torricelli, wing, atomizer
    h_tank: 5.0,        // depth of hole m
    v_top: 60.0,        // airplane wing m/s
    v_bot: 40.0,
    air_speed: 15.0     // atomizer m/s
};

function initAppsSim() {
    stopSimulations();
    switchAppsMode();
}

function switchAppsMode() {
    const select = document.getElementById('apps-mode-select');
    if (select) appsParams.mode = select.value;

    const panel = document.getElementById('apps-control-panel');
    const title = document.getElementById('apps-output-title');
    const formulaCard = document.getElementById('apps-formula-card');

    if (appsParams.mode === 'torricelli') {
        title.innerText = 'ผลการวิเคราะห์กฎของตอร์รีเชลลี (Torricelli)';
        if (formulaCard) {
            formulaCard.innerHTML = `
                <div class="flex items-center gap-2 mb-2.5 sim-formula-title">
                    <i class="fa-solid fa-square-root-variable"></i> สมการที่เกี่ยวข้องกับ Simulator 3: กฎของตอร์รีเชลลี (Torricelli's Law)
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div class="sim-formula-item flex items-center justify-between gap-2">
                        <span class="sim-formula-label">อัตราเร็วพุ่งออกจากรู (v):</span>
                        <span class="sim-formula-math-accent text-sm md:text-base">\\( v = \\sqrt{2gh} \\)</span>
                    </div>
                    <div class="sim-formula-item flex items-center justify-between gap-2">
                        <span class="sim-formula-label">การอนุรักษ์พลังงาน:</span>
                        <span class="sim-formula-math text-xs md:text-sm">\\( mgh = \\frac{1}{2}mv^2 \\)</span>
                    </div>
                </div>
            `;
        }
        panel.innerHTML = `
            <div>
                <div class="flex items-center justify-between text-[11px] font-semibold text-slate-700 mb-1">
                    <span>ความลึกรูระบายน้ำ h:</span>
                    <span id="lbl-app-h-val" class="text-cyan-600 font-mono font-bold shrink-0 ml-1">5.0 m</span>
                </div>
                <input type="range" id="app-h-slider" min="0.5" max="15.0" step="0.5" value="5.0" oninput="updateAppsParams()"
                    class="w-full h-1.5 bg-slate-200 rounded appearance-none cursor-pointer accent-cyan-600">
            </div>
        `;
    } else if (appsParams.mode === 'wing') {
        title.innerText = 'ผลการวิเคราะห์แรงยกปีกเครื่องบิน (Airplane Wing Lift)';
        if (formulaCard) {
            formulaCard.innerHTML = `
                <div class="flex items-center gap-2 mb-2.5 sim-formula-title">
                    <i class="fa-solid fa-square-root-variable"></i> สมการที่เกี่ยวข้องกับ Simulator 3: แรงยกปีกเครื่องบิน (Wing Lift)
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div class="sim-formula-item flex flex-col justify-center gap-1">
                        <span class="sim-formula-label">ความต่างความดัน (\\(\\Delta P\\)):</span>
                        <span class="sim-formula-math-amber text-xs md:text-sm text-center">\\( \\Delta P = \\frac{1}{2}\\rho (v_{\\text{top}}^2 - v_{\\text{bottom}}^2) \\)</span>
                    </div>
                    <div class="sim-formula-item flex items-center justify-between gap-2">
                        <span class="sim-formula-label">แรงยกสุทธิ (Lift Force):</span>
                        <span class="sim-formula-math-accent text-xs md:text-sm">\\( F_{\\text{lift}} = \\Delta P \\cdot A \\)</span>
                    </div>
                </div>
            `;
        }
        panel.innerHTML = `
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <div class="flex items-center justify-between text-[11px] font-semibold text-slate-700 mb-1">
                        <span>อัตราเร็วลมด้านบน v<sub>top</sub>:</span>
                        <span id="lbl-app-vt-val" class="text-cyan-600 font-mono font-bold shrink-0 ml-1">70 m/s</span>
                    </div>
                    <input type="range" id="app-vt-slider" min="30" max="120" step="2" value="70" oninput="updateAppsParams()"
                        class="w-full h-1.5 bg-slate-200 rounded appearance-none cursor-pointer accent-cyan-600">
                </div>
                <div>
                    <div class="flex items-center justify-between text-[11px] font-semibold text-slate-700 mb-1">
                        <span>อัตราเร็วลมด้านล่าง v<sub>bot</sub>:</span>
                        <span id="lbl-app-vb-val" class="text-slate-500 font-mono font-bold shrink-0 ml-1">50 m/s</span>
                    </div>
                    <input type="range" id="app-vb-slider" min="20" max="100" step="2" value="50" oninput="updateAppsParams()"
                        class="w-full h-1.5 bg-slate-200 rounded appearance-none cursor-pointer accent-cyan-600">
                </div>
            </div>
        `;
    } else if (appsParams.mode === 'atomizer') {
        title.innerText = 'ผลการวิเคราะห์เครื่องพ่นละอองน้ำ (Atomizer Spray)';
        if (formulaCard) {
            formulaCard.innerHTML = `
                <div class="flex items-center gap-2 mb-2.5 sim-formula-title">
                    <i class="fa-solid fa-square-root-variable"></i> สมการที่เกี่ยวข้องกับ Simulator 3: เครื่องพ่นละอองน้ำ (Atomizer Spray)
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div class="sim-formula-item flex items-center justify-between gap-2">
                        <span class="sim-formula-label">ความดันลดลงปากท่อ (\\(\\Delta P\\)):</span>
                        <span class="sim-formula-math-amber text-xs md:text-sm">\\( \\Delta P = \\frac{1}{2}\\rho_{\\text{air}} v_{\\text{air}}^2 \\)</span>
                    </div>
                    <div class="sim-formula-item flex items-center justify-between gap-2">
                        <span class="sim-formula-label">ระดับน้ำที่ดูดสูงขึ้น (\\(h\\)):</span>
                        <span class="sim-formula-math-accent text-xs md:text-sm">\\( h = \\frac{\\Delta P}{\\rho_{\\text{water}} g} \\)</span>
                    </div>
                </div>
            `;
        }
        panel.innerHTML = `
            <div>
                <div class="flex items-center justify-between text-[11px] font-semibold text-slate-700 mb-1">
                    <span>อัตราเร็วลมปากท่อ v<sub>air</sub>:</span>
                    <span id="lbl-app-vair-val" class="text-cyan-600 font-mono font-bold shrink-0 ml-1">15 m/s</span>
                </div>
                <input type="range" id="app-vair-slider" min="2" max="30" step="1" value="15" oninput="updateAppsParams()"
                    class="w-full h-1.5 bg-slate-200 rounded appearance-none cursor-pointer accent-cyan-600">
            </div>
        `;
    }
    if (formulaCard) queueTypeset(formulaCard);
    updateAppsParams();
    renderAppsLoop();
}

function updateAppsParams() {
    const body = document.getElementById('apps-output-body');

    if (appsParams.mode === 'torricelli') {
        const hEl = document.getElementById('app-h-slider');
        if (hEl) appsParams.h_tank = parseFloat(hEl.value);
        document.getElementById('lbl-app-h-val').innerText = appsParams.h_tank.toFixed(1) + ' m';

        const v_exit = Math.sqrt(2 * 9.8 * appsParams.h_tank);
        body.innerHTML = `
            <div class="flex justify-between col-span-2">
                <span class="text-slate-300 font-sans">อัตราเร็วพุ่งออกจากรู v = √(2gh):</span>
                <span class="text-emerald-400 font-bold font-mono text-sm">${v_exit.toFixed(2)} m/s</span>
            </div>
            <div class="flex justify-between col-span-2">
                <span class="text-slate-300 font-sans">พลังงานศักย์โน้มถ่วงต่อมวล gh:</span>
                <span class="text-cyan-300 font-bold font-mono text-sm">${(9.8 * appsParams.h_tank).toFixed(1)} J/kg</span>
            </div>
        `;
    } else if (appsParams.mode === 'wing') {
        const vtEl = document.getElementById('app-vt-slider');
        const vbEl = document.getElementById('app-vb-slider');
        if (vtEl) appsParams.v_top = parseFloat(vtEl.value);
        if (vbEl) appsParams.v_bot = parseFloat(vbEl.value);

        document.getElementById('lbl-app-vt-val').innerText = appsParams.v_top.toFixed(0) + ' m/s';
        document.getElementById('lbl-app-vb-val').innerText = appsParams.v_bot.toFixed(0) + ' m/s';

        const rho_air = 1.2;
        const dp_pa = 0.5 * rho_air * (Math.pow(appsParams.v_top, 2) - Math.pow(appsParams.v_bot, 2));
        const wing_area = 20.0; // m^2
        const lift_n = dp_pa * wing_area;

        body.innerHTML = `
            <div class="flex justify-between col-span-2">
                <span class="text-slate-300 font-sans">ความต่างความดัน ΔP:</span>
                <span class="text-amber-300 font-bold font-mono text-sm">${dp_pa.toFixed(1)} Pa</span>
            </div>
            <div class="flex justify-between col-span-2">
                <span class="text-slate-300 font-sans">แรงยกสุทธิ (ปีก 20 m²):</span>
                <span class="text-emerald-400 font-bold font-mono text-sm">${lift_n > 0 ? lift_n.toFixed(0) : 0} N</span>
            </div>
        `;
    } else if (appsParams.mode === 'atomizer') {
        const vairEl = document.getElementById('app-vair-slider');
        if (vairEl) appsParams.air_speed = parseFloat(vairEl.value);
        document.getElementById('lbl-app-vair-val').innerText = appsParams.air_speed.toFixed(0) + ' m/s';

        const rho_air = 1.2, rho_water = 1000;
        const dp_pa = 0.5 * rho_air * Math.pow(appsParams.air_speed, 2);
        const h_rise_cm = (dp_pa / (rho_water * 9.8)) * 100;

        body.innerHTML = `
            <div class="flex justify-between col-span-2">
                <span class="text-slate-300 font-sans">ความดันลดลงปากท่อ ΔP:</span>
                <span class="text-amber-300 font-bold font-mono text-sm">${dp_pa.toFixed(1)} Pa</span>
            </div>
            <div class="flex justify-between col-span-2">
                <span class="text-slate-300 font-sans">ระดับน้ำดูดสูงขึ้นในหลอด h:</span>
                <span class="text-emerald-400 font-bold font-mono text-sm">${h_rise_cm.toFixed(2)} cm</span>
            </div>
        `;
    }
}

function resetAppsSim() {
    switchAppsMode();
}

function renderAppsLoop() {
    const canvas = document.getElementById('appsCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    const scale = Math.min(w / 340, h / 224);

    if (appsParams.mode === 'torricelli') {
        // Tank outline
        const tankW = w * 0.3;
        const tankH = 150 * scale;
        const tankX = w * 0.12;
        const tankY = 40 * scale;
        ctx.fillStyle = 'rgba(56, 189, 248, 0.3)';
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 3;
        ctx.fillRect(tankX, tankY, tankW, tankH);
        ctx.strokeRect(tankX, tankY, tankW, tankH);

        // Orifice hole
        const holeY = tankY + (appsParams.h_tank * 8 * scale);
ctx.fillStyle = '#0f172a';
        ctx.fillRect(tankX + tankW - 2, holeY - 4, 6, 8);

        // Water jet parabolic path
        const v_exit = Math.sqrt(2 * 9.8 * appsParams.h_tank);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        const startX = tankX + tankW + 4;
        ctx.moveTo(startX, holeY);
        for (let t = 0; t < 20; t += 0.4) {
            let px = startX + v_exit * t * 1.8 * scale;
            let py = holeY + 0.5 * 9.8 * t * t * 0.4 * scale;
            if (py > tankY + tankH || px > w * 0.95) break;
            ctx.lineTo(px, py);
        }
        ctx.stroke();

    } else if (appsParams.mode === 'wing') {
        // Aerofoil profile
        ctx.fillStyle = '#94a3b8';
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 2;
        const wingX = w * 0.22;
        const wingEnd = w * 0.78;
        const midX = w * 0.5;
        ctx.beginPath();
        ctx.moveTo(wingX, h / 2);
        ctx.bezierCurveTo(midX - 50 * scale, h / 2 - 45 * scale, midX + 60 * scale, h / 2 - 25 * scale, wingEnd, h / 2);
        ctx.bezierCurveTo(midX + 20 * scale, h / 2 + 12 * scale, midX - 40 * scale, h / 2 + 12 * scale, wingX, h / 2);
        ctx.fill();
        ctx.stroke();

        // Streamlines above and below
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;

        // Top fast streamline
        ctx.beginPath();
        ctx.moveTo(w * 0.08, h / 2 - 22 * scale);
        ctx.bezierCurveTo(midX - 50 * scale, h / 2 - 65 * scale, midX + 60 * scale, h / 2 - 50 * scale, w * 0.92, h / 2 - 22 * scale);
        ctx.stroke();

        // Bottom slow streamline
        ctx.beginPath();
        ctx.moveTo(w * 0.08, h / 2 + 22 * scale);
        ctx.bezierCurveTo(midX - 50 * scale, h / 2 + 28 * scale, midX + 60 * scale, h / 2 + 28 * scale, w * 0.92, h / 2 + 22 * scale);
        ctx.stroke();

        // Upward Lift Force Vector
        if (appsParams.v_top > appsParams.v_bot) {
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(midX, h / 2);
            ctx.lineTo(midX, h / 2 - 55 * scale);
            ctx.lineTo(midX - 6, h / 2 - 45 * scale);
            ctx.moveTo(midX, h / 2 - 55 * scale);
            ctx.lineTo(midX + 6, h / 2 - 45 * scale);
            ctx.stroke();
        }
    } else if (appsParams.mode === 'atomizer') {
        // Liquid container bottle
        const botW = 100 * scale, botH = 80 * scale;
        const botX = w * 0.35, botY = h - 90 * scale;
        ctx.fillStyle = 'rgba(56, 189, 248, 0.3)';
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 3;
        ctx.fillRect(botX, botY, botW, botH);
        ctx.strokeRect(botX, botY, botW, botH);

        // Vertical pipe
        const pipeX = botX + botW / 2 - 5 * scale;
        const pipeW = 10 * scale;
        const pipeY = 35 * scale;
        const pipeH = botY - pipeY + 20 * scale;
        ctx.fillStyle = '#e0f2fe';
        ctx.fillRect(pipeX, pipeY, pipeW, pipeH);
        ctx.strokeRect(pipeX, pipeY, pipeW, pipeH);

        // Liquid drawn up pipe
        const rho_air = 1.2, rho_water = 1000;
        const dp_pa = 0.5 * rho_air * Math.pow(appsParams.air_speed, 2);
        const h_rise = Math.min(pipeH - 10 * scale, (dp_pa / (rho_water * 9.8)) * 300 * scale);

        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(pipeX + 1, botY + 10 * scale - h_rise, pipeW - 2, h_rise);

        // Air jet nozzle & stream
        ctx.fillStyle = '#64748b';
        ctx.fillRect(pipeX - 70 * scale, pipeY - 5 * scale, 65 * scale, 12 * scale);
        ctx.strokeRect(pipeX - 70 * scale, pipeY - 5 * scale, 65 * scale, 12 * scale);

        ctx.strokeStyle = '#f97316';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(pipeX - 70 * scale, pipeY + 1);
        ctx.lineTo(w * 0.9, pipeY + 1);
        ctx.stroke();

        if (h_rise > 25 * scale) {
            ctx.fillStyle = '#38bdf8';
            for (let i = 0; i < 20; i++) {
                let dropX = pipeX + 10 * scale + Math.random() * (w * 0.4);
                let dropY = (pipeY + 1) + (Math.random() - 0.5) * (dropX - pipeX) * 0.4;
                ctx.beginPath();
                ctx.arc(dropX, dropY, Math.random() * 2.5 + 1, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    activeAnimFrame = requestAnimationFrame(renderAppsLoop);
}

function initCanvases() {
    requestAnimationFrame(() => {
        const cCanvas = document.getElementById('continuityCanvas');
        const bCanvas = document.getElementById('bernoulliCanvas');
        const aCanvas = document.getElementById('appsCanvas');

        if (cCanvas && cCanvas.parentElement) {
            const containerW = cCanvas.parentElement.clientWidth - 40;
            cCanvas.width = Math.max(340, containerW);
            cCanvas.height = 240;
        }
        if (bCanvas && bCanvas.parentElement) {
            const containerW = bCanvas.parentElement.clientWidth - 40;
            bCanvas.width = Math.max(340, containerW);
            bCanvas.height = 240;
        }
        if (aCanvas && aCanvas.parentElement) {
            const containerW = aCanvas.parentElement.clientWidth - 40;
            aCanvas.width = Math.max(340, containerW);
            aCanvas.height = 240;
        }

        stopSimulations();

        if (currentSection === 'review') {
            const btnC = document.getElementById('btn-tab-17-4-continuity');
            const btnB = document.getElementById('btn-tab-17-4-bernoulli');
            const activeTab = (btnC && btnC.classList.contains('bg-white'))
                ? '17-4-continuity'
                : ((btnB && btnB.classList.contains('bg-white')) ? '17-4-bernoulli' : '17-4-apps');

            if (activeTab === '17-4-continuity') initContinuitySim();
            else if (activeTab === '17-4-bernoulli') initBernoulliSim();
            else initAppsSim();
        }
    });
}

// ==========================================
// DYNAMIC QUESTION TEMPLATES (17.4 Fluid Dynamics)
// ==========================================

const QUESTION_TEMPLATES = [
    // 17.4.1 ของไหลอุดมคติและอัตราการไหล (Ideal Fluid & Flow Rate Q = Av)
    {
        id: '17_4_1_flow_rate', topic: '17.4.1', type: 'numeric_single',
        title: 'อัตราการไหลผ่านท่อประปา',
        inputs: [{ label: 'อัตราการไหล \\( Q \\) \\( (\\text{L/s}) \\):' }],
        text: (p) => {
            const r_cm = cleanNum(p.r_cm, 2);
            const v_base = cleanNum(p.v_base, 2);
            const offset_v = cleanNum(p.r * 0.1, 2);
            const v = cleanNum(p.v, 2);
            return `น้ำไหลผ่านท่อทรงกลมที่มีรัศมีพื้นที่หน้าตัด \\( ${r_cm} \\text{ cm} \\) ด้วยอัตราเร็วคงตัว \\( ${p.r ? `(${v_base} + \ ${offset_v})` : v} \\text{ m/s} \\) จงคำนวณหาอัตราการไหลของน้ำผ่านท่อนั้นในหน่วยลิตรต่อวินาที (L/s)`;
        },
        generate: (seed) => {
            const offset = getOffsetFromR(seed);
            const r_cm = seed ? getSeededRandomBase('17_4_1_q_r', seed, 2.0, 8.0, 0.5) : 5.0;
            const v_base = seed ? getSeededRandomBase('17_4_1_q_v', seed, 1.0, 4.0, 0.2) : 2.0;
            const v = seed ? parseFloat((v_base + offset * 0.1).toFixed(2)) : 2.0;

            const r_m = r_cm / 100;
            const area = Math.PI * Math.pow(r_m, 2);
            const q_m3ps = area * v;
            const q_lps = q_m3ps * 1000;

            return {
                params: { r_cm, v, v_base, r: offset },
                answers: [q_lps.toFixed(2)],
                answersRaw: [q_lps],
                explanation: () => `
          จากสูตรอัตราการไหล: \\( Q = A \\cdot v = (\\pi r^2) \\cdot v \\)<br>
          - รัศมี \\( r = ${r_cm.toFixed(2)} \\text{ cm} = ${r_m.toFixed(4)} \\text{ m} \\)<br>
          - พื้นที่หน้าตัด \\( A = \\pi \\cdot (${r_m.toFixed(4)})^2 = ${area.toFixed(4)} \\text{ m}^2 \\)<br>
          - อัตราเร็ว \\( v = ${v.toFixed(2)} \\text{ m/s} \\)<br>
          แทนค่าคำนวณ:<br>
          \\( Q = ${area.toFixed(4)} \\cdot ${v.toFixed(2)} = ${q_m3ps.toFixed(4)} \\text{ m}^3/\\text{s} \\)<br>
          แปลงเป็นหน่วยลิตรต่อวินาที (คูณ 1000):<br>
          \\( Q = ${q_lps.toFixed(2)} \\text{ L/s} \\)
        `
            };
        }
    },
    {
        id: '17_4_1_volume_delivered', topic: '17.4.1', type: 'numeric_single',
        title: 'ปริมาตรน้ำที่ไหลออกจากก๊อกน้ำ',
        inputs: [{ label: 'ปริมาตรน้ำรวม \\( (\\text{m}^3) \\):' }],
        text: (p) => {
            const a = cleanNum(p.area_cm2, 2);
            const v_base = cleanNum(p.v_base, 2);
            const offset_v = cleanNum(p.r * 0.2, 2);
            const v = cleanNum(p.v, 2);
            return `ก๊อกน้ำฉีดรดน้ำต้นไม้มีพื้นที่หน้าตัด \\( ${a} \\text{ cm}^2 \\) ปล่อยให้น้ำไหลด้วยอัตราเร็วคงที่ \\( ${p.r ? `(${v_base} + \ ${offset_v})` : v} \\text{ m/s} \\) เปิดทิ้งไว้เป็นเวลา \\( ${p.time_min} \\text{ นาที} \\) จงหาปริมาตรน้ำทั้งหมดที่ไหลออกมาในหน่วยลูกบาศก์เมตร (m³)`;
        },
        generate: (seed) => {
            const offset = getOffsetFromR(seed);
            const area_cm2 = seed ? getSeededRandomBase('17_4_1_vol_a', seed, 2.0, 10.0, 1.0) : 4.0;
            const v_base = seed ? getSeededRandomBase('17_4_1_vol_v', seed, 1.5, 3.5, 0.5) : 2.0;
            const v = seed ? parseFloat((v_base + offset * 0.2).toFixed(2)) : 2.0;
            const time_min = seed ? getSeededRandomBase('17_4_1_vol_t', seed, 5, 20, 5) : 10;

            const area_m2 = area_cm2 * 1e-4;
            const time_sec = time_min * 60;
            const q = area_m2 * v;
            const vol = q * time_sec;

            return {
                params: { area_cm2, v, time_min, v_base, r: offset },
                answers: [vol.toFixed(2)],
                answersRaw: [vol],
                explanation: () => `
          1. คำนวณอัตราการไหล \\( Q = A \\cdot v = (${area_cm2.toFixed(2)} \\times 10^{-4} \\text{ m}^2) \\cdot (${v.toFixed(2)} \\text{ m/s}) = ${q.toFixed(4)} \\text{ m}^3/\\text{s} \\)<br>
          2. ปริมาตรรวม \\( \\Delta V = Q \\cdot \\Delta t = (${q.toFixed(4)}) \\cdot (${time_min} \\cdot 60 \\text{ s}) = ${vol.toFixed(2)} \\text{ m}^3 \\)
        `
            };
        }
    },
    {
        id: '17_4_1_ideal_concept', topic: '17.4.1', type: 'choice',
        title: 'มโนทัศน์สมบัติ 4 ประการของของไหลอุดมคติ',
        choices: [
            'ของไหลมีการไหลอย่างสม่ำเสมอ ไม่สามารถอัดตัวได้ ไม่มีแรงหนืด และไหลโดยไม่หมุน',
            'ของไหลอุดมคติต้องมีความหนืดสูงมากเพื่อต้านทานการหมุนของอนุภาค',
            'ความหนาแน่นของของไหลอุดมคติจะเปลี่ยนแปลงไปตามความดันและอัตราเร็วของการไหล',
            'อัตราเร็วอนุภาคของไหล ณ จุดเดียวกันจะมีค่าเปลี่ยนแปลงขึ้นลงตามเวลาตลอดเวลา'
        ],
        choiceExplanations: [
            { isCorrect: true, text: 'เป็นสมบัติพื้นฐาน 4 ประการของของไหลอุดมคติ (Ideal Fluid) ตามหนังสือเรียน สสวท.' },
            { isCorrect: false, text: 'ของไหลอุดมคติถือว่าไม่มีความหนืด (Non-viscous) เพื่อตัดแรงต้านเสียดทาน' },
            { isCorrect: false, text: 'ของไหลอุดมคติไม่สามารถอัดตัวได้ (Incompressible) ความหนาแน่นจึงคงตัวตลอด' },
            { isCorrect: false, text: 'การไหลอย่างสม่ำเสมอ (Steady flow) ความเร็ว ณ จุดใดๆ ต้องคงตัวไม่เปลี่ยนตามเวลา' }
        ],
        text: () => `ข้อความใดระบุสมบัติของของไหลอุดมคติ (Ideal Fluid) ตามหลักฟิสิกส์ สสวท. ได้ถูกต้องที่สุด`,
        generate: (seed) => ({
            params: {},
            answers: ['ของไหลมีการไหลอย่างสม่ำเสมอ ไม่สามารถอัดตัวได้ ไม่มีแรงหนืด และไหลโดยไม่หมุน'],
            answersRaw: [0],
            explanation: (shuffled) => formatChoiceExplanation(QUESTION_TEMPLATES.find(q => q.id === '17_4_1_ideal_concept'), shuffled)
        })
    },

    // 17.4.2 สมการความต่อเนื่อง (Continuity Equation A1 v1 = A2 v2)
    {
        id: '17_4_2_continuity_v2', topic: '17.4.2', type: 'numeric_single',
        title: 'อัตราเร็วของไหลเมื่อท่อลดขนาด',
        inputs: [{ label: 'อัตราเร็วทางออก \\( v_2 \\) \\( (\\text{m/s}) \\):' }],
        text: (p) => {
            const a1 = cleanNum(p.a1, 2);
            const a2 = cleanNum(p.a2, 2);
            const v1_base = cleanNum(p.v1_base, 2);
            const offset_v = cleanNum(p.r * 0.1, 2);
            const v1 = cleanNum(p.v1, 2);
            return `ท่อส่งน้ำท่อหนึ่งมีพื้นที่หน้าตัดทางเข้า \\( ${a1} \\text{ cm}^2 \\) น้ำไหลด้วยอัตราเร็ว \\( ${p.r ? `(${v1_base} + \ ${offset_v})` : v1} \\text{ m/s} \\) ต่อมาท่อคอดลดขนาดพื้นที่หน้าตัดเหลือเพียง \\( ${a2} \\text{ cm}^2 \\) จงหาอัตราเร็วของน้ำในบริเวณท่อคอดนี้`;
        },
        generate: (seed) => {
            const offset = getOffsetFromR(seed);
            const a1 = seed ? getSeededRandomBase('17_4_2_v2_a1', seed, 12.0, 24.0, 2.0) : 16.0;
            const a2 = seed ? getSeededRandomBase('17_4_2_v2_a2', seed, 3.0, 8.0, 1.0) : 4.0;
            const v1_base = seed ? getSeededRandomBase('17_4_2_v2_v1', seed, 1.0, 3.0, 0.2) : 1.5;
            const v1 = seed ? parseFloat((v1_base + offset * 0.1).toFixed(2)) : 1.5;

            const v2 = (a1 * v1) / a2;

            return {
                params: { a1, a2, v1, v1_base, r: offset },
                answers: [v2.toFixed(2)],
                answersRaw: [v2],
                explanation: () => `
          จากสมการความต่อเนื่อง: \\( A_1 v_1 = A_2 v_2 \\)<br>
          จัดรูปหาอัตราเร็ว \\( v_2 = \\frac{A_1 \\cdot v_1}{A_2} \\)<br>
          แทนค่าคำนวณ:<br>
          \\( v_2 = \\frac{(${a1.toFixed(2)}) \\cdot (${v1.toFixed(2)})}{${a2.toFixed(2)}} = ${v2.toFixed(2)} \\text{ m/s} \\)
        `
            };
        }
    },
    {
        id: '17_4_2_continuity_diameter', topic: '17.4.2', type: 'numeric_single',
        title: 'การเปลี่ยนเส้นผ่านศูนย์กลางท่อ',
        inputs: [{ label: 'อัตราเร็วช่วงท่อเล็ก \\( v_2 \\) \\( (\\text{m/s}) \\):' }],
        text: (p) => {
            const d1 = cleanNum(p.d1, 2);
            const d2 = cleanNum(p.d2, 2);
            const v1 = cleanNum(p.v1, 2);
            return `ท่อทรงกลมเส้นผ่านศูนย์กลาง \\( D_1 = ${d1} \\text{ cm} \\) มีน้ำไหลด้วยอัตราเร็ว \\( ${v1} \\text{ m/s} \\) เชื่อมต่อเข้ากับท่อเส้นผ่านศูนย์กลางลดลงเหลือ \\( D_2 = ${d2} \\text{ cm} \\) จงคำนวณหาอัตราเร็วของน้ำในท่อส่วนที่สอง`;
        },
        generate: (seed) => {
            const offset = getOffsetFromR(seed);
            const d1 = seed ? getSeededRandomBase('17_4_2_d1', seed, 6.0, 12.0, 1.0) : 8.0;
            const d2 = seed ? getSeededRandomBase('17_4_2_d2', seed, 2.0, 4.0, 1.0) : 4.0;
            const v1 = seed ? getSeededRandomBase('17_4_2_dv1', seed, 1.0, 3.0, 0.5) : 2.0;

            const v2 = v1 * Math.pow(d1 / d2, 2);

            return {
                params: { d1, d2, v1, r: offset },
                answers: [v2.toFixed(2)],
                answersRaw: [v2],
                explanation: () => `
          จากสมการความต่อเนื่อง: \\( A_1 v_1 = A_2 v_2 \\)<br>
          เนื่องจากพื้นที่หน้าตัดวงกลมแปรผันตามเส้นผ่านศูนย์กลางยกกำลังสอง \\( A \\propto D^2 \\):<br>
          \\( v_2 = v_1 \\cdot \\left( \\frac{D_1}{D_2} \\right)^2 = ${v1.toFixed(2)} \\cdot \\left( \\frac{${d1.toFixed(2)}}{${d2.toFixed(2)}} \\right)^2 = ${v1.toFixed(2)} \\cdot (${(d1 / d2).toFixed(2)})^2 = ${v2.toFixed(2)} \\text{ m/s} \\)
        `
            };
        }
    },
    {
        id: '17_4_2_continuity_concept', topic: '17.4.2', type: 'choice',
        title: 'แนวคิดสมการความต่อเนื่อง',
        choices: [
            'เมื่อของไหลไหลผ่านบริเวณที่มีพื้นที่หน้าตัดเล็กลง อัตราเร็วการไหลจะเพิ่มขึ้นเพื่อรักษาอัตราการไหลคงตัว',
            'อัตราการไหลจะเพิ่มขึ้นเป็นสองเท่าทันทีเมื่อพื้นที่หน้าตัดท่อลดลงครึ่งหนึ่ง',
            'สมการความต่อเนื่องมาจากกฎการอนุรักษ์โมเมนตัมของของไหลอุดมคติ',
            'อัตราเร็วของไหล ณ บริเวณท่อกว้างจะสูงกว่าบริเวณท่อแคบเนื่องจากแรงดันน้ำอัดดัน'
        ],
        choiceExplanations: [
            { isCorrect: true, text: 'ตามสมการความต่อเนื่อง A1 v1 = A2 v2 = Q (const) เมื่อ A ลดลง v ต้องเพิ่มขึ้น' },
            { isCorrect: false, text: 'อัตราการไหล Q ต้องคงตัวเสมอไม่เปลี่ยนตามขนาดท่อ' },
            { isCorrect: false, text: 'สมการความต่อเนื่องมาจากกฎการอนุรักษ์มวล (Conservation of Mass)' },
            { isCorrect: false, text: 'บริเวณท่อกว้างมีพื้นที่มาก อัตราเร็วจะต่ำกว่าบริเวณท่อแคบ' }
        ],
        text: () => `จากการศึกษาเรื่องสมการความต่อเนื่อง (Continuity Equation) ข้อความใดถูกต้องที่สุด`,
        generate: (seed) => ({
            params: {},
            answers: ['เมื่อของไหลไหลผ่านบริเวณที่มีพื้นที่หน้าตัดเล็กลง อัตราเร็วการไหลจะเพิ่มขึ้นเพื่อรักษาอัตราการไหลคงตัว'],
            answersRaw: [0],
            explanation: (shuffled) => formatChoiceExplanation(QUESTION_TEMPLATES.find(q => q.id === '17_4_2_continuity_concept'), shuffled)
        })
    },

    // 17.4.3 สมการแบร์นูลลีและการประยุกต์ (Bernoulli Equation & Applications)
    {
        id: '17_4_3_bernoulli_p2', topic: '17.4.3', type: 'numeric_single',
        title: 'คำนวณความดันในท่อตามสมการแบร์นูลลี',
        inputs: [{ label: 'ความดัน ณ ท่อส่วนคอด \\( P_2 \\) \\( (\\text{kPa}) \\):' }],
        text: (p) => {
            const p1 = cleanNum(p.p1_kpa, 2);
            const v1 = cleanNum(p.v1, 2);
            const v2_base = cleanNum(p.v2_base, 2);
            const offset_v = cleanNum(p.r * 0.5, 2);
            const v2 = cleanNum(p.v2, 2);
            return `น้ำความหนาแน่น \\( 1000 \\text{ kg/m}^3 \\) ไหลในท่อแนวราบ บริเวณแรกพื้นที่หน้าตัดใหญ่มีความดันเกจ \\( ${p1} \\text{ kPa} \\) อัตราเร็ว \\( ${v1} \\text{ m/s} \\) ต่อมาท่อคอดลงทำให้อัตราเร็วเพิ่มขึ้นเป็น \\( ${p.r ? `(${v2_base} + \ ${offset_v})` : v2} \\text{ m/s} \\) จงหาความดันเกจ ณ บริเวณท่อคอดนี้ในหน่วย kPa`;
        },
        generate: (seed) => {
            const offset = getOffsetFromR(seed);
            const p1_kpa = seed ? getSeededRandomBase('17_4_3_p1', seed, 150, 300, 10) : 200;
            const v1 = seed ? getSeededRandomBase('17_4_3_bv1', seed, 1.0, 3.0, 0.5) : 2.0;
            const v2_base = seed ? getSeededRandomBase('17_4_3_bv2', seed, 4.0, 8.0, 0.5) : 6.0;
            const v2 = seed ? parseFloat((v2_base + offset * 0.5).toFixed(2)) : 6.0;

            const p1_pa = p1_kpa * 1000;
            const rho = 1000;
            const p2_pa = p1_pa + 0.5 * rho * (Math.pow(v1, 2) - Math.pow(v2, 2));
            const p2_kpa = p2_pa / 1000;

            return {
                params: { p1_kpa, v1, v2, v2_base, r: offset },
                answers: [p2_kpa.toFixed(2)],
                answersRaw: [p2_kpa],
                explanation: () => `
          จากสมการแบร์นูลลีในท่อแนวราบ (\\(y_1 = y_2\\)):<br>
          \\( P_1 + \\frac{1}{2}\\rho v_1^2 = P_2 + \\frac{1}{2}\\rho v_2^2 \\)<br>
          \\( P_2 = P_1 + \\frac{1}{2}\\rho (v_1^2 - v_2^2) \\)<br>
          แทนค่า:<br>
          \\( P_2 = ${p1_pa.toFixed(0)} + \\frac{1}{2}(1000) \\cdot ((${v1.toFixed(2)})^2 - (${v2.toFixed(2)})^2) = ${p1_pa.toFixed(0)} + 500 \\cdot (${(Math.pow(v1, 2) - Math.pow(v2, 2)).toFixed(2)}) = ${p2_pa.toFixed(2)} \\text{ Pa} \\)<br>
          คิดเป็นหน่วย kPa: \\( P_2 = ${p2_kpa.toFixed(2)} \\text{ kPa} \\)
        `
            };
        }
    },
    {
        id: '17_4_3_torricelli_speed', topic: '17.4.3', type: 'numeric_single',
        title: 'อัตราเร็วของเหลวออกจากรูข้างภาชนะ (กฎของตอร์รีเชลลี)',
        inputs: [{ label: 'อัตราเร็วพุ่งออกจากรู \\( v \\) \\( (\\text{m/s}) \\):' }],
        text: (p) => {
            const h_base = cleanNum(p.h_base, 2);
            const offset_h = cleanNum(p.r * 0.2, 2);
            const h = cleanNum(p.h, 2);
            return `ถังเก็บน้ำขนาดใหญ่เจาะรูเปิดขนาดเล็กไว้ด้านข้างใต้อยู่ลึกลงมาจากผิวน้ำเป็นระยะทาง \\( ${p.r ? `(${h_base} + \ ${offset_h})` : h} \\text{ m} \\) จงหาอัตราเร็วของน้ำที่พุ่งออกจากรูข้างถัง (กำหนด \\( g = 9.8 \\text{ m/s}^2 \\))`;
        },
        generate: (seed) => {
            const offset = getOffsetFromR(seed);
            const h_base = seed ? getSeededRandomBase('17_4_3_torr_h', seed, 1.0, 5.0, 0.5) : 2.5;
            const h = seed ? parseFloat((h_base + offset * 0.2).toFixed(2)) : 2.5;

            const v = Math.sqrt(2 * 9.8 * h);

            return {
                params: { h, h_base, r: offset },
                answers: [v.toFixed(2)],
                answersRaw: [v],
                explanation: () => `
          จากกฎของตอร์รีเชลลี (Torricelli's Law): \\( v = \\sqrt{2gh} \\)<br>
          แทนค่าคำนวณ:<br>
          \\( v = \\sqrt{2 \\cdot 9.8 \\cdot ${h.toFixed(2)}} = \\sqrt{${(2 * 9.8 * h).toFixed(2)}} = ${v.toFixed(2)} \\text{ m/s} \\)
        `
            };
        }
    },
    {
        id: '17_4_3_airplane_lift', topic: '17.4.3', type: 'numeric_single',
        title: 'แรงยกปีกเครื่องบินตามสมการแบร์นูลลี',
        inputs: [{ label: 'แรงยกบนปีกเครื่องบินรวม \\( (\\text{kN}) \\):' }],
        text: (p) => {
            const vt = cleanNum(p.vt, 2);
            const vb = cleanNum(p.vb, 2);
            const area = cleanNum(p.area, 2);
            return `เครื่องบินบินด้วยความเร็วคงตัว ขณะบินพบว่าอัตราเร็วของอากาศเหนือปีกเท่ากับ \\( ${vt} \\text{ m/s} \\) และใต้ปีกเท่ากับ \\( ${vb} \\text{ m/s} \\) ถ้าปีกเครื่องบินมีพื้นที่รวม \\( ${area} \\text{ m}^2 \\) และความหนาแน่นอากาศขณะนั้นเท่ากับ \\( 1.2 \\text{ kg/m}^3 \\) จงหาแรงยกที่กระทำต่อปีกเครื่องบินในหน่วยกิโลนิวตัน (kN)`;
        },
        generate: (seed) => {
            const offset = getOffsetFromR(seed);
            const vt = seed ? getSeededRandomBase('17_4_3_wing_vt', seed, 60, 100, 5) : 80;
            const vb = seed ? getSeededRandomBase('17_4_3_wing_vb', seed, 40, 60, 5) : 50;
            const area = seed ? getSeededRandomBase('17_4_3_wing_a', seed, 20, 50, 5) : 30;

            const rho = 1.2;
            const dp = 0.5 * rho * (Math.pow(vt, 2) - Math.pow(vb, 2));
            const force_n = dp * area;
            const force_kn = force_n / 1000;

            return {
                params: { vt, vb, area, r: offset },
                answers: [force_kn.toFixed(2)],
                answersRaw: [force_kn],
                explanation: () => `
          1. คำนวณความต่างความดันระหว่างใต้ปีกและเหนือปีก:<br>
          \\( \\Delta P = P_{\\text{bottom}} - P_{\\text{top}} = \\frac{1}{2}\\rho (v_{\\text{top}}^2 - v_{\\text{bottom}}^2) \\)<br>
          \\( \\Delta P = \\frac{1}{2}(1.2) \\cdot (${vt.toFixed(2)}^2 - ${vb.toFixed(2)}^2) = 0.6 \\cdot (${Math.pow(vt, 2)} - ${Math.pow(vb, 2)}) = ${dp.toFixed(2)} \\text{ Pa} \\)<br>
          2. หาแรงยกบนปีกเครื่องบิน: \\( F = \\Delta P \\cdot A \\)<br>
          \\( F = (${dp.toFixed(2)} \\text{ Pa}) \\cdot (${area.toFixed(2)} \\text{ m}^2) = ${force_n.toFixed(2)} \\text{ N} = ${force_kn.toFixed(2)} \\text{ kN} \\)
        `
            };
        }
    },
    {
        id: '17_4_3_bernoulli_concept', topic: '17.4.3', type: 'choice',
        title: 'มโนทัศน์สมการแบร์นูลลีและแรงยก',
        choices: [
            'บริเวณที่ของไหลเคลื่อนที่ด้วยอัตราเร็วสูง ความดันสถิตในของไหลจะต่ำลง',
            'บริเวณที่ของไหลเคลื่อนที่ด้วยอัตราเร็วสูง ความดันสถิตในของไหลจะเพิ่มสูงขึ้น',
            'แรงยกปีกเครื่องบินเกิดขึ้นเพราะอากาศใต้ปีกเคลื่อนที่เร็วทำให้เกิดความดันสูงดันขึ้น',
            'หลังคาบ้านปลิวในพายุเพราะความดันอากาศภายในบ้านต่ำกว่าความดันบรรยากาศภายนอก'
        ],
        choiceExplanations: [
            { isCorrect: true, text: 'เป็นหลักการของสมการแบร์นูลลี อัตราเร็วสูง -> ความดันสถิตต่ำ' },
            { isCorrect: false, text: 'อัตราเร็วสูงจะทำให้ความดันสถิตลดลง ไม่ใช่เพิ่มขึ้น' },
            { isCorrect: false, text: 'อากาศเหนือปีกเคลื่อนที่เร็วกว่า ทำให้ความดันเหนือปีกต่ำ ความดันใต้ปีกสูงกว่าจึงดันยกขึ้น' },
            { isCorrect: false, text: 'พายุลมแรงเหนือหลังคาทำให้ความดันภายนอกต่ำ ความดันในบ้านสูงกว่าจึงดันหลังคาปลิวขึ้น' }
        ],
        text: () => `ตามหลักการของสมการแบร์นูลลี (Bernoulli's Principle) ความสัมพันธ์ระหว่างอัตราเร็วและความดันของไหลข้อใดถูกต้อง`,
        generate: (seed) => ({
            params: {},
            answers: ['บริเวณที่ของไหลเคลื่อนที่ด้วยอัตราเร็วสูง ความดันสถิตในของไหลจะต่ำลง'],
            answersRaw: [0],
            explanation: (shuffled) => formatChoiceExplanation(QUESTION_TEMPLATES.find(q => q.id === '17_4_3_bernoulli_concept'), shuffled)
        })
    }
];

// --- Practice Engine ---
function startPracticeMode(topic) {
    currentPracticeTopic = topic;
    const practiceArena = document.getElementById('practice-arena');
    if (practiceArena) practiceArena.classList.remove('hidden');

    ['17-4-1', '17-4-2', '17-4-3'].forEach(t => {
        const btn = document.getElementById(`btn-prac-${t}`);
        if (btn) btn.className = t === topic
            ? "p-4 bg-slate-100 border-2 border-cyan-500 text-slate-900 rounded-xl flex items-center gap-3 transition text-left shadow-sm"
            : "p-4 bg-white hover:bg-slate-50 text-slate-800 rounded-xl border border-slate-200 flex items-center gap-3 transition text-left shadow-sm hover:shadow";
    });

    const feedback = document.getElementById('prac-feedback');
    const explBox = document.getElementById('prac-explanation-box');
    if (feedback) feedback.classList.add('hidden');
    if (explBox) explBox.classList.add('hidden');

    regeneratePractice();
}

function regeneratePractice() {
    const modeSelect = document.getElementById('prac-type-select');
    const mode = modeSelect ? modeSelect.value : 'standard';
    const isRandom = mode === 'random';

    const formattedTopic = currentPracticeTopic.replace('17-4-', '17.4.');
    let filtered = QUESTION_TEMPLATES.filter(q => q.topic === formattedTopic);
    if (!filtered.length) filtered = QUESTION_TEMPLATES;

    if (!practiceHistory[formattedTopic]) {
        practiceHistory[formattedTopic] = [];
    }

    let available = filtered.filter(q => !practiceHistory[formattedTopic].includes(q.id));
    if (available.length === 0) {
        practiceHistory[formattedTopic] = [];
        available = filtered;
    }

    const template = available[Math.floor(Math.random() * available.length)];
    practiceHistory[formattedTopic].push(template.id);

    let instance = null;
    let attempts = 0;
    const history = getHistory();

    while (attempts < 100) {
        attempts++;
        let R = isRandom ? Math.floor(Math.random() * 1000000) + 1 : "standard_" + Math.floor(Math.random() * 1000000);
        instance = template.generate(R);

        const vals = getActiveParamValues(instance.params);
        if (vals.length > 0) {
            if (hasDuplicateVariables(instance.params)) continue;
            const key = generateUniqueKey(template.id, instance.params);
            if (history.includes(key)) continue;
            addToHistory(key);
        }
        break;
    }

    currentPracticeQuestion = { template, instance, shuffledChoices: [] };
    document.getElementById('prac-badge-mode').innerText = `หมวดหมู่โจทย์: ${template.topic} • ${isRandom ? 'โหมดสุ่มตัวเลข' : 'โจทย์ปกติ'}`;
    document.getElementById('prac-question-title').innerText = `📋 โจทย์: ${template.title}`;
    document.getElementById('prac-question-text').innerHTML = template.text(instance.params);

    const cz = document.getElementById('prac-choice-zone'), nz = document.getElementById('prac-numeric-zone');
    document.getElementById('prac-input-val1').value = '';
    document.getElementById('prac-input-val2').value = '';
    document.getElementById('prac-input-zone-2').classList.add('hidden');
    document.getElementById('prac-feedback').classList.add('hidden');
    document.getElementById('prac-explanation-box').classList.add('hidden');

    if (template.type === 'choice') {
        cz.classList.remove('hidden');
        nz.classList.add('hidden');
        const shuffledChoices = pureShuffle(template.choices);
        currentPracticeQuestion.shuffledChoices = shuffledChoices;
        cz.innerHTML = shuffledChoices.map(c => {
            const escaped = c.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            return `<button onclick="checkPracticeChoice(this.getAttribute('data-choice'))" data-choice="${escaped}" class="w-full text-left px-5 py-3 bg-white hover:bg-cyan-50 text-slate-800 font-medium rounded-xl border border-slate-200 hover:border-cyan-300 transition">${c}</button>`;
        }).join('');
    } else {
        cz.classList.add('hidden');
        nz.classList.remove('hidden');
        document.getElementById('lbl-prac-input-1').innerHTML = template.inputs[0].label;
    }
    queueTypeset(document.getElementById('practice-arena'));
}

function checkPracticeAnswer() {
    if (!currentPracticeQuestion) return;
    const { template, instance } = currentPracticeQuestion;
    if (template.type === 'choice') return;

    const v1 = document.getElementById('prac-input-val1').value.trim();
    if (!v1) {
        triggerAlert("กรอกข้อมูลไม่ครบ", "ระบุคำตอบก่อนกดตรวจเฉลยครับ", "fa-circle-question", "bg-cyan-100 text-cyan-600");
        return;
    }

    const c1 = isNumericAnswerCorrect(v1, instance.answersRaw[0]);
    showPracticeFeedback(c1, instance.explanation());
}

function checkPracticeChoice(choice) {
    if (!currentPracticeQuestion) return;
    const { template, instance, shuffledChoices } = currentPracticeQuestion;
    const isCorrect = choice === instance.answers[0];
    const explanationText = formatChoiceExplanation(template, shuffledChoices);
    showPracticeFeedback(isCorrect, explanationText);
}

function showPracticeFeedback(isCorrect, explainText) {
    const fb = document.getElementById('prac-feedback');
    fb.className = `p-5 rounded-2xl border block ${isCorrect ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`;
    fb.innerHTML = isCorrect
        ? `<div class="font-bold flex items-center gap-2"><i class="fa-solid fa-circle-check text-emerald-500 text-lg"></i> ยอดเยี่ยม! คำตอบของคุณถูกต้องครบถ้วน</div>`
        : `<div class="font-bold flex items-center gap-2"><i class="fa-solid fa-circle-xmark text-red-500 text-lg"></i> คำตอบไม่ตรงเฉลย ศึกษาขั้นตอนด้านล่างกันครับ</div>`;
    document.getElementById('prac-explanation-text').innerHTML = explainText;
    document.getElementById('prac-explanation-box').classList.remove('hidden');
    queueTypeset(document.getElementById('practice-arena'));
}

// --- Exam Engine ---
function startExamProcess() {
    const name = document.getElementById('exam-student-name').value.trim();
    const cls = document.getElementById('exam-student-class').value;
    const num = document.getElementById('exam-student-no').value.trim();
    const R_parsed = parseInt(num);
    if (!name || !cls || isNaN(R_parsed) || R_parsed < 1 || R_parsed > 40) {
        triggerAlert("ข้อมูลไม่ครบถ้วน", "กรุณาระบุ ชื่อ ชั้นเรียน และเลขที่ (1-40) ให้ถูกต้องก่อนเริ่มสอบครับ", "fa-user", "bg-cyan-100 text-cyan-600");
        return;
    }

    const timestamp = Date.now();
    examSeed = `${num}_${timestamp}`;
    examDurationSeconds = 15 * 60;
    examStudentInfo = { name, class: cls, number: num, seed: examSeed };

    // Select 4 numeric calculation questions + 1 choice question
    const numericQs = QUESTION_TEMPLATES.filter(q => q.type !== 'choice');
    const choiceQs = QUESTION_TEMPLATES.filter(q => q.type === 'choice');

    let selectedTemplates = [];
    selectedTemplates.push(...pureShuffle(numericQs).slice(0, 4));
    if (choiceQs.length > 0) {
        selectedTemplates.push(pureShuffle(choiceQs)[0]);
    }
    selectedTemplates = pureShuffle(selectedTemplates);

    currentExamQuestions = selectedTemplates.map((template) => {
        let instance = template.generate(`${num}_${timestamp}_${template.id}`);
        const choices = template.type === 'choice' ? pureShuffle(template.choices) : [];
        const explanationText = template.type === 'choice'
            ? formatChoiceExplanation(template, choices)
            : instance.explanation();
        return {
            id: template.id, topic: template.topic, type: template.type, title: template.title,
            text: template.text(instance.params), inputs: template.inputs || [], choices: choices,
            answers: instance.answers,
            answersRaw: instance.answersRaw,
            explanationText: explanationText
        };
    });

    document.getElementById('lbl-exam-user-info').innerHTML = `${name} (ม.6/${cls} เลขที่ ${num})`;

    renderExamLiveDOM();

    examStartTimestamp = Date.now();
    examDeadlineTimestamp = examStartTimestamp + (examDurationSeconds * 1000);
    examTimeRemaining = examDurationSeconds;
    examIsActive = true;
    examSubmissionInProgress = false;

    sessionStorage.setItem(EXAM_STATE_KEY, JSON.stringify({
        examQuestions: currentExamQuestions, studentInfo: examStudentInfo, examStartTimestamp, examDeadlineTimestamp, examDurationSeconds
    }));

    setupExamLocks();
    showSection('exam-live');
    startExamTimer();
}

function setupExamLocks() {
    examExitGuardEnabled = true;
    document.body.classList.add('exam-locked');
    window.addEventListener('beforeunload', handleExamBeforeUnload);
}
function releaseExamLocks() {
    examExitGuardEnabled = false;
    document.body.classList.remove('exam-locked');
    window.removeEventListener('beforeunload', handleExamBeforeUnload);
}
function handleExamBeforeUnload(e) { if (examIsActive) { e.preventDefault(); e.returnValue = ''; } }

function renderExamLiveDOM() {
    const container = document.getElementById('exam-questions-container');
    container.innerHTML = '';
    currentExamQuestions.forEach((q, idx) => {
        let inputHTML = '';
        if (q.type === 'choice') {
            inputHTML += `<div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">`;
            q.choices.forEach((c) => {
                inputHTML += `<label class="flex items-center gap-3 bg-slate-50 border border-slate-200 hover:bg-slate-100 p-4 rounded-xl cursor-pointer transition">
              <input type="radio" name="exam-q${idx}" value="${c}" class="w-4 h-4 text-cyan-600 focus:ring-cyan-500">
              <span class="text-sm text-slate-800">${c}</span>
            </label>`;
            });
            inputHTML += `</div>`;
        } else {
            inputHTML += `<div class="mt-4"><label class="block text-xs font-bold text-slate-500 mb-1">${q.inputs[0].label}</label>
            <input type="text" id="exam-q${idx}-val1" class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-cyan-500 outline-none font-mono text-sm"></div>`;
        }
        container.innerHTML += `<div class="bg-white rounded-2xl p-6 md:p-8 shadow-sm border border-slate-200">
          <div class="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
            <span class="font-bold text-slate-800">ข้อที่ ${idx + 1}: ${q.title}</span>
            <span class="bg-cyan-100 text-cyan-800 px-2.5 py-1 rounded-md text-xs font-bold">2 คะแนน</span>
          </div>
          <p class="text-sm md:text-base text-slate-700 leading-relaxed font-medium math-font">${q.text}</p>
          ${inputHTML}
        </div>`;
    });
    queueTypeset(container);
}

function startExamTimer() {
    clearInterval(examTimerInterval);
    examTimerInterval = setInterval(() => {
        if (!examIsActive) return;
        examTimeRemaining = Math.max(0, Math.ceil((examDeadlineTimestamp - Date.now()) / 1000));
        document.getElementById('exam-timer-display').innerText = formatExamTime(examTimeRemaining);
        if (examTimeRemaining < 60) document.getElementById('exam-timer-display').classList.add('text-red-400');

        if (examTimeRemaining <= 0) {
            clearInterval(examTimerInterval);
            triggerAlert("หมดเวลาการสอบ", "ระบบได้ส่งผลข้อสอบของท่านอัตโนมัติเรียบร้อยแล้ว", "fa-clock", "bg-red-100 text-red-600");
            submitExam(true);
        }
    }, 500);
}

function formatExamTime(totalSec) {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function getExamAnswers() {
    return currentExamQuestions.map((q, idx) => {
        if (q.type === 'choice') {
            const chk = document.querySelector(`input[name="exam-q${idx}"]:checked`);
            return chk ? chk.value : null;
        } else {
            const val1 = document.getElementById(`exam-q${idx}-val1`);
            return val1 ? [val1.value] : null;
        }
    });
}

function confirmSubmitExam() {
    const answers = getExamAnswers();
    const uncomplete = answers.some(a => !a || (Array.isArray(a) && (a.some(val => !val.trim()))));
    const msg = uncomplete ? "คุณยังกรอกข้อสอบไม่ครบถ้วน ยืนยันต้องการส่งข้อสอบทันทีเลยหรือไม่?" : "คุณกรอกข้อสอบเรียบร้อยครบทุกข้อ ยืนยันความถูกต้องและต้องการส่งเลยหรือไม่?";

    const m = document.getElementById('modal-confirm');
    const c = document.getElementById('modal-confirm-card');
    document.getElementById('modal-confirm-msg').innerText = msg;

    m.classList.remove('hidden');
    setTimeout(() => { c.classList.remove('scale-95', 'opacity-0'); }, 10);
}

function closeConfirmModal() {
    const m = document.getElementById('modal-confirm');
    const c = document.getElementById('modal-confirm-card');
    c.classList.add('scale-95', 'opacity-0');
    setTimeout(() => { m.classList.add('hidden'); }, 200);
}

function executeSubmitExam() {
    closeConfirmModal();
    setTimeout(() => submitExam(), 200);
}

function submitExam(timeExpired = false) {
    if (examSubmissionInProgress) return;
    examSubmissionInProgress = true;
    examIsActive = false;
    clearInterval(examTimerInterval);
    releaseExamLocks();

    const answers = getExamAnswers();
    let total_score = 0;
    const gradedResults = [];

    currentExamQuestions.forEach((q, idx) => {
        const userAns = answers[idx];
        let isCorrect = false;
        if (q.type === 'choice') {
            isCorrect = userAns === q.answers[0];
        } else {
            isCorrect = userAns && isNumericAnswerCorrect(userAns[0], q.answersRaw[0]);
        }

        const score = isCorrect ? 2.0 : 0.0;
        total_score += score;
        gradedResults.push({
            idx, isCorrect, score, userAns,
            expectedAnswers: q.answers,
            explanationText: q.explanationText
        });
    });

    const elapsed = timeExpired ? examDurationSeconds : (examDurationSeconds - examTimeRemaining);
    const timeStr = `${Math.floor(elapsed / 60)} นาที ${elapsed % 60} วินาที`;

    const payload = {
        score: total_score, timeTaken: timeStr, studentInfo: examStudentInfo,
        gradedResults, examQuestions: currentExamQuestions, date: new Date().toLocaleDateString('th-TH')
    };
    localStorage.setItem('last_exam_results_17_4', JSON.stringify(payload));
    sessionStorage.removeItem(EXAM_STATE_KEY);

    updateLatestScore();
    showSection('exam-result');
    renderExamResults(payload);
}

function renderExamResults(data) {
    document.getElementById('lbl-res-student-name').innerText = data.studentInfo.name;
    document.getElementById('lbl-res-student-meta').innerHTML = `(ม.6/${data.studentInfo.class} เลขที่ ${data.studentInfo.number})`;
    document.getElementById('lbl-res-time-elapsed').innerText = data.timeTaken;
    document.getElementById('lbl-res-finished-at').innerText = data.date;

    document.getElementById('lbl-res-total-score').innerText = data.score;
    const circle = document.getElementById('res-circle-progress');
    if (circle) circle.style.strokeDashoffset = 439.8 - (data.score / 10) * 439.8;

    const fb = document.getElementById('lbl-res-badge-feedback');
    if (data.score >= 8) fb.innerHTML = `<span class="text-emerald-600 font-bold"><i class="fa-solid fa-star"></i> ยอดเยี่ยม! คุณเข้าใจสมการแบร์นูลลีและการคำนวณอัตราการไหลได้อย่างดีเยี่ยม</span>`;
    else if (data.score >= 5) fb.innerHTML = `<span class="text-cyan-600 font-bold"><i class="fa-solid fa-thumbs-up"></i> ดี! ผ่านเกณฑ์ความเข้าใจ ทบทวนกฎของตอร์รีเชลลีและสมการความต่อเนื่องเพิ่มนะครับ</span>`;
    else fb.innerHTML = `<span class="text-red-600 font-bold"><i class="fa-solid fa-book"></i> ยังไม่ผ่านเกณฑ์ แนะนำทบทวนหัวข้อ 17.4.1, 17.4.2 และ 17.4.3 เพิ่มเติม</span>`;

    const tbody = document.getElementById('exam-result-tbody');
    const sols = document.getElementById('exam-solutions-container');
    tbody.innerHTML = ''; sols.innerHTML = '';

    data.gradedResults.forEach((grad, i) => {
        const q = data.examQuestions[i];
        const status = grad.isCorrect
            ? `<span class="text-emerald-500 font-bold"><i class="fa-solid fa-check"></i> 2.0</span>`
            : `<span class="text-red-500 font-bold"><i class="fa-solid fa-xmark"></i> 0.0</span>`;

        tbody.innerHTML += `<tr class="bg-white">
          <td class="px-5 py-3 font-medium text-center">${i + 1}</td>
          <td class="px-5 py-3 text-slate-700">${q.title}</td>
          <td class="px-5 py-3 text-center">2.0</td>
          <td class="px-5 py-3 text-center">${status}</td>
        </tr>`;

        let uAns = 'ไม่ได้ระบุคำตอบ';
        if (q.type === 'choice') uAns = grad.userAns || uAns;
        else if (grad.userAns && grad.userAns[0]) uAns = grad.userAns[0];

        sols.innerHTML += `<div class="bg-white p-5 rounded-xl border border-slate-200">
          <h5 class="font-bold text-slate-800 mb-2">ข้อ ${i + 1}: ${q.title}</h5>
          <p class="text-sm text-slate-600 mb-3 math-font">${q.text}</p>
          <div class="text-xs bg-slate-50 p-3 rounded-lg border border-slate-100 mb-3 font-mono">
            <p>คำตอบของคุณ: <span class="font-bold ${grad.isCorrect ? 'text-emerald-600' : 'text-red-600'}">${uAns}</span></p>
            <p>เฉลยที่ถูกต้อง: <span class="font-bold text-slate-800">${grad.expectedAnswers.join(' หรือ ')}</span></p>
          </div>
          <div class="text-xs text-slate-700 bg-cyan-50/50 p-3 rounded-lg math-font border border-cyan-100">${grad.explanationText}</div>
        </div>`;
    });
    queueTypeset(document.getElementById('sec-exam-result'));
}

function toggleExamSolutionBox() {
    const box = document.getElementById('exam-solution-box');
    const icon = document.getElementById('icon-toggle-sol');
    if (box && icon) {
        box.classList.toggle('hidden');
        icon.className = box.classList.contains('hidden') ? "fa-solid fa-chevron-down" : "fa-solid fa-chevron-up";
    }
}

function updateLatestScore() {
    if (typeof window === 'undefined') return;
    try {
        const saved = localStorage.getItem('last_exam_results_17_4');
        const badge = document.getElementById('latest-score-badge');
        if (saved && badge) {
            const data = JSON.parse(saved);
            const scoreLbl = document.getElementById('lbl-last-score');
            if (scoreLbl) {
                scoreLbl.innerHTML = `${data.score}/10 \\( (\\text{${data.studentInfo.name}}) \\)`;
                badge.classList.remove('hidden');
                queueTypeset(scoreLbl);
            }
        }
    } catch (e) { }
}

function showLatestResultModal() {
    if (typeof window === 'undefined') return;
    try {
        const saved = localStorage.getItem('last_exam_results_17_4');
        if (saved) {
            showSection('exam-result');
            renderExamResults(JSON.parse(saved));
        }
    } catch (e) { }
}

// --- On Load Init ---
window.onload = () => {
    updateLatestScore();
    switchReviewTab('17-4-continuity');
    queueTypeset(document.body);

    const activeSession = sessionStorage.getItem(EXAM_STATE_KEY);
    if (activeSession) {
        try {
            const s = JSON.parse(activeSession);
            if (s.examDeadlineTimestamp > Date.now()) {
                currentExamQuestions = s.examQuestions;
                examStudentInfo = s.studentInfo;
                examSeed = s.studentInfo.seed || null;
                examDeadlineTimestamp = s.examDeadlineTimestamp;
                examDurationSeconds = s.examDurationSeconds;
                examIsActive = true;
                document.getElementById('lbl-exam-user-info').innerHTML = `${s.studentInfo.name} (ม.6/${s.studentInfo.class} เลขที่ ${s.studentInfo.number})`;
                renderExamLiveDOM();
                setupExamLocks();
                showSection('exam-live');
                startExamTimer();
            } else {
                sessionStorage.removeItem(EXAM_STATE_KEY);
            }
        } catch (e) { sessionStorage.removeItem(EXAM_STATE_KEY); }
    }

    const totalQuestions = QUESTION_TEMPLATES.length;
    const totalCount = document.getElementById('total-count');
    if (totalCount) totalCount.innerText = totalQuestions;
};

let resizeTimer;
window.onresize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (currentSection === 'review') initCanvases();
    }, 150);
};