// ===== SITE-WIDE CONFIG: swap in real data here =====
// Course / student / payment data now comes from the API (Google Sheet); only labels and
// empty-state copy live here.
const DATA = {
  site: {
    brand: { logo: "assets/logo.png", name: "IICFE", sub: "Singapore" },
    nav: [
      { label: "Home", href: "index.html" },
      { label: "Courses", href: "courses.html" },
      { label: "Contact", href: "mailto:info@iicfe-demo.com" },
    ],
    cta: { label: "Explore Courses", href: "courses.html" }, // gold header button (pages with data-cta)
    footer: {
      blurb: "IICFE Singapore's Study Hub: structured ACCA learning at your own pace.",
      email: "info@iicfe-demo.com",
      links: [
        { label: "Courses", href: "courses.html" },
        ], // the Sign In / My Workspace link is appended automatically
      copyright: "© IICFE Singapore",
    },
  },

  // Course hub (course.html) config. Course-specific content comes from the Google Sheet.
  hub: {
    chatChips: ["What is the study plan?", "Any exam technique tips?", "What does the conceptual framework cover?"],
    // Which hub section a due item's type points to (anything else goes to Resources).
    dueRoutes: { Quiz: "mock", "Mock test": "mock", Exam: "final" },
  },

  workspace: {
    // type: "list" | "journey" | "table". Rows come from GET /api/workspace (see js/workspace.js).
    sections: [
      { id: "active", icon: "active", label: "My Courses", type: "list",
        desc: "Your courses in progress and finished.",
        empty: { title: "No active courses yet", text: "Courses you start will show up here so you can pick up where you left off." } },
      { id: "journey", icon: "journey", label: "Overall Journey", type: "journey",
        desc: "Your progress across all papers at a glance.",
        empty: { title: "No progress yet", text: "Your sessions and steps will show here as you start learning." } },
      { id: "payments", icon: "payments", label: "Payments & Receipts", type: "table",
        desc: "Your payment history and downloadable receipts.",
        columns: [
          { key: "date", label: "Date" },
          { key: "description", label: "Description" },
          { key: "amount", label: "Amount" },
          { key: "status", label: "Status" },
          { key: "receiptUrl", label: "Receipt", link: "Receipt" },
        ],
        empty: { title: "No payments yet", text: "Payments and receipts will appear here." } },
      { id: "certificates", icon: "certificate", label: "Certificates", type: "list",
        desc: "Certificates you have earned.",
        empty: { title: "No certificates yet", text: "Complete a course to earn your first certificate." } },
      { id: "webinars", icon: "webinars", label: "Webinars", type: "list",
        desc: "Upcoming live sessions.",
        empty: { title: "No webinars scheduled yet", text: "Upcoming webinars will be announced here." } },
      { id: "news", icon: "news", label: "News", type: "list",
        desc: "Updates and announcements from IICFE.",
        empty: { title: "Nothing new yet", text: "Updates from IICFE will appear here." } },
    ],
  },
};
// ====================================================
