// ==========================================================================
// PORTAL CLIENT STATE MANAGEMENT
// ==========================================================================
let state = {
    projects: [],
    achievements: [],
    risks: [],
    nextsteps: [],
    decisions: [],
    approvedProjects: {}, // Mapping: { "Project Name": true/false }
    selectedProjectName: null,
    activeFormTab: 'metrics',
    projectToDelete: null
};

// ==========================================================================
// APPLICATION INITIALIZATION & NAV LISTENERS
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
    fetchData();
    setupNavigation();
    setupFormListeners();
    setupModalListeners();
});

// Navigation tab routing
function setupNavigation() {
    // Menu items
    document.querySelectorAll(".menu-item").forEach(item => {
        item.addEventListener("click", () => {
            const targetTab = item.getAttribute("data-tab");
            
            // Toggle menu buttons
            document.querySelectorAll(".menu-item").forEach(btn => btn.classList.remove("active"));
            item.classList.add("active");

            // Toggle tab views
            document.querySelectorAll(".tab-content").forEach(tab => tab.classList.remove("active"));
            const tabEl = document.getElementById(`tab-${targetTab}`);
            if (tabEl) tabEl.classList.add("active");

            // Update page titles
            const pageTitle = document.getElementById("page-title");
            const pageSubtitle = document.getElementById("page-subtitle");
            if (targetTab === 'dashboard') {
                pageTitle.innerText = "Portfolio Dashboard";
                pageSubtitle.innerText = "Real-time status tracking and weekly executive summaries";
            } else if (targetTab === 'entry-form') {
                pageTitle.innerText = "PM Status Entry Portal";
                pageSubtitle.innerText = "Direct project update wizard for Project Managers";
            } else if (targetTab === 'review-board') {
                pageTitle.innerText = "PMO Review Board";
                pageSubtitle.innerText = "Consolidation verification and report compiler controls";
                renderReviewBoard();
            }
            // Trigger icon rendering for new tab layouts
            lucide.createIcons();
        });
    });

    // Form Wizard Sub-Tabs
    document.querySelectorAll(".form-tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const targetFormTab = btn.getAttribute("data-form-tab");
            switchFormTab(targetFormTab);
        });
    });

    // Next/Prev buttons in form wizard
    document.getElementById("btn-form-prev").addEventListener("click", () => {
        const tabs = ['metrics', 'achievements', 'risks', 'nextsteps', 'decisions'];
        const idx = tabs.indexOf(state.activeFormTab);
        if (idx > 0) switchFormTab(tabs[idx - 1]);
    });

    document.getElementById("btn-form-next").addEventListener("click", () => {
        const tabs = ['metrics', 'achievements', 'risks', 'nextsteps', 'decisions'];
        const idx = tabs.indexOf(state.activeFormTab);
        if (idx < tabs.length - 1) switchFormTab(tabs[idx + 1]);
    });
}

function switchFormTab(tabName) {
    state.activeFormTab = tabName;
    
    // Toggle button active classes
    document.querySelectorAll(".form-tab-btn").forEach(btn => {
        btn.classList.remove("active");
        if (btn.getAttribute("data-form-tab") === tabName) btn.classList.add("active");
    });

    // Toggle forms visibility
    document.querySelectorAll(".form-tab-content").forEach(content => {
        content.classList.remove("active");
    });
    document.getElementById(`form-tab-${tabName}`).classList.add("active");

    // Update wizard action buttons state
    const tabs = ['metrics', 'achievements', 'risks', 'nextsteps', 'decisions'];
    const idx = tabs.indexOf(tabName);
    
    document.getElementById("btn-form-prev").disabled = (idx === 0);
    
    const saveBtn = document.getElementById("btn-form-save");
    const nextBtn = document.getElementById("btn-form-next");
    
    if (idx === tabs.length - 1) {
        saveBtn.style.display = "inline-flex";
        nextBtn.style.display = "none";
    } else {
        saveBtn.style.display = "none";
        nextBtn.style.display = "inline-flex";
    }
    
    // Refresh icons
    lucide.createIcons();
}

// ==========================================================================
// CORE API OPERATIONS (GET / POST)
// ==========================================================================
async function fetchData() {
    try {
        const response = await fetch("/api/data");
        if (!response.ok) throw new Error("Failed to fetch data from local API");
        const json = await response.json();
        
        state.projects = json.projects || [];
        state.achievements = json.achievements || [];
        state.risks = json.risks || [];
        state.nextsteps = json.nextsteps || [];
        state.decisions = json.decisions || [];

        // Initialize approval checkboxes
        state.projects.forEach(p => {
            if (state.approvedProjects[p.Project] === undefined) {
                state.approvedProjects[p.Project] = false;
            }
        });

        populateDashboardTable();
        populateProjectDropdown();
        updateDashboardCards();
        showToast("Data synced from Excel backend successfully.", "success");
    } catch (e) {
        console.error(e);
        showToast("Error syncing from backend: " + e.message, "error");
    }
}

async function submitConsolidatedData() {
    const compileBtn = document.getElementById("btn-compile-report");
    compileBtn.disabled = true;
    compileBtn.innerHTML = "<i data-lucide='loader' class='icon anim-spin'></i> Generating Document...";
    lucide.createIcons();

    try {
        const response = await fetch("/api/submit", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                projects: state.projects,
                achievements: state.achievements,
                risks: state.risks,
                nextsteps: state.nextsteps,
                decisions: state.decisions
            })
        });

        if (!response.ok) throw new Error("Compilation server error");
        const res = await response.json();
        
        showToast("Weekly Report compiled successfully! Word doc generated.", "success");
        fetchData(); // Sync fresh calculations
    } catch (e) {
        console.error(e);
        showToast("Failed to compile report: " + e.message, "error");
    } finally {
        compileBtn.disabled = false;
        compileBtn.innerHTML = "Generate Report";
        lucide.createIcons();
    }
}

// ==========================================================================
// DASHBOARD RENDERING & CARDS
// ==========================================================================
function updateDashboardCards() {
    document.getElementById("stat-total-projects").innerText = state.projects.length;

    let green = 0, yellow = 0, red = 0;
    state.projects.forEach(p => {
        // Calculate status locally in case metrics changed
        const delay = parseInt(p["Delay Days"]) || 0;
        const risk = parseInt(p["Risk Score"]) || 0;
        const status = getStatusLabel(delay, risk);
        
        if (status === "Green") green++;
        else if (status === "Yellow") yellow++;
        else if (status === "Red") red++;
    });

    document.getElementById("stat-green-projects").innerText = green;
    document.getElementById("stat-yellow-projects").innerText = yellow;
    document.getElementById("stat-red-projects").innerText = red;
    
    // Refresh icons
    lucide.createIcons();
}

function populateDashboardTable() {
    const tbody = document.getElementById("dashboard-table-body");
    tbody.innerHTML = "";

    state.projects.forEach((p, idx) => {
        const planned = parseFloat(p["Planned %"]) || 0;
        const actual = parseFloat(p["Actual %"]) || 0;
        const budget = parseFloat(p["Budget"]) || 0;
        const actualCost = parseFloat(p["Actual Cost"]) || 0;
        const delay = parseInt(p["Delay Days"]) || 0;
        const risk = parseInt(p["Risk Score"]) || 0;

        const spi = planned > 0 ? (actual / planned) : 0;
        const cpi = actualCost > 0 ? (budget / actualCost) : 0;
        const budgetConsumed = budget > 0 ? (actualCost / budget) : 0;
        const scheduleDev = actual - planned;
        
        const status = getStatusLabel(delay, risk);

        // Main Row
        const tr = document.createElement("tr");
        tr.className = "main-row";
        tr.setAttribute("data-project", p.Project);
        tr.innerHTML = `
            <td>
                <span class="expand-toggle" id="arrow-${idx}">
                    <i data-lucide="chevron-right" style="width: 16px; height: 16px;"></i>
                </span>
            </td>
            <td><strong>${p.Project}</strong></td>
            <td>${p.Manager}</td>
            <td><span class="badge ${status.toLowerCase()}">${status}</span></td>
            <td class="${spi < 0.9 ? 'text-red font-weight-bold' : ''}">${spi.toFixed(2)}</td>
            <td class="${cpi < 0.9 ? 'text-red font-weight-bold' : ''}">${cpi.toFixed(2)}</td>
            <td>${(budgetConsumed * 100).toFixed(0)}%</td>
            <td class="${scheduleDev < 0 ? 'text-red' : 'text-green'}">${scheduleDev >= 0 ? '+' : ''}${scheduleDev.toFixed(1)}%</td>
            <td>${delay} days</td>
            <td style="text-align: center;">
                <button class="btn-delete-row" data-project="${p.Project}" title="Delete Project">
                    <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);

        // Detail Row (hidden by default)
        const detailTr = document.createElement("tr");
        detailTr.className = "detail-row hidden";
        detailTr.id = `detail-row-${idx}`;
        detailTr.innerHTML = `
            <td colspan="10" style="padding: 0;">
                <div id="detail-content-${idx}"></div>
            </td>
        `;
        tbody.appendChild(detailTr);

        // Click handler for expansion (clicking anywhere on row except action button)
        tr.addEventListener("click", (e) => {
            if (e.target.closest('.btn-delete-row') || e.target.closest('button')) {
                return; // Let delete action handle it
            }
            
            const isHidden = detailTr.classList.contains("hidden");
            
            if (isHidden) {
                // Populate content dynamically
                document.getElementById(`detail-content-${idx}`).innerHTML = getProjectDetailRowHTML(p.Project);
                detailTr.classList.remove("hidden");
                document.getElementById(`arrow-${idx}`).classList.add("expanded");
                // Re-render lucide icons inside details
                lucide.createIcons();
            } else {
                detailTr.classList.add("hidden");
                document.getElementById(`arrow-${idx}`).classList.remove("expanded");
            }
        });

        // Click handler for deletion
        tr.querySelector(".btn-delete-row").addEventListener("click", (e) => {
            e.stopPropagation();
            openDeleteProjectModal(p.Project);
        });
    });
}

// ==========================================================================
// EXPANDED ROW RENDERER & DELETE LOGIC HELPERS
// ==========================================================================
function getProjectDetailRowHTML(projectName) {
    const achievements = state.achievements.filter(a => a.Project === projectName);
    const risks = state.risks.filter(r => r.Project === projectName);
    const nextSteps = state.nextsteps.filter(n => n.Project === projectName);
    const decisions = state.decisions.filter(d => d.Project === projectName);

    let html = `<div class="detail-panel"><div class="detail-grid">`;

    // Column 1: Achievements & Decisions
    html += `<div class="detail-col">`;
    
    // Achievements Card
    html += `
        <div class="detail-card">
            <h4><i data-lucide="award" style="color: var(--green);"></i> Weekly Achievements</h4>
    `;
    if (achievements.length > 0) {
        html += `<ul class="detail-achievements-list">`;
        achievements.forEach(a => {
            html += `<li>${escapeHtml(a.Achievement)}</li>`;
        });
        html += `</ul>`;
    } else {
        html += `<p class="detail-empty-text">No achievements recorded for this period.</p>`;
    }
    html += `</div>`;

    // Decisions Card
    html += `
        <div class="detail-card">
            <h4><i data-lucide="help-circle" style="color: var(--yellow);"></i> Decisions Required</h4>
            <div class="detail-decisions-container">
    `;
    if (decisions.length > 0) {
        decisions.forEach(d => {
            const options = d.Options ? d.Options.split('/').map(o => o.trim()) : [];
            html += `
                <div class="detail-decision-item">
                    <div class="detail-decision-title">${escapeHtml(d["Decision Required"])}</div>
                    <div class="detail-decision-meta"><strong>Context:</strong> ${escapeHtml(d.Context)}</div>
                    <div class="detail-decision-chips">
            `;
            options.forEach(opt => {
                html += `<span class="detail-chip">${escapeHtml(opt)}</span>`;
            });
            if (d.Recommendation) {
                html += `<span class="detail-chip recommendation">Rec: ${escapeHtml(d.Recommendation)}</span>`;
            }
            html += `
                    </div>
                </div>
            `;
        });
    } else {
        html += `<p class="detail-empty-text">No decisions or escalations requested.</p>`;
    }
    html += `</div></div></div>`; // Close cards and column

    // Column 2: Active Risks
    html += `
        <div class="detail-col">
            <div class="detail-card" style="height: 100%;">
                <h4><i data-lucide="alert-triangle" style="color: var(--red);"></i> Active Risks</h4>
                <div class="detail-table-wrapper">
    `;
    if (risks.length > 0) {
        html += `
            <table class="detail-table">
                <thead>
                    <tr>
                        <th>Description</th>
                        <th style="text-align:center;">Prob.</th>
                        <th style="text-align:center;">Impact</th>
                        <th>Mitigation</th>
                    </tr>
                </thead>
                <tbody>
        `;
        risks.forEach(r => {
            const pClass = (r.Probability === 'High' || r.Probability === 'Critical') ? `risk-prob-${r.Probability.toLowerCase()}` : '';
            const iClass = (r.Impact === 'High' || r.Impact === 'Critical') ? `risk-imp-${r.Impact.toLowerCase()}` : '';
            html += `
                <tr>
                    <td><strong>${escapeHtml(r["Risk Description"])}</strong></td>
                    <td class="${pClass} center-align">${escapeHtml(r.Probability)}</td>
                    <td class="${iClass} center-align">${escapeHtml(r.Impact)}</td>
                    <td>${escapeHtml(r.Mitigation)}</td>
                </tr>
            `;
        });
        html += `</tbody></table>`;
    } else {
        html += `<p class="detail-empty-text">No active risks recorded.</p>`;
    }
    html += `</div></div></div>`;

    // Column 3: Next Steps
    html += `
        <div class="detail-col">
            <div class="detail-card" style="height: 100%;">
                <h4><i data-lucide="calendar" style="color: #3b82f6;"></i> Next Steps</h4>
                <div class="detail-table-wrapper">
    `;
    if (nextSteps.length > 0) {
        html += `
            <table class="detail-table">
                <thead>
                    <tr>
                        <th>Task</th>
                        <th>Owner</th>
                        <th style="text-align:center;">Deadline</th>
                    </tr>
                </thead>
                <tbody>
        `;
        nextSteps.forEach(n => {
            let dateStr = n.Deadline || '';
            if (dateStr) {
                try {
                    const d = new Date(dateStr);
                    if (!isNaN(d.getTime())) {
                        dateStr = d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
                    }
                } catch(err) {}
            }
            html += `
                <tr>
                    <td><strong>${escapeHtml(n.Task)}</strong></td>
                    <td>${escapeHtml(n.Owner)}</td>
                    <td class="center-align">${escapeHtml(dateStr)}</td>
                </tr>
            `;
        });
        html += `</tbody></table>`;
    } else {
        html += `<p class="detail-empty-text">No next steps listed.</p>`;
    }
    html += `</div></div></div>`;

    html += `</div></div>`;
    return html;
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function openDeleteProjectModal(projectName) {
    state.projectToDelete = projectName;
    document.getElementById("delete-project-name").innerText = projectName;
    document.getElementById("delete-project-modal").classList.remove("hidden");
    lucide.createIcons();
}

function executeProjectDeletion(projectName) {
    state.projects = state.projects.filter(p => p.Project !== projectName);
    state.achievements = state.achievements.filter(a => a.Project !== projectName);
    state.risks = state.risks.filter(r => r.Project !== projectName);
    state.nextsteps = state.nextsteps.filter(n => n.Project !== projectName);
    state.decisions = state.decisions.filter(d => d.Project !== projectName);
    
    delete state.approvedProjects[projectName];
    
    populateDashboardTable();
    populateProjectDropdown();
    updateDashboardCards();
    
    if (state.selectedProjectName === projectName) {
        state.selectedProjectName = null;
        document.getElementById("project-select").value = "";
        document.getElementById("pm-update-form").classList.add("hidden");
        document.getElementById("no-project-selected").classList.remove("hidden");
    }
    
    showToast(`Project "${projectName}" and all its details deleted locally.`, "success");
}

function getStatusLabel(delay, risk) {
    if (delay <= 2 && risk <= 2) return "Green";
    if (delay > 5 || risk > 3) return "Red";
    return "Yellow";
}

// ==========================================================================
// FORM OPERATIONS & EDITORS
// ==========================================================================
function populateProjectDropdown() {
    const select = document.getElementById("project-select");
    // Keep header option
    select.innerHTML = '<option value="" disabled selected>-- Choose a Project --</option>';

    state.projects.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p.Project;
        opt.innerText = p.Project;
        select.appendChild(opt);
    });
}

function setupFormListeners() {
    const select = document.getElementById("project-select");
    select.addEventListener("change", (e) => {
        state.selectedProjectName = e.target.value;
        loadProjectIntoForm(state.selectedProjectName);
    });

    // Real-time calculations listener
    const inputsToMonitor = [
        "input-planned", "input-actual", 
        "input-budget", "input-actualcost", 
        "input-delay", "input-riskscore"
    ];
    inputsToMonitor.forEach(id => {
        document.getElementById(id).addEventListener("input", runRealTimeCalculations);
    });

    // Add list items buttons
    document.getElementById("btn-add-achievement").addEventListener("click", () => addAchievementRow(""));
    document.getElementById("btn-add-risk").addEventListener("click", () => addRiskRow({ "Risk Description": "", "Probability": "Medium", "Impact": "Medium", "Mitigation": "" }));
    document.getElementById("btn-add-nextstep").addEventListener("click", () => addNextStepRow({ "Task": "", "Owner": "", "Deadline": "" }));
    document.getElementById("btn-add-decision").addEventListener("click", () => addDecisionRow({ "Decision Required": "", "Context": "", "Options": "", "Recommendation": "" }));

    // Form submit listener (Local save only)
    document.getElementById("pm-update-form").addEventListener("submit", (e) => {
        e.preventDefault();
        if (validateForm()) {
            saveProjectDataLocally();
        }
    });
}

function validateForm() {
    // 1. Key Metrics Validation
    const manager = document.getElementById("input-manager");
    if (!manager.value.trim()) {
        showToast("Project Manager name is required.", "error");
        switchFormTab('metrics');
        manager.focus();
        return false;
    }

    const plannedInput = document.getElementById("input-planned");
    const planned = parseFloat(plannedInput.value);
    if (isNaN(planned) || planned < 0 || planned > 100) {
        showToast("Planned Progress % must be between 0 and 100.", "error");
        switchFormTab('metrics');
        plannedInput.focus();
        return false;
    }

    const actualInput = document.getElementById("input-actual");
    const actual = parseFloat(actualInput.value);
    if (isNaN(actual) || actual < 0 || actual > 100) {
        showToast("Actual Progress % must be between 0 and 100.", "error");
        switchFormTab('metrics');
        actualInput.focus();
        return false;
    }

    const budgetInput = document.getElementById("input-budget");
    if (budgetInput.value.trim() === "" || parseFloat(budgetInput.value) < 0) {
        showToast("Total Budget must be a non-negative number.", "error");
        switchFormTab('metrics');
        budgetInput.focus();
        return false;
    }

    const costInput = document.getElementById("input-actualcost");
    if (costInput.value.trim() === "" || parseFloat(costInput.value) < 0) {
        showToast("Actual Cost must be a non-negative number.", "error");
        switchFormTab('metrics');
        costInput.focus();
        return false;
    }

    const delayInput = document.getElementById("input-delay");
    if (delayInput.value.trim() === "") {
        showToast("Delay Days is required.", "error");
        switchFormTab('metrics');
        delayInput.focus();
        return false;
    }

    const riskInput = document.getElementById("input-riskscore");
    const risk = parseInt(riskInput.value);
    if (isNaN(risk) || risk < 1 || risk > 5) {
        showToast("Risk Score must be a number between 1 and 5.", "error");
        switchFormTab('metrics');
        riskInput.focus();
        return false;
    }

    // 2. Risks Validation
    const riskRows = document.querySelectorAll(".risk-row");
    for (let i = 0; i < riskRows.length; i++) {
        const tr = riskRows[i];
        const desc = tr.querySelector(".risk-desc").value.trim();
        const mit = tr.querySelector(".risk-mit").value.trim();
        
        if (!desc && !mit) {
            continue; // Ignore completely empty rows
        }
        if (!desc) {
            showToast("Risk Description is required for all active risks.", "error");
            switchFormTab('risks');
            tr.querySelector(".risk-desc").focus();
            return false;
        }
        if (!mit) {
            showToast("Mitigation Plan is required for all active risks.", "error");
            switchFormTab('risks');
            tr.querySelector(".risk-mit").focus();
            return false;
        }
    }

    // 3. Next Steps Validation
    const nextStepRows = document.querySelectorAll(".nextstep-row");
    for (let i = 0; i < nextStepRows.length; i++) {
        const tr = nextStepRows[i];
        const desc = tr.querySelector(".task-desc").value.trim();
        const owner = tr.querySelector(".task-owner").value.trim();
        const deadline = tr.querySelector(".task-deadline").value;

        if (!desc && !owner && !deadline) {
            continue; // Ignore completely empty rows
        }
        if (!desc) {
            showToast("Task Description is required for all next steps.", "error");
            switchFormTab('nextsteps');
            tr.querySelector(".task-desc").focus();
            return false;
        }
        if (!owner) {
            showToast("Owner is required for all next steps.", "error");
            switchFormTab('nextsteps');
            tr.querySelector(".task-owner").focus();
            return false;
        }
        if (!deadline) {
            showToast("Deadline is required for all next steps.", "error");
            switchFormTab('nextsteps');
            tr.querySelector(".task-deadline").focus();
            return false;
        }
    }

    // 4. Decisions Validation
    const decisionRows = document.querySelectorAll(".decision-row");
    for (let i = 0; i < decisionRows.length; i++) {
        const tr = decisionRows[i];
        const req = tr.querySelector(".dec-req").value.trim();
        const ctx = tr.querySelector(".dec-ctx").value.trim();
        const opts = tr.querySelector(".dec-opts").value.trim();
        const rec = tr.querySelector(".dec-rec").value.trim();

        if (!req && !ctx && !opts && !rec) {
            continue; // Ignore completely empty rows
        }
        if (!req) {
            showToast("Decision Required is required for all decision requests.", "error");
            switchFormTab('decisions');
            tr.querySelector(".dec-req").focus();
            return false;
        }
        if (!ctx) {
            showToast("Context Details are required for all decision requests.", "error");
            switchFormTab('decisions');
            tr.querySelector(".dec-ctx").focus();
            return false;
        }
        if (!opts) {
            showToast("Options are required for all decision requests.", "error");
            switchFormTab('decisions');
            tr.querySelector(".dec-opts").focus();
            return false;
        }
        if (!rec) {
            showToast("Recommendation is required for all decision requests.", "error");
            switchFormTab('decisions');
            tr.querySelector(".dec-rec").focus();
            return false;
        }
    }

    return true;
}

function loadProjectIntoForm(projName) {
    const project = state.projects.find(p => p.Project === projName);
    if (!project) return;

    // Show form, hide empty state
    document.getElementById("no-project-selected").classList.add("hidden");
    document.getElementById("pm-update-form").classList.remove("hidden");

    // Load Metrics
    document.getElementById("input-manager").value = project.Manager || "";
    document.getElementById("input-planned").value = project["Planned %"] || 0;
    document.getElementById("input-actual").value = project["Actual %"] || 0;
    document.getElementById("input-budget").value = project.Budget || 0;
    document.getElementById("input-actualcost").value = project["Actual Cost"] || 0;
    document.getElementById("input-delay").value = project["Delay Days"] || 0;
    document.getElementById("input-riskscore").value = project["Risk Score"] || 1;

    // Reset wizard to tab 1
    switchFormTab('metrics');

    // Run calculations initially
    runRealTimeCalculations();

    // Load Achievements
    const achList = document.getElementById("achievements-list");
    achList.innerHTML = "";
    const projectAchs = state.achievements.filter(a => a.Project === projName);
    if (projectAchs.length > 0) {
        projectAchs.forEach(a => addAchievementRow(a.Achievement));
    } else {
        // Add 1 blank achievement row for convenience
        addAchievementRow("");
    }

    // Load Risks
    const risksBody = document.getElementById("risks-tbody");
    risksBody.innerHTML = "";
    const projectRisks = state.risks.filter(r => r.Project === projName);
    projectRisks.forEach(addRiskRow);

    // Load Next Steps
    const nsBody = document.getElementById("nextsteps-tbody");
    nsBody.innerHTML = "";
    const projectNs = state.nextsteps.filter(n => n.Project === projName);
    projectNs.forEach(addNextStepRow);

    // Load Decisions
    const decBody = document.getElementById("decisions-tbody");
    decBody.innerHTML = "";
    const projectDecs = state.decisions.filter(d => d.Project === projName);
    projectDecs.forEach(addDecisionRow);
}

function runRealTimeCalculations() {
    const planned = parseFloat(document.getElementById("input-planned").value) || 0;
    const actual = parseFloat(document.getElementById("input-actual").value) || 0;
    const budget = parseFloat(document.getElementById("input-budget").value) || 0;
    const actualCost = parseFloat(document.getElementById("input-actualcost").value) || 0;
    const delay = parseInt(document.getElementById("input-delay").value) || 0;
    const risk = parseInt(document.getElementById("input-riskscore").value) || 1;

    const spi = planned > 0 ? (actual / planned) : 0;
    const cpi = actualCost > 0 ? (budget / actualCost) : 0;
    const progress = planned > 0 ? (actual / planned) : 0;
    const budgetConsumed = budget > 0 ? (actualCost / budget) : 0;
    const status = getStatusLabel(delay, risk);

    // Update fields
    const spiEl = document.getElementById("preview-spi");
    const cpiEl = document.getElementById("preview-cpi");
    const progEl = document.getElementById("preview-progress");
    const budgetEl = document.getElementById("preview-budget");
    const statusEl = document.getElementById("preview-status");

    spiEl.innerText = spi.toFixed(2);
    spiEl.className = "value " + (spi < 0.9 ? "text-red" : "text-green");

    cpiEl.innerText = cpi.toFixed(2);
    cpiEl.className = "value " + (cpi < 0.9 ? "text-red" : "text-green");

    progEl.innerText = (progress * 100).toFixed(1) + "%";
    budgetEl.innerText = (budgetConsumed * 100).toFixed(0) + "%";
    
    statusEl.innerText = status;
    statusEl.className = "value text-" + status.toLowerCase();
}

// Helper to append achievement bullets
function addAchievementRow(val) {
    const container = document.getElementById("achievements-list");
    const row = document.createElement("div");
    row.className = "list-item-row";
    row.innerHTML = `
        <span class="bullet-dot">•</span>
        <input type="text" class="form-input achievement-input" value="${val}" placeholder="Record a weekly achievement...">
        <button type="button" class="btn-danger" onclick="this.parentElement.remove()">
            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
        </button>
    `;
    container.appendChild(row);
    lucide.createIcons();
}

// Helper to append risk rows
function addRiskRow(riskData) {
    const tbody = document.getElementById("risks-tbody");
    const tr = document.createElement("tr");
    tr.className = "risk-row";
    
    const prob = riskData.Probability || "Medium";
    const imp = riskData.Impact || "Medium";

    tr.innerHTML = `
        <td><input type="text" class="form-input risk-desc" value="${riskData["Risk Description"] || ''}" placeholder="E.g. Resource availability issues"></td>
        <td>
            <select class="form-select risk-prob">
                <option value="Low" ${prob === 'Low' ? 'selected' : ''}>Low</option>
                <option value="Medium" ${prob === 'Medium' ? 'selected' : ''}>Medium</option>
                <option value="High" ${prob === 'High' ? 'selected' : ''}>High</option>
                <option value="Critical" ${prob === 'Critical' ? 'selected' : ''}>Critical</option>
            </select>
        </td>
        <td>
            <select class="form-select risk-imp">
                <option value="Low" ${imp === 'Low' ? 'selected' : ''}>Low</option>
                <option value="Medium" ${imp === 'Medium' ? 'selected' : ''}>Medium</option>
                <option value="High" ${imp === 'High' ? 'selected' : ''}>High</option>
                <option value="Critical" ${imp === 'Critical' ? 'selected' : ''}>Critical</option>
            </select>
        </td>
        <td><input type="text" class="form-input risk-mit" value="${riskData.Mitigation || ''}" placeholder="E.g. Onboard contractor"></td>
        <td>
            <button type="button" class="btn-danger" onclick="this.parentElement.parentElement.remove()">
                <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
            </button>
        </td>
    `;
    tbody.appendChild(tr);
    lucide.createIcons();
}

// Helper to append task rows
function addNextStepRow(taskData) {
    const tbody = document.getElementById("nextsteps-tbody");
    const tr = document.createElement("tr");
    tr.className = "nextstep-row";

    tr.innerHTML = `
        <td><input type="text" class="form-input task-desc" value="${taskData.Task || ''}" placeholder="E.g. Complete staging testing"></td>
        <td><input type="text" class="form-input task-owner" value="${taskData.Owner || ''}" placeholder="E.g. John"></td>
        <td><input type="date" class="form-input task-deadline" value="${taskData.Deadline || ''}"></td>
        <td>
            <button type="button" class="btn-danger" onclick="this.parentElement.parentElement.remove()">
                <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
            </button>
        </td>
    `;
    tbody.appendChild(tr);
    lucide.createIcons();
}

// Helper to append decision rows
function addDecisionRow(decData) {
    const tbody = document.getElementById("decisions-tbody");
    const tr = document.createElement("tr");
    tr.className = "decision-row";

    tr.innerHTML = `
        <td><input type="text" class="form-input dec-req" value="${decData["Decision Required"] || ''}" placeholder="E.g. Approve weekend testing"></td>
        <td><input type="text" class="form-input dec-ctx" value="${decData.Context || ''}" placeholder="E.g. Backlog due to environmental failure"></td>
        <td><input type="text" class="form-input dec-opts" value="${decData.Options || ''}" placeholder="Option A / Option B"></td>
        <td><input type="text" class="form-input dec-rec" value="${decData.Recommendation || ''}" placeholder="E.g. Approve option B"></td>
        <td>
            <button type="button" class="btn-danger" onclick="this.parentElement.parentElement.remove()">
                <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
            </button>
        </td>
    `;
    tbody.appendChild(tr);
    lucide.createIcons();
}

// Save inputs into global state locally
function saveProjectDataLocally() {
    const projName = state.selectedProjectName;
    if (!projName) return;

    // Update main project row
    const project = state.projects.find(p => p.Project === projName);
    if (!project) return;

    project.Manager = document.getElementById("input-manager").value;
    project["Planned %"] = parseFloat(document.getElementById("input-planned").value) || 0;
    project["Actual %"] = parseFloat(document.getElementById("input-actual").value) || 0;
    project.Budget = parseFloat(document.getElementById("input-budget").value) || 0;
    project["Actual Cost"] = parseFloat(document.getElementById("input-actualcost").value) || 0;
    project["Delay Days"] = parseInt(document.getElementById("input-delay").value) || 0;
    project["Risk Score"] = parseInt(document.getElementById("input-riskscore").value) || 1;

    // Update Achievements
    state.achievements = state.achievements.filter(a => a.Project !== projName);
    document.querySelectorAll(".achievement-input").forEach(input => {
        if (input.value.trim() !== "") {
            state.achievements.push({
                Project: projName,
                Achievement: input.value.trim()
            });
        }
    });

    // Update Risks
    state.risks = state.risks.filter(r => r.Project !== projName);
    document.querySelectorAll(".risk-row").forEach(tr => {
        const desc = tr.querySelector(".risk-desc").value.trim();
        if (desc !== "") {
            state.risks.push({
                Project: projName,
                "Risk Description": desc,
                Probability: tr.querySelector(".risk-prob").value,
                Impact: tr.querySelector(".risk-imp").value,
                Mitigation: tr.querySelector(".risk-mit").value.trim()
            });
        }
    });

    // Update Next Steps
    state.nextsteps = state.nextsteps.filter(n => n.Project !== projName);
    document.querySelectorAll(".nextstep-row").forEach(tr => {
        const desc = tr.querySelector(".task-desc").value.trim();
        if (desc !== "") {
            state.nextsteps.push({
                Project: projName,
                Task: desc,
                Owner: tr.querySelector(".task-owner").value.trim(),
                Deadline: tr.querySelector(".task-deadline").value
            });
        }
    });

    // Update Decisions
    state.decisions = state.decisions.filter(d => d.Project !== projName);
    document.querySelectorAll(".decision-row").forEach(tr => {
        const req = tr.querySelector(".dec-req").value.trim();
        if (req !== "") {
            state.decisions.push({
                Project: projName,
                "Decision Required": req,
                Context: tr.querySelector(".dec-ctx").value.trim(),
                Options: tr.querySelector(".dec-opts").value.trim(),
                Recommendation: tr.querySelector(".dec-rec").value.trim()
            });
        }
    });

    // Recalculate stats and tables
    populateDashboardTable();
    updateDashboardCards();
    showToast(`Saved updates for ${projName} locally. Remember to compile to finalize!`, "info");
}

// ==========================================================================
// PMO REVIEW BOARD - 3-STEP WORKFLOW
// ==========================================================================

let currentWorkflowStep = 1;

function renderReviewBoard() {
    currentWorkflowStep = 1;
    setWorkflowStep(1);
    renderChecklistCards();
    setupWorkflowListeners();
}

// --- Step Navigation ---
function setWorkflowStep(step) {
    currentWorkflowStep = step;

    // Update step indicator
    document.querySelectorAll('.step-item').forEach(el => {
        const s = parseInt(el.getAttribute('data-workflow-step'));
        el.classList.remove('active', 'completed');
        if (s === step) el.classList.add('active');
        else if (s < step) el.classList.add('completed');
    });

    // Update connectors
    const connectors = document.querySelectorAll('.step-connector');
    connectors.forEach((c, i) => {
        if (i < step - 1) c.classList.add('active');
        else c.classList.remove('active');
    });

    // Toggle panels
    document.querySelectorAll('.workflow-panel').forEach(panel => panel.classList.remove('active'));
    const target = document.getElementById(`workflow-step-${step}`);
    if (target) target.classList.add('active');

    // Step-specific rendering
    if (step === 2) {
        renderApprovedProjectsList();
        renderCombinedDocumentPreview();
    }

    lucide.createIcons();
}

function setupWorkflowListeners() {
    // Step navigation buttons
    const gotoStep2 = document.getElementById('btn-goto-step2');
    const backStep1 = document.getElementById('btn-back-step1');
    const backStep2From3 = document.getElementById('btn-back-step2-from-3');
    const newCycle = document.getElementById('btn-new-cycle');
    const compileBtn = document.getElementById('btn-compile-report');

    // Remove old listeners by cloning
    replaceWithClone(gotoStep2);
    replaceWithClone(backStep1);
    replaceWithClone(backStep2From3);
    replaceWithClone(newCycle);
    replaceWithClone(compileBtn);

    // Re-get after clone
    document.getElementById('btn-goto-step2').addEventListener('click', () => setWorkflowStep(2));
    document.getElementById('btn-back-step1').addEventListener('click', () => setWorkflowStep(1));
    document.getElementById('btn-back-step2-from-3').addEventListener('click', () => setWorkflowStep(2));
    document.getElementById('btn-new-cycle').addEventListener('click', () => {
        // Reset approvals and start over
        Object.keys(state.approvedProjects).forEach(k => state.approvedProjects[k] = false);
        setWorkflowStep(1);
        renderChecklistCards();
    });

    // Compile button opens confirmation modal
    document.getElementById('btn-compile-report').addEventListener('click', openCompileConfirmModal);

    // Select All / Clear All
    replaceWithClone(document.getElementById('btn-select-all'));
    replaceWithClone(document.getElementById('btn-deselect-all'));
    document.getElementById('btn-select-all').addEventListener('click', () => {
        state.projects.forEach(p => state.approvedProjects[p.Project] = true);
        renderChecklistCards();
    });
    document.getElementById('btn-deselect-all').addEventListener('click', () => {
        state.projects.forEach(p => state.approvedProjects[p.Project] = false);
        renderChecklistCards();
    });

    // Confirmation modal buttons
    setupCompileModalListeners();
}

function replaceWithClone(el) {
    if (!el) return;
    const clone = el.cloneNode(true);
    el.parentNode.replaceChild(clone, el);
}

// --- Checklist Rendering ---
function renderChecklistCards() {
    const checklist = document.getElementById('pmo-checklist');
    checklist.innerHTML = '';

    state.projects.forEach(p => {
        const delay = parseInt(p['Delay Days']) || 0;
        const risk = parseInt(p['Risk Score']) || 0;
        const status = getStatusLabel(delay, risk);
        const isApproved = state.approvedProjects[p.Project] || false;

        // Section completeness check
        const hasAchievements = state.achievements.some(a => a.Project === p.Project);
        const hasRisks = state.risks.some(r => r.Project === p.Project);
        const hasNextSteps = state.nextsteps.some(n => n.Project === p.Project);
        const hasDecisions = state.decisions.some(d => d.Project === p.Project);

        const sections = [
            { name: 'Metrics', done: true }, // Always has metrics from project row
            { name: 'Achievements', done: hasAchievements },
            { name: 'Risks', done: hasRisks },
            { name: 'Next Steps', done: hasNextSteps },
            { name: 'Decisions', done: hasDecisions }
        ];

        const completedSections = sections.filter(s => s.done).length;

        const card = document.createElement('div');
        card.className = `checklist-card ${isApproved ? 'approved' : ''}`;
        card.setAttribute('data-proj-name', p.Project);

        // Simulated last updated time (in production this would come from server)
        const lastUpdated = getSimulatedLastUpdated(p.Project);

        card.innerHTML = `
            <input type="checkbox" class="checklist-cb" ${isApproved ? 'checked' : ''}>
            <div class="checklist-meta">
                <h4>
                    ${p.Project}
                    <span class="status-badge-inline badge ${status.toLowerCase()}">${status}</span>
                </h4>
                <div class="checklist-details">
                    <span><i data-lucide="user" style="width:12px;height:12px;"></i> ${p.Manager}</span>
                    <span><i data-lucide="clock" style="width:12px;height:12px;"></i> Delay: ${delay}d</span>
                    <span><i data-lucide="alert-triangle" style="width:12px;height:12px;"></i> Risks: ${state.risks.filter(r => r.Project === p.Project).length}</span>
                    <span><i data-lucide="calendar" style="width:12px;height:12px;"></i> Updated: ${lastUpdated}</span>
                </div>
                <div class="section-badges">
                    ${sections.map(s => `<span class="section-badge ${s.done ? 'complete' : 'empty'}">${s.done ? '✓' : '✗'} ${s.name}</span>`).join('')}
                </div>
            </div>
        `;

        // Checkbox listener
        const cb = card.querySelector('.checklist-cb');
        cb.addEventListener('change', (e) => {
            e.stopPropagation();
            state.approvedProjects[p.Project] = cb.checked;
            if (cb.checked) card.classList.add('approved');
            else card.classList.remove('approved');
            updateApprovalProgress();
        });

        // Prevent card click from toggling checkbox twice
        card.addEventListener('click', (e) => {
            if (e.target !== cb) {
                cb.checked = !cb.checked;
                cb.dispatchEvent(new Event('change'));
            }
        });

        checklist.appendChild(card);
    });

    updateApprovalProgress();
    lucide.createIcons();
}

function getSimulatedLastUpdated(projectName) {
    // Simulated timestamps - in production, track real update times
    const now = new Date();
    const offsets = { 'CRM Upgrade': 2, 'ERP Rollout': 5, 'Data Migration': 0 };
    const hoursAgo = offsets[projectName] !== undefined ? offsets[projectName] : Math.floor(Math.random() * 24);
    const updated = new Date(now - hoursAgo * 60 * 60 * 1000);
    
    if (hoursAgo === 0) return 'Just now';
    if (hoursAgo < 1) return `${Math.floor(hoursAgo * 60)}m ago`;
    if (hoursAgo < 24) return `${hoursAgo}h ago`;
    return updated.toLocaleDateString();
}

function updateApprovalProgress() {
    const total = state.projects.length;
    const approved = Object.values(state.approvedProjects).filter(v => v === true).length;

    document.getElementById('approved-count').innerText = approved;
    document.getElementById('total-count').innerText = total;

    const pct = total > 0 ? (approved / total) * 100 : 0;
    document.getElementById('approval-progress-bar').style.width = pct + '%';

    // Enable/disable "Continue to Preview" button
    const gotoBtn = document.getElementById('btn-goto-step2');
    gotoBtn.disabled = approved === 0;
}

// --- Approved Projects List (Step 2) ---
function renderApprovedProjectsList() {
    const container = document.getElementById('approved-projects-list');
    container.innerHTML = '';

    const approvedNames = state.projects.filter(p => state.approvedProjects[p.Project]);

    if (approvedNames.length === 0) {
        container.innerHTML = '<p class="text-muted" style="font-size:0.85rem; padding:10px;">No projects approved yet.</p>';
        return;
    }

    approvedNames.forEach(p => {
        const delay = parseInt(p['Delay Days']) || 0;
        const risk = parseInt(p['Risk Score']) || 0;
        const status = getStatusLabel(delay, risk);

        const item = document.createElement('div');
        item.className = 'approved-item';
        item.innerHTML = `
            <i data-lucide="check-circle" class="approved-icon" style="width:16px;height:16px;"></i>
            <span class="approved-name">${p.Project}</span>
            <span class="approved-status badge ${status.toLowerCase()}">${status}</span>
        `;
        container.appendChild(item);
    });

    // Update preview date
    const dateLabel = document.getElementById('preview-date-label');
    const now = new Date();
    dateLabel.innerText = `Week of ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

// --- Combined Document Preview (all approved projects) ---
function renderCombinedDocumentPreview() {
    const approvedProjects = state.projects.filter(p => state.approvedProjects[p.Project]);
    const previewContainer = document.getElementById('doc-preview-content');

    if (approvedProjects.length === 0) {
        previewContainer.innerHTML = `
            <div class="empty-state">
                <i data-lucide="file-text" class="empty-icon" style="margin-bottom: 10px;"></i>
                <p>No approved projects to preview.</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    let html = '';

    // Section 1: Overall Status (all projects)
    html += `<h2>1. Overall Status</h2>`;
    approvedProjects.forEach(p => {
        const delay = parseInt(p['Delay Days']) || 0;
        const risk = parseInt(p['Risk Score']) || 0;
        const status = getStatusLabel(delay, risk);
        const summaryText = getProjectSummaryText(p.Project, status);

        html += `
            <p><strong>${p.Project} – <span class="text-${status.toLowerCase()}">${status}</span></strong> 
            <span style="font-size: 8.5pt; color: #7f8c8d;">(Delay: ${delay}d, Risk: ${risk}/5)</span></p>
            <p style="margin-left: 15pt; font-style: italic; color: #555;">"${summaryText}"</p>
        `;
    });

    // Section 2: Achievements
    html += `<h2>2. Weekly Achievements</h2>`;
    approvedProjects.forEach(p => {
        const achievements = state.achievements.filter(a => a.Project === p.Project);
        html += `<p><strong>${p.Project}</strong></p><ul>`;
        if (achievements.length > 0) {
            achievements.forEach(a => html += `<li>${a.Achievement}</li>`);
        } else {
            html += `<li style="font-style: italic; color: #7f8c8d;">No achievements recorded.</li>`;
        }
        html += `</ul>`;
    });

    // Section 3: Active Risks
    html += `<h2>3. Active Risks</h2>`;
    const allRisks = approvedProjects.flatMap(p => 
        state.risks.filter(r => r.Project === p.Project && 
            (r.Probability === 'High' || r.Probability === 'Critical' || r.Impact === 'High' || r.Impact === 'Critical'))
    );
    if (allRisks.length > 0) {
        html += `<table class="preview-table"><thead><tr>
            <th>Project</th><th>Risk Description</th><th>Probability</th><th>Impact</th><th>Mitigation Plan</th>
        </tr></thead><tbody>`;
        allRisks.forEach(r => {
            html += `<tr>
                <td><strong>${r.Project}</strong></td>
                <td>${r['Risk Description']}</td>
                <td class="preview-kpi-red" style="text-align:center;">${r.Probability}</td>
                <td class="preview-kpi-red" style="text-align:center;">${r.Impact}</td>
                <td>${r.Mitigation}</td>
            </tr>`;
        });
        html += `</tbody></table>`;
    } else {
        html += `<p style="font-style: italic; color: #7f8c8d;">No active High or Critical risks.</p>`;
    }

    // Section 4: Next Steps
    html += `<h2>4. Next Steps</h2>`;
    const allNextSteps = approvedProjects.flatMap(p => state.nextsteps.filter(n => n.Project === p.Project));
    if (allNextSteps.length > 0) {
        html += `<table class="preview-table"><thead><tr>
            <th>Project</th><th>Task</th><th>Owner</th><th>Deadline</th>
        </tr></thead><tbody>`;
        allNextSteps.forEach(n => {
            html += `<tr>
                <td><strong>${n.Project}</strong></td>
                <td>${n.Task}</td><td>${n.Owner}</td>
                <td style="text-align: center;">${n.Deadline}</td>
            </tr>`;
        });
        html += `</tbody></table>`;
    } else {
        html += `<p style="font-style: italic; color: #7f8c8d;">No upcoming tasks listed.</p>`;
    }

    // Section 5: KPI Dashboard
    html += `<h2>5. KPI Dashboard</h2>`;
    html += `<table class="preview-table"><thead><tr>
        <th>Project</th><th style="text-align:center;">CPI</th><th style="text-align:center;">SPI</th>
        <th style="text-align:center;">Budget Consumed %</th><th style="text-align:center;">Progress %</th>
    </tr></thead><tbody>`;
    approvedProjects.forEach(p => {
        const planned = parseFloat(p['Planned %']) || 0;
        const actual = parseFloat(p['Actual %']) || 0;
        const budget = parseFloat(p['Budget']) || 0;
        const actualCost = parseFloat(p['Actual Cost']) || 0;
        const spi = planned > 0 ? (actual / planned) : 0;
        const cpi = actualCost > 0 ? (budget / actualCost) : 0;
        const budgetPct = budget > 0 ? (actualCost / budget) : 0;
        const progressPct = planned > 0 ? (actual / planned) : 0;

        const cpiClass = cpi >= 0.9 ? 'preview-kpi-green' : (cpi >= 0.8 ? 'preview-kpi-yellow' : 'preview-kpi-red');
        const spiClass = spi >= 0.9 ? 'preview-kpi-green' : (spi >= 0.8 ? 'preview-kpi-yellow' : 'preview-kpi-red');

        html += `<tr>
            <td><strong>${p.Project}</strong></td>
            <td class="${cpiClass}">${cpi.toFixed(2)}</td>
            <td class="${spiClass}">${spi.toFixed(2)}</td>
            <td style="text-align: center;">${(budgetPct * 100).toFixed(0)}%</td>
            <td style="text-align: center;">${(progressPct * 100).toFixed(1)}%</td>
        </tr>`;
    });
    html += `</tbody></table>`;

    // Section 6: Decisions Required
    html += `<h2>6. Decisions Required</h2>`;
    const allDecisions = approvedProjects.flatMap(p => state.decisions.filter(d => d.Project === p.Project));
    if (allDecisions.length > 0) {
        html += `<table class="preview-table"><thead><tr>
            <th>Project</th><th>Decision Required</th><th>Context</th><th>Options</th><th>PM Recommendation</th>
        </tr></thead><tbody>`;
        allDecisions.forEach(d => {
            html += `<tr>
                <td><strong>${d.Project}</strong></td>
                <td>${d['Decision Required']}</td><td>${d.Context}</td>
                <td>${d.Options}</td><td>${d.Recommendation}</td>
            </tr>`;
        });
        html += `</tbody></table>`;
    } else {
        html += `<p style="font-style: italic; color: #7f8c8d;">No escalation or decisions required.</p>`;
    }

    previewContainer.innerHTML = html;
}

function getProjectSummaryText(projName, status) {
    if (projName === 'CRM Upgrade') return 'Progress slightly behind plan due to testing delays.';
    if (projName === 'ERP Rollout') return 'On schedule and within budget.';
    if (projName === 'Data Migration') return 'Critical schedule slippage impacting deployment.';
    return status === 'Green' ? 'On track and within budget thresholds.' : 
           status === 'Yellow' ? 'Experiencing slight delays with recovery strategies in progress.' :
           'Critical slippage impacting key delivery milestones.';
}

// --- Compile Confirmation Modal ---
function setupCompileModalListeners() {
    const modal = document.getElementById('compile-confirm-modal');
    const closeBtn = document.getElementById('btn-close-compile-modal');
    const cancelBtn = document.getElementById('btn-cancel-compile');
    const confirmBtn = document.getElementById('btn-confirm-compile');

    const closeModal = () => modal.classList.add('hidden');
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    confirmBtn.addEventListener('click', async () => {
        closeModal();
        await executeCompilation();
    });
}

function openCompileConfirmModal() {
    const modal = document.getElementById('compile-confirm-modal');
    const list = document.getElementById('compile-project-list');
    list.innerHTML = '';

    const approved = state.projects.filter(p => state.approvedProjects[p.Project]);
    approved.forEach(p => {
        const li = document.createElement('li');
        li.innerText = p.Project;
        list.appendChild(li);
    });

    modal.classList.remove('hidden');
    lucide.createIcons();
}

async function executeCompilation() {
    const compileBtn = document.getElementById('btn-compile-report');
    compileBtn.disabled = true;
    compileBtn.innerHTML = "<i data-lucide='loader' class='icon anim-spin'></i> Generating Document...";
    lucide.createIcons();

    try {
        const response = await fetch('/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                projects: state.projects,
                achievements: state.achievements,
                risks: state.risks,
                nextsteps: state.nextsteps,
                decisions: state.decisions
            })
        });

        if (!response.ok) throw new Error('Compilation server error');
        await response.json();

        showToast('Weekly Report compiled successfully! Word doc generated.', 'success');

        // Populate step 3 meta info
        const approvedCount = state.projects.filter(p => state.approvedProjects[p.Project]).length;
        const now = new Date();
        const metaInfo = document.getElementById('report-meta-info');
        metaInfo.innerHTML = `
            <div class="meta-row"><span class="meta-label">Generated At</span><span>${now.toLocaleString()}</span></div>
            <div class="meta-row"><span class="meta-label">Projects Included</span><span>${approvedCount}</span></div>
            <div class="meta-row"><span class="meta-label">Report File</span><span>PMO_Executive_Report.docx</span></div>
            <div class="meta-row"><span class="meta-label">Data File</span><span>PMO_Weekly_Report_Data.xlsx</span></div>
        `;

        // Move to step 3
        setWorkflowStep(3);
        fetchData(); // Sync fresh calculations

    } catch (e) {
        console.error(e);
        showToast('Failed to compile report: ' + e.message, 'error');
    } finally {
        compileBtn.disabled = false;
        compileBtn.innerHTML = "Generate Report";
        lucide.createIcons();
    }
}

// ==========================================================================
// MODAL FOR ADDING NEW PROJECTS
// ==========================================================================
function setupModalListeners() {
    const modal = document.getElementById("add-project-modal");
    const openBtn = document.getElementById("btn-open-add-project");
    const closeBtn = document.getElementById("btn-close-modal");
    const cancelBtn = document.getElementById("btn-cancel-modal");
    const form = document.getElementById("add-project-form");

    // Open Modal
    openBtn.addEventListener("click", () => {
        form.reset();
        modal.classList.remove("hidden");
    });

    // Close Modal helpers
    const closeModal = () => modal.classList.add("hidden");
    closeBtn.addEventListener("click", closeModal);
    cancelBtn.addEventListener("click", closeModal);
    
    // Close on background click
    modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal();
    });

    // Form submission inside modal
    form.addEventListener("submit", (e) => {
        e.preventDefault();
        
        const projName = document.getElementById("modal-input-name").value.trim();
        const manager = document.getElementById("modal-input-manager").value.trim();
        const budget = parseFloat(document.getElementById("modal-input-budget").value) || 0;
        const planned = parseFloat(document.getElementById("modal-input-planned").value) || 0;

        // Validation: Unique Name
        if (state.projects.some(p => p.Project.toLowerCase() === projName.toLowerCase())) {
            showToast("A project with that name already exists.", "error");
            return;
        }

        // Add Project Object
        const newProj = {
            "Project": projName,
            "Manager": manager,
            "Planned %": planned,
            "Actual %": 0,
            "Budget": budget,
            "Actual Cost": 0,
            "Delay Days": 0,
            "Risk Score": 1,
            "Status": "Green",
            "CPI": 1.0,
            "SPI": 1.0,
            "Budget Consumed %": 0.0,
            "Progress %": 0.0,
            "OneLineSummary": "On schedule and within budget."
        };

        state.projects.push(newProj);
        state.approvedProjects[projName] = false;

        // Re-render dashboard components
        populateDashboardTable();
        populateProjectDropdown();
        updateDashboardCards();
        
        // Hide modal
        closeModal();
        showToast(`Project "${projName}" created successfully!`, "success");

        // Automatically switch to form entry and select this project
        document.querySelector("[data-tab='entry-form']").click();
        const select = document.getElementById("project-select");
        select.value = projName;
        state.selectedProjectName = projName;
        loadProjectIntoForm(projName);
    });

    // --- Setup Delete Confirmation Modal Listeners ---
    const deleteModal = document.getElementById("delete-project-modal");
    const closeDeleteBtn = document.getElementById("btn-close-delete-modal");
    const cancelDeleteBtn = document.getElementById("btn-cancel-delete");
    const confirmDeleteBtn = document.getElementById("btn-confirm-delete");

    const closeDeleteModal = () => {
        deleteModal.classList.add("hidden");
        state.projectToDelete = null;
    };

    closeDeleteBtn.addEventListener("click", closeDeleteModal);
    cancelDeleteBtn.addEventListener("click", closeDeleteModal);
    deleteModal.addEventListener("click", (e) => {
        if (e.target === deleteModal) closeDeleteModal();
    });

    confirmDeleteBtn.addEventListener("click", () => {
        if (state.projectToDelete) {
            const name = state.projectToDelete;
            executeProjectDeletion(name);
            closeDeleteModal();
        }
    });
}

// ==========================================================================
// TOAST NOTIFICATIONS HELPER
// ==========================================================================
function showToast(message, type = "info") {
    const toast = document.getElementById("toast");
    toast.innerText = message;
    toast.className = `toast ${type}`;
    
    // Show toast
    toast.classList.remove("hidden");
    
    // Hide toast after 3 seconds
    setTimeout(() => {
        toast.classList.add("hidden");
    }, 4000);
}
