const CONFIG = {
  API_BASE_URL: "http://127.0.0.1:8000",
  GOOGLE_OAUTH_CLIENT_ID: "1083485594701-2hkchmocs7ru4943dn1rgis04sv86j94.apps.googleusercontent.com",

  ROWS: 3,
  COLS: 10,
  SEATS_PER_BENCH: 2,

  DEPARTMENTS: [
    "CSE",
    "MECH",
    "ECE",
    "EEE",
    "CYBER SECURITY",
    "BME",
    "BBA",
    "MBA",
    "MCA",
    "IT",
    "CIVIL",
    "BIO TECHNOLOGY",
    "AI&ML",
    "AI&DS",
    "BCA DATA SCIENCE",
    "MBBS",
    "BPT"
  ],

  YEARS: ["I", "II", "III", "IV", "V"],

  SECTIONS: ["A", "B", "C", "D", "E", "F", "G", "H"],

  SESSIONS: ["FN", "AN"],

  STUDENT_EMAIL_DOMAIN: "srmist.edu.in",

  STORAGE_KEY: "examseat-pro-state-v2",

  HALLS: [
    { id: "HALL-01", name: "IST-101", capacity: 60 },
    { id: "HALL-02", name: "IST-102", capacity: 60 },
    { id: "HALL-03", name: "IST-103", capacity: 60 },
    { id: "HALL-04", name: "IST-104", capacity: 60 }
  ]
};

CONFIG.TOTAL_BENCHES = CONFIG.ROWS * CONFIG.COLS;
CONFIG.HALL_CAPACITY = CONFIG.TOTAL_BENCHES * CONFIG.SEATS_PER_BENCH;
