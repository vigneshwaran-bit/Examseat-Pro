const App = {
  init() {
    Store.load();
    this.fillExamSelects();
    this.bindGlobalNav();
    this.bindAdminAuth();
    this.bindExamDetails();
    this.bindSheet();
    this.bindAllocation();
    this.bindStudentSearch();
    window.addEventListener("hashchange", () => {
      const hash = (window.location.hash || "#landing").replace("#", "");
      const allowed = this.guard(hash || "landing");
      this.showView(allowed);
      if (allowed !== hash) window.location.hash = allowed;
    });
    this.showInitialView();
  },

  fillExamSelects() {
    UI.fillSelect(document.getElementById("examDepartment"), CONFIG.DEPARTMENTS, "Select Department");
    UI.fillSelect(document.getElementById("examYear"), CONFIG.YEARS, "Select Year");
    UI.fillSelect(document.getElementById("examSection"), CONFIG.SECTIONS, "Select Section");
  },

  bindGlobalNav() {
    document.querySelectorAll("[data-go]").forEach((btn) => {
      btn.addEventListener("click", () => this.go(btn.dataset.go));
    });
    document.querySelectorAll("[data-logout]").forEach((btn) => {
      btn.addEventListener("click", () => this.logoutToLanding());
    });
    document.getElementById("adminLogoutBtn").addEventListener("click", () => this.logoutToLanding());
    document.getElementById("studentLogoutBtn").addEventListener("click", () => this.logoutToLanding());
  },

  logoutToLanding() {
    Store.logout();
    this.go("landing");
  },

  go(view) {
    const allowed = this.guard(view);
    this.showView(allowed);
    window.location.hash = allowed;
  },

  guard(view) {
    const adminFlow = ["exam-details", "google-sheet", "allocation", "admin-result"];
    if (adminFlow.includes(view) && !Store.isAdmin()) return "admin-login";
    if (view === "student-dashboard" && !Store.isStudent()) return "student-login";
    if (view === "google-sheet" && !Store.state.examDetails) return "exam-details";
    if (view === "allocation" && !Store.state.sheetConnected) return "google-sheet";
    if (view === "admin-result" && !Store.state.allocation) return "allocation";
    return view;
  },

  showView(view) {
    document.querySelectorAll(".view").forEach((el) => {
      el.hidden = el.dataset.view !== view;
    });
    if (view === "google-sheet") this.renderSheetPreview();
    if (view === "allocation") this.renderAllocation();
    if (view === "admin-result") this.renderAdminResult();
  },

  showInitialView() {
    const hash = (window.location.hash || "#landing").replace("#", "");
    this.go(hash || "landing");
  },

  bindAdminAuth() {
    document.getElementById("signupEmployeeId").addEventListener("input", (event) => {
      document.getElementById("signupPasscode").value = event.target.value.trim();
    });

    document.getElementById("adminLoginForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const employeeId = document.getElementById("adminEmployeeId").value.trim();
      const passcode = document.getElementById("adminPasscode").value;
      const missing = Validation.required(employeeId, "Employee ID") || Validation.required(passcode, "Passcode");
      if (missing) {
        UI.setError("adminLoginError", missing);
        return;
      }
      const result = Store.loginAdmin(employeeId, passcode);
      if (!result.ok) {
        UI.setError("adminLoginError", result.error);
        return;
      }
      UI.setError("adminLoginError", "");
      this.go("exam-details");
    });

    document.getElementById("adminSignupForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const username = document.getElementById("signupUsername").value.trim();
      const employeeId = document.getElementById("signupEmployeeId").value.trim();
      const missing = Validation.required(username, "Username") || Validation.required(employeeId, "Employee ID");
      if (missing) {
        UI.setError("adminSignupError", missing);
        return;
      }
      const result = Store.signupAdmin({ username, employeeId });
      if (!result.ok) {
        UI.setError("adminSignupError", result.error);
        return;
      }
      UI.setError("adminSignupError", "");
      document.getElementById("adminEmployeeId").value = employeeId;
      document.getElementById("adminPasscode").value = employeeId;
      this.go("admin-login");
    });
  },

  bindExamDetails() {
    document.getElementById("examDetailsForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = {
        department: document.getElementById("examDepartment").value,
        year: document.getElementById("examYear").value,
        section: document.getElementById("examSection").value,
        examName: document.getElementById("examName").value.trim(),
        examDate: document.getElementById("examDate").value,
        examTiming: document.getElementById("examTiming").value.trim(),
        session: (document.querySelector('input[name="session"]:checked') || {}).value || ""
      };
      const errors = Validation.examDetails(form);
      const first = Object.values(errors)[0];
      if (first) {
        UI.setError("examDetailsError", first);
        return;
      }
      Store.setExamDetails(form);
      UI.setError("examDetailsError", "");
      this.go("google-sheet");
    });
  },

  bindSheet() {
    document.getElementById("connectSheetBtn").addEventListener("click", () => this.importGoogleSheet());
    document.getElementById("uploadStudentsBtn").addEventListener("click", () => this.importStudentFile());
    document.getElementById("sheetContinueBtn").addEventListener("click", () => {
      if (!Store.state.sheetConnected) {
        UI.setError("sheetError", "Import a Google Sheet or student file first.");
        return;
      }
      this.go("allocation");
    });
  },

  sheetIdFromInput(value) {
    const input = String(value || "").trim();
    const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    const id = match ? match[1] : input;
    if (!/^[a-zA-Z0-9_-]{10,}$/.test(id)) {
      throw new Error("Enter a valid Google Sheets link or spreadsheet ID.");
    }
    return id;
  },

  async importGoogleSheet() {
    const button = document.getElementById("connectSheetBtn");
    const sheetValue = document.getElementById("googleSheetUrl").value;
    const tabName = document.getElementById("googleSheetTab").value.trim();
    UI.setError("sheetError", "");
    try {
      const spreadsheetId = this.sheetIdFromInput(sheetValue);
      if (!CONFIG.GOOGLE_OAUTH_CLIENT_ID) {
        throw new Error("Google Sheets is not configured yet. Add a Google OAuth web client ID to js/config.js; a client secret must never be placed in frontend code.");
      }
      if (!window.google?.accounts?.oauth2) {
        throw new Error("Google sign-in could not load. Check your internet connection and try again.");
      }
      button.disabled = true;
      button.textContent = "Connecting…";
      const token = await new Promise((resolve, reject) => {
        const client = google.accounts.oauth2.initTokenClient({
          client_id: CONFIG.GOOGLE_OAUTH_CLIENT_ID,
          scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
          callback: (result) => result.error ? reject(new Error(result.error_description || "Google authorization failed.")) : resolve(result.access_token),
          error_callback: (error) => reject(new Error(error.message || "Google authorization was cancelled."))
        });
        client.requestAccessToken({ prompt: "consent" });
      });

      const headers = { Authorization: `Bearer ${token}` };
      const metadataResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`, { headers });
      const metadata = await metadataResponse.json();
      if (!metadataResponse.ok) throw new Error(metadata.error?.message || "Could not open that Google Sheet. Check the link and your access.");
      const selectedTab = tabName || metadata.sheets?.[0]?.properties?.title;
      if (!selectedTab) throw new Error("The spreadsheet has no readable tabs.");

      const range = `'${selectedTab.replace(/'/g, "''")}'!A:Z`;
      const valuesResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`, { headers });
      const values = await valuesResponse.json();
      if (!valuesResponse.ok) throw new Error(values.error?.message || "Could not read rows from that Google Sheet.");
      this.acceptStudentRows(values.values || [], `Google Sheet: ${selectedTab}`);
    } catch (error) {
      UI.setError("sheetError", error.message || "Could not import the Google Sheet.");
    } finally {
      button.disabled = false;
      button.textContent = "Connect Google Sheet";
    }
  },

  async importStudentFile() {
    const button = document.getElementById("uploadStudentsBtn");
    const input = document.getElementById("studentFileInput");
    const file = input.files?.[0];
    UI.setError("sheetError", "");
    if (!file) {
      UI.setError("sheetError", "Choose an Excel or CSV file first.");
      return;
    }
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      UI.setError("sheetError", "Choose an .xlsx, .xls, or .csv file.");
      return;
    }
    if (!window.XLSX) {
      UI.setError("sheetError", "The spreadsheet reader could not load. Check your internet connection and try again.");
      return;
    }
    button.disabled = true;
    button.textContent = "Importing…";
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet) throw new Error("The selected file does not contain a worksheet.");
      const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "", raw: false });
      this.acceptStudentRows(rows, `File: ${file.name}`);
    } catch (error) {
      UI.setError("sheetError", error.message || "Could not read the selected file.");
    } finally {
      button.disabled = false;
      button.textContent = "Import file";
    }
  },

  acceptStudentRows(rows, source) {
    if (!rows.length || rows.length < 2) throw new Error("The source must include a header row and at least one student.");
    const normalizeHeader = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    const header = rows[0].map(normalizeHeader);
    const findColumn = (names) => header.findIndex((value) => names.includes(value));
    const columns = {
      registerNo: findColumn(["registerno", "registernumber", "registrationno", "regno", "rollno", "rollnumber", "studentid"]),
      name: findColumn(["name", "studentname", "fullname"]),
      department: findColumn(["department", "dept", "branch"]),
      year: findColumn(["year", "studyyear", "academicYear".toLowerCase()]),
      section: findColumn(["section", "classsection"])
    };
    if (columns.registerNo < 0 || columns.name < 0) {
      throw new Error("Could not find the required columns. Add headers named Register Number (or Reg No) and Student Name (or Name).");
    }
    const exam = Store.state.examDetails || {};
    const students = [];
    const seen = new Set();
    const errors = [];
    rows.slice(1).forEach((row, index) => {
      if (!row.some((cell) => String(cell || "").trim())) return;
      const value = (column, fallback = "") => column < 0 ? fallback : String(row[column] ?? "").trim();
      const registerNo = value(columns.registerNo);
      const name = value(columns.name);
      const line = index + 2;
      if (!registerNo || !name) {
        errors.push(`row ${line}: Register Number and Student Name are required`);
        return;
      }
      const key = registerNo.toUpperCase();
      if (seen.has(key)) {
        errors.push(`row ${line}: duplicate Register Number ${registerNo}`);
        return;
      }
      seen.add(key);
      students.push({
        id: globalThis.crypto?.randomUUID ? crypto.randomUUID() : `student-${Date.now()}-${line}`,
        registerNo,
        name,
        department: value(columns.department, exam.department || "Unknown"),
        year: value(columns.year, exam.year || "Unknown"),
        section: value(columns.section, exam.section || "Unknown")
      });
    });
    if (errors.length) throw new Error(`Fix these student rows and import again: ${errors.slice(0, 5).join("; ")}${errors.length > 5 ? `; and ${errors.length - 5} more` : ""}.`);
    if (!students.length) throw new Error("No student rows were found beneath the header.");
    Store.setStudents(students, source);
    UI.setError("sheetError", "");
    this.renderSheetPreview();
  },

  renderSheetPreview() {
    const preview = document.getElementById("sheetPreview");
    if (!Store.state.sheetConnected) {
      preview.hidden = true;
      return;
    }
    preview.hidden = false;
    document.getElementById("studentImportSummary").textContent = `${Store.getStudents().length} students imported · ${Store.state.studentSource || "Student list"}`;
    document.getElementById("sheetTableBody").innerHTML = Store.getStudents()
      .map(
        (s) => `
        <tr>
          <td>${UI.escape(s.registerNo)}</td>
          <td>${UI.escape(s.name)}</td>
          <td>${UI.escape(s.department)}</td>
          <td>${UI.escape(s.year)}</td>
          <td>${UI.escape(s.section)}</td>
        </tr>`
      )
      .join("");
  },

  bindAllocation() {
    document.getElementById("runAllocBtn").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      UI.setError("allocationError", "");
      try {
        const response = await fetch(`${CONFIG.API_BASE_URL}/api/allocations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            exam: Store.state.examDetails,
            students: Store.getStudents()
          })
        });
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.detail || "The server could not allocate seats.");
        }
        Store.setAllocation(result);
        this.renderAllocation();
      } catch (error) {
        UI.setError(
          "allocationError",
          error instanceof TypeError
            ? "Could not reach the backend. Start the FastAPI server and try again."
            : error.message
        );
      } finally {
        button.disabled = false;
      }
    });
    document.getElementById("viewResultBtn").addEventListener("click", () => this.go("admin-result"));
    document.getElementById("addDepartmentBtn").addEventListener("click", () => {
      this.go("exam-details");
    });
  },

  renderAllocation() {
    const wrap = document.getElementById("allocationHalls");
    const resultBtn = document.getElementById("viewResultBtn");
    if (!Store.state.allocation) {
      wrap.innerHTML = `<p class="muted">Allocate seats to see the hall arrangement.</p>`;
      resultBtn.hidden = true;
      return;
    }
    resultBtn.hidden = false;
    wrap.innerHTML = this.seatingHtml(Store.state.allocation);
  },

  seatingHtml(allocation) {
    return CONFIG.HALLS.map((hall) => {
      const seats = allocation.seats.filter((s) => s.hallId === hall.id);
      return `
        <article class="hall-block card">
          <h2>${UI.escape(hall.name)}</h2>
          <p class="hall-banner">Front of hall / invigilator</p>
          <div class="hall">${this.hallGrid(seats)}</div>
        </article>`;
    }).join("");
  },

  hallGrid(seats) {
    const map = new Map();
    seats.forEach((cell) => map.set(`${cell.row}-${cell.bench}-${cell.seat}`, cell));
    let html = "";
    for (let row = 1; row <= CONFIG.ROWS; row += 1) {
      html += `<div class="hall-row"><div class="row-label">Row ${row}</div><div class="bench-row">`;
      for (let bench = 1; bench <= CONFIG.COLS; bench += 1) {
        html += `<article class="bench"><div class="bench-head">Bench ${bench}</div><div class="bench-seats">`;
        for (let seat = 1; seat <= CONFIG.SEATS_PER_BENCH; seat += 1) {
          html += this.seatHtml(map.get(`${row}-${bench}-${seat}`));
        }
        html += `</div></article>`;
      }
      html += `</div></div>`;
    }
    return html;
  },

   seatHtml(cell) {
    if (!cell) {
      return `<div class="seat empty"><strong>Empty</strong></div>`;
    }

    const student = cell.studentId
      ? Store.getStudentById(cell.studentId)
      : null;

    const registerNo = student?.registerNo || cell.registerNo;
    const name = student?.name || cell.name;
    const department = student?.department || cell.department;

    if (!registerNo || !name) {
      return `<div class="seat empty"><strong>Seat ${cell.seat}</strong>Empty</div>`;
    }

    const cls = String(department || "student")
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-");

    return `
      <div class="seat ${cls}">
        <strong>${UI.escape(registerNo)}</strong>
        ${UI.escape(name)}
      </div>
    `;
  },

  renderAdminResult() {
    const exam = Store.state.examDetails;
    const allocation = Store.state.allocation;
    if (!exam || !allocation) return;

    document.getElementById("resultExamSummary").innerHTML = `
      <div><dt>Department</dt><dd>${UI.escape(exam.department || "-")}</dd></div>
      <div><dt>Year</dt><dd>${UI.escape(exam.year || "-")}</dd></div>
      <div><dt>Section</dt><dd>${UI.escape(exam.section || "-")}</dd></div>
      <div><dt>Exam Name</dt><dd>${UI.escape(exam.examName || "-")}</dd></div>
      <div><dt>Exam Date</dt><dd>${UI.escape(exam.examDate || "-")}</dd></div>
      <div><dt>Exam Timing</dt><dd>${UI.escape(exam.examTiming || "-")}</dd></div>
      <div><dt>Session</dt><dd>${UI.escape(exam.session || "-")}</dd></div>
    `;

    document.getElementById("hallStatusGrid").innerHTML = allocation.halls
      .map((hall) => {
        const cls = hall.status === "FULL" ? "full" : hall.status === "EMPTY" ? "empty" : "partial";
        return `
          <article class="status-card">
            <strong>${UI.escape(hall.name)}</strong>
            <p>Capacity: ${hall.capacity}</p>
            <p>Students Allocated: ${hall.allocated}</p>
            <p>Empty Seats: ${hall.empty}</p>
            <span class="badge ${cls}">${UI.escape(hall.status)}</span>
          </article>`;
      })
      .join("");

    document.getElementById("resultSeating").innerHTML = `
      <article class="card"><h2>Seating Arrangement</h2></article>
      ${this.seatingHtml(allocation)}
    `;
  },

  bindStudentAuth() {
    //Student email/password login removed.
    //Student login now only by register number.
  },

  bindStudentSearch() {
    const button = document.getElementById("studentSearchBtn");

    if (!button) return;

    button.addEventListener("click", () => {
        const registerNo =
            document.getElementById("registerSearch").value.trim();

        const box =
            document.getElementById("studentResult");

        if (!registerNo) {
            UI.setError(
                "studentSearchError",
                "Enter your Register Number."
            );
            box.hidden = true;
            return;
        }

        const found = Store.findAllocatedSeat(registerNo);

        if (!found) {
            UI.setError("studentSearchError", "");
            box.hidden = false;

            box.innerHTML = `
                <p>
                    No allocated hall found for this register number.
                </p>
            `;

            return;
        }

        UI.setError("studentSearchError", "");

        const className =
            `${found.student.department}-${found.student.section}`;

        box.hidden = false;

        const hall = CONFIG.HALLS.find(h => h.id === found.seat.hallId);
        const hallName = hall ? hall.name : found.seat.hallId;
        const seatNo = found.seat.seat;

        box.innerHTML = `
            <div>
                <strong>Student Name</strong>
                ${UI.escape(found.student.name)}
            </div>

            <div>
                <strong>Register Number</strong>
                ${UI.escape(found.student.registerNo)}
            </div>

            <div>
                <strong>Department</strong>
                ${UI.escape(found.student.department)}
            </div>

            <div>
                <strong>Class</strong>
                ${UI.escape(className)}
            </div>

            <div>
                <strong>Hall</strong>
                ${UI.escape(hallName)}
            </div>

            <div>
                <strong>Seat</strong>
                ${UI.escape(String(seatNo))}
            </div>
        `;
    });
}
};

document.addEventListener("DOMContentLoaded", () => App.init());
