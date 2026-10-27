const Validation = {
  required(value, label) {
    if (!String(value || "").trim()) {
      return `${label} is required.`;
    }
    return "";
  },

  studentEmail(email) {
    const value = String(email || "").trim().toLowerCase();
    if (!value) return "College email is required.";
    const domain = `@${CONFIG.STUDENT_EMAIL_DOMAIN}`;
    if (!value.endsWith(domain) || value === domain || !value.includes("@")) {
      return `Email must end with ${domain}`;
    }
    const local = value.slice(0, -domain.length);
    if (!local || local.includes(" ")) {
      return `Email must end with ${domain}`;
    }
    return "";
  },

  examDetails(form) {
    const errors = {};
    const fields = [
      ["department", "Department"],
      ["year", "Year"],
      ["section", "Section"],
      ["examName", "Exam Name"],
      ["examTiming", "Exam Timing"],
      ["session", "Session"]
    ];
    fields.forEach(([key, label]) => {
      const msg = this.required(form[key], label);
      if (msg) errors[key] = msg;
    });
    return errors;
  }
};
