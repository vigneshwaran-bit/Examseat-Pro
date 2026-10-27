const Store = {
  state: {
    admins: [],
    students: [],
    session: null,
    examDetails: null,
    sheetConnected: false,
    studentSource: null,
    allocation: null
  },

  load() {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE_KEY);

      if (raw) {
        const parsed = JSON.parse(raw);

        this.state = {
          admins: Array.isArray(parsed.admins) ? parsed.admins : [],
          students: Array.isArray(parsed.students) ? parsed.students : [],
          session: parsed.session || null,
          examDetails: parsed.examDetails || null,
          sheetConnected: Boolean(parsed.sheetConnected),
          studentSource: parsed.studentSource || null,
          allocation: parsed.allocation || null
        };

        return;
      }
    } catch (err) {
      console.warn("Could not read localStorage.", err);
    }

    this.reset();
  },

  save() {
    localStorage.setItem(
      CONFIG.STORAGE_KEY,
      JSON.stringify(this.state)
    );
  },

  reset() {
    this.state = {
      admins: [],
      students: [],
      session: null,
      examDetails: null,
      sheetConnected: false,
      studentSource: null,
      allocation: null
    };

    this.save();
  },

  getStudents() {
    return this.state.students || [];
  },

  setStudents(students, source = "import") {
    this.state.students = Array.isArray(students) ? students : [];
    this.state.sheetConnected = this.state.students.length > 0;
    this.state.studentSource = this.state.sheetConnected ? source : null;
    this.state.allocation = null;
    this.save();
  },

  getStudentById(id) {
    return this.getStudents().find((s) => s.id === id) || null;
  },

  getStudentByRegister(registerNo) {
    const key = String(registerNo || "")
      .trim()
      .toUpperCase();

    return (
      this.getStudents().find(
        (s) =>
          String(s.registerNo || "").toUpperCase() === key
      ) || null
    );
  },

  findAdmin(employeeId) {
    const key = String(employeeId || "")
      .trim()
      .toUpperCase();

    return (
      this.state.admins.find(
        (a) =>
          String(a.employeeId || "").toUpperCase() === key
      ) || null
    );
  },

  signupAdmin({ username, employeeId }) {
    const id = employeeId.trim();

    if (this.findAdmin(id)) {
      return {
        ok: false,
        error: "An admin with this Employee ID already exists."
      };
    }

    const admin = {
      username: username.trim(),
      employeeId: id,
      passcode: id
    };

    this.state.admins.push(admin);
    this.save();

    return {
      ok: true,
      admin
    };
  },

  loginAdmin(employeeId, passcode) {
    const admin = this.findAdmin(employeeId);

    if (!admin || admin.passcode !== passcode) {
      return {
        ok: false,
        error: "Invalid Employee ID or Passcode."
      };
    }

    this.state.session = {
      role: "admin",
      employeeId: admin.employeeId,
      username: admin.username
    };

    this.save();

    return { ok: true };
  },

  loginStudent() {
    this.state.session = {
      role: "student"
    };

    this.save();

    return { ok: true };
  },

  logout() {
    this.state.session = null;
    this.save();
  },

  isAdmin() {
    return (
      this.state.session &&
      this.state.session.role === "admin"
    );
  },

  isStudent() {
    return (
      this.state.session &&
      this.state.session.role === "student"
    );
  },

  setExamDetails(details) {
    this.state.examDetails = details;
    this.state.sheetConnected = false;
    this.state.studentSource = null;
    this.state.students = [];
    this.state.allocation = null;
    this.save();
  },

  setAllocation(allocation) {
    this.state.allocation = allocation;
    this.save();
  },

  findAllocatedSeat(registerNo) {
    if (!this.state.allocation) {
      return null;
    }

    const key = String(registerNo || "")
      .trim()
      .toUpperCase();

    const seat = this.state.allocation.seats.find((cell) => {
      if (!cell.studentId) {
        return false;
      }

      const student = this.getStudentById(cell.studentId);

      return (
        student &&
        String(student.registerNo || "").toUpperCase() === key
      );
    });

    if (!seat) {
      return null;
    }

    return {
      seat,
      student: this.getStudentById(seat.studentId)
    };
  }
};
